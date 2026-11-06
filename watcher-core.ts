import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, lstat, readFile, rename, rmdir, stat, unlink, writeFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";

export type Transcript = {
  utterances?: Array<{ speaker: string; text: string; start: number; end: number }>;
  audio_duration?: number;
  text?: string;
  speech_model_used?: string;
  language_code?: string;
};
export type TranscriptionService = {
  upload(audio: Uint8Array): Promise<string>;
  submit(url: string): Promise<string>;
  wait(id: string): Promise<Transcript>;
};

export function buildMarkdown(title: string, data: Transcript): string {
  const utterances = data.utterances ?? [];
  const duration = data.audio_duration ?? 0;
  const speakers = [...new Set(utterances.map((u) => u.speaker))];
  let md = `# Transcripcion — ${title}\n`;
  md += `**Duracion:** ${Math.floor(duration / 60)} minutos ${Math.floor(duration % 60)} segundos\n`;
  md += `**Modelo:** AssemblyAI ${data.speech_model_used || "no informado por el servicio"}\n`;
  if (data.language_code) md += `**Idioma detectado:** ${data.language_code}\n`;
  md += `**Participantes:** ${speakers.join(", ") || "No identificados"}\n`;
  md += `**Fecha:** ${new Date().toISOString().split("T")[0]}\n\n---\n\n`;
  for (const u of utterances) {
    const m = Math.floor(u.start / 60000);
    const s = Math.floor((u.start % 60000) / 1000);
    md += `**[${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}] ${u.speaker}:** ${u.text}\n\n`;
  }
  if (!utterances.length) md += `${data.text?.trim() || "No se detectó voz."}\n`;
  return md;
}

const digest = (data: Uint8Array | string) => createHash("sha256").update(data).digest("hex");
const hasCode = (error: unknown, code: string) => (error as NodeJS.ErrnoException)?.code === code;

/** Exclusive creation also protects against two different names sanitizing to the same stem. */
export async function writeUnique(directory: string, name: string, data: string | Uint8Array): Promise<string> {
  await mkdir(directory, { recursive: true });
  const extension = extname(name);
  const stem = basename(name, extension) || "transcription";
  for (let suffix = 0; ; suffix++) {
    const path = join(directory, `${stem}${suffix ? ` (${suffix})` : ""}${extension}`);
    try {
      await writeFile(path, data, { flag: "wx" });
      return path;
    } catch (error) {
      if (hasCode(error, "EEXIST")) continue;
      // An incomplete new file may remain after a disk error. Never overwrite
      // it on retry, and never remove the source unless all writes succeeded.
      throw error;
    }
  }
}

type Job = {
  version: 1;
  sourceHash: string;
  creating?: boolean;
  jobId?: string;
  markdown?: string;
  outputPath?: string;
  archivePath?: string;
};
async function saveJob(path: string, job: Job) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(job, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    await rename(temporary, path);
  } finally {
    await unlink(temporary).catch(() => {});
  }
}
async function exists(path: string) {
  try { await stat(path); return true; }
  catch (error) { if (hasCode(error, "ENOENT")) return false; throw error; }
}

/** Checkpoints prevent a filesystem or polling retry from creating another paid job. */
export async function processRecording(options: {
  filePath: string;
  outputDirectory: string;
  watchDirectory: string;
  service: TranscriptionService;
}): Promise<{ outputPath: string; archivePath: string }> {
  const { filePath, outputDirectory, watchDirectory, service } = options;
  const audio = await readFile(filePath);
  const sourceHash = digest(audio);
  const stateDirectory = join(watchDirectory, ".transcriber-state");
  await mkdir(stateDirectory, { recursive: true });
  const statePath = join(stateDirectory, `${digest(basename(filePath) + "\0" + sourceHash)}.json`);
  let job: Job;
  try {
    job = JSON.parse(await readFile(statePath, "utf8"));
    if (job.version !== 1 || job.sourceHash !== sourceHash ||
        (job.jobId !== undefined && (typeof job.jobId !== "string" || !job.jobId)) ||
        (job.markdown !== undefined && typeof job.markdown !== "string"))
      throw new Error("Unrecognized checkpoint; source and existing files were preserved.");
  } catch (error) {
    if (!hasCode(error, "ENOENT")) throw error;
    job = { version: 1, sourceHash };
  }
  if (!job.markdown) {
    if (!job.jobId) {
      if (job.creating)
        throw new Error(`Submission outcome is unknown. Automatic resubmission is paused; inspect checkpoint ${statePath} before retrying.`);
      const url = await service.upload(audio);
      // Commit intent before the chargeable request. A lost response or crash
      // cannot silently produce a second paid transcript on the next scan.
      job.creating = true;
      await saveJob(statePath, job);
      const id = await service.submit(url);
      if (!id) throw new Error("The transcription service returned no job ID.");
      job.jobId = id;
      job.creating = false;
      await saveJob(statePath, job);
    }
    job.markdown = buildMarkdown(basename(filePath, extname(filePath)), await service.wait(job.jobId));
    await saveJob(statePath, job);
  }
  if (!job.outputPath || !(await exists(job.outputPath))) {
    const stem = basename(filePath, extname(filePath)).replace(/[^a-zA-Z0-9_\-\s]/g, "").trim().replace(/\s+/g, "_") || "transcription";
    job.outputPath = await writeUnique(outputDirectory, `${stem}.md`, job.markdown);
    await saveJob(statePath, job);
  }
  // Archive exactly the bytes sent for transcription. Never replace a previous
  // original with the same filename. Keep the source if archiving fails.
  if (!job.archivePath || !(await exists(job.archivePath))) {
    job.archivePath = await writeUnique(join(watchDirectory, ".processed"), basename(filePath), audio);
    await saveJob(statePath, job);
  }
  if (digest(await readFile(filePath)) !== sourceHash)
    throw new Error("The recording changed during transcription. The updated source was kept; the earlier version and transcript were saved.");
  // If a saved archive was modified outside this watcher, do not trust it as
  // the only remaining copy of the source.
  if (!(await lstat(job.archivePath)).isFile())
    throw new Error("The archive is not a regular file. The source was preserved.");
  if (digest(await readFile(job.archivePath)) !== sourceHash)
    throw new Error("The archived recording changed. The source was preserved.");
  // Move through a private staging directory before deleting the duplicate.
  // If iCloud replaces the pathname after our comparison, the replacement is
  // preserved here rather than accidentally unlinked as though it were ours.
  const staging = await mkdtemp(join(watchDirectory, ".processed", ".pending-"));
  const stagedSource = join(staging, basename(filePath));
  try {
    await rename(filePath, stagedSource);
    if (digest(await readFile(stagedSource)) !== sourceHash)
      throw new Error(`The recording changed while archiving. Its newer bytes were preserved at ${stagedSource}.`);
    if (!(await lstat(job.archivePath)).isFile() || digest(await readFile(job.archivePath)) !== sourceHash)
      throw new Error(`The archive changed while moving the source. The original was preserved at ${stagedSource}.`);
    await unlink(stagedSource);
  } finally {
    await rmdir(staging).catch(() => {}); // Keep a nonempty directory for recovery.
  }
  return { outputPath: job.outputPath, archivePath: job.archivePath };
}
