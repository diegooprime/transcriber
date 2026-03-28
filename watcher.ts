import { watch, readdirSync, statSync } from "fs";
import { join, extname, basename } from "path";
import { homedir } from "os";

const AAI_KEY = process.env.ASSEMBLYAI_API_KEY!;
const WATCH_FOLDER =
  process.env.WATCH_FOLDER ||
  join(homedir(), "Library/Mobile Documents/com~apple~CloudDocs/Transcriber");
const OUTPUT_FOLDER = process.env.OUTPUT_FOLDER || join(homedir(), "Desktop");
const LANGUAGE = process.env.TRANSCRIBE_LANG || "es";
const POLL_INTERVAL = 3000;
const STABILITY_CHECKS = 2;
const STABILITY_DELAY = 3000;

const AUDIO_EXTS = new Set([".m4a", ".mp3", ".wav", ".caf", ".aac", ".ogg", ".webm"]);
const processedFiles = new Set<string>();
const processingFiles = new Set<string>();

async function ensureWatchFolder() {
  const dir = Bun.file(WATCH_FOLDER);
  try {
    readdirSync(WATCH_FOLDER);
  } catch {
    await Bun.$`mkdir -p ${WATCH_FOLDER}`;
    console.log(`Created watch folder: ${WATCH_FOLDER}`);
  }
}

async function isFileStable(filePath: string): Promise<boolean> {
  let lastSize = -1;
  for (let i = 0; i < STABILITY_CHECKS; i++) {
    try {
      const stat = statSync(filePath);
      if (stat.size === lastSize && stat.size > 0) return true;
      lastSize = stat.size;
    } catch {
      return false;
    }
    await Bun.sleep(STABILITY_DELAY);
  }
  // Final check
  try {
    const stat = statSync(filePath);
    return stat.size === lastSize && stat.size > 0;
  } catch {
    return false;
  }
}

async function transcribeFile(filePath: string): Promise<string> {
  const audioBuffer = await Bun.file(filePath).arrayBuffer();

  // Upload
  const uploadRes = await fetch("https://api.assemblyai.com/v2/upload", {
    method: "POST",
    headers: { Authorization: AAI_KEY },
    body: audioBuffer,
  });

  if (!uploadRes.ok) {
    throw new Error(`Upload failed: ${await uploadRes.text()}`);
  }

  const { upload_url } = (await uploadRes.json()) as { upload_url: string };

  // Create transcription
  const createRes = await fetch("https://api.assemblyai.com/v2/transcript", {
    method: "POST",
    headers: {
      Authorization: AAI_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      audio_url: upload_url,
      speaker_labels: true,
      language_code: LANGUAGE,
      speech_models: ["universal-3-pro"],
    }),
  });

  if (!createRes.ok) {
    throw new Error(`Transcription create failed: ${await createRes.text()}`);
  }

  const { id } = (await createRes.json()) as { id: string };

  // Poll until complete (max 10 min)
  for (let i = 0; i < 120; i++) {
    await Bun.sleep(3000);

    const pollRes = await fetch(`https://api.assemblyai.com/v2/transcript/${id}`, {
      headers: { Authorization: AAI_KEY },
    });

    const data = (await pollRes.json()) as {
      status: string;
      error?: string;
      utterances?: Array<{ speaker: string; text: string; start: number; end: number }>;
      audio_duration?: number;
      text?: string;
    };

    if (data.status === "completed") {
      return buildMarkdown(basename(filePath, extname(filePath)), data);
    }

    if (data.status === "error") {
      throw new Error(`Transcription error: ${data.error}`);
    }
  }

  throw new Error("Transcription timed out");
}

function buildMarkdown(
  title: string,
  data: {
    utterances?: Array<{ speaker: string; text: string; start: number; end: number }>;
    audio_duration?: number;
    text?: string;
  }
): string {
  const utterances = data.utterances || [];
  const duration = data.audio_duration || 0;
  const mins = Math.floor(duration / 60);
  const secs = Math.floor(duration % 60);
  const speakers = [...new Set(utterances.map((u) => u.speaker))];

  let md = `# Transcripcion — ${title}\n`;
  md += `**Duracion:** ${mins} minutos ${secs} segundos\n`;
  md += `**Modelo:** AssemblyAI universal-3-pro\n`;
  md += `**Participantes:** ${speakers.join(", ")}\n`;
  md += `**Fecha:** ${new Date().toISOString().split("T")[0]}\n\n---\n\n`;

  for (const u of utterances) {
    const m = Math.floor(u.start / 60000);
    const s = Math.floor((u.start % 60000) / 1000);
    const ts = String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
    md += `**[${ts}] ${u.speaker}:** ${u.text}\n\n`;
  }

  return md;
}

async function processFile(filePath: string) {
  const fileName = basename(filePath);
  if (processedFiles.has(fileName) || processingFiles.has(fileName)) return;

  processingFiles.add(fileName);
  console.log(`[${new Date().toLocaleTimeString()}] New file detected: ${fileName}`);
  console.log(`  Waiting for iCloud sync to complete...`);

  const stable = await isFileStable(filePath);
  if (!stable) {
    console.log(`  File not stable, skipping: ${fileName}`);
    processingFiles.delete(fileName);
    return;
  }

  console.log(`  File stable. Transcribing...`);

  try {
    const markdown = await transcribeFile(filePath);
    const outName = basename(filePath, extname(filePath)).replace(/[^a-zA-Z0-9_\-\s]/g, "").replace(/\s+/g, "_");
    const outPath = join(OUTPUT_FOLDER, `${outName}.md`);
    await Bun.write(outPath, markdown);

    // Move original to .processed subfolder
    const processedDir = join(WATCH_FOLDER, ".processed");
    await Bun.$`mkdir -p ${processedDir}`;
    await Bun.$`mv ${filePath} ${join(processedDir, fileName)}`;

    processedFiles.add(fileName);
    console.log(`  Done! Saved to: ${outPath}`);
  } catch (err: any) {
    console.error(`  Error transcribing ${fileName}: ${err.message}`);
  } finally {
    processingFiles.delete(fileName);
  }
}

async function scanFolder() {
  try {
    const entries = readdirSync(WATCH_FOLDER);
    for (const entry of entries) {
      if (entry.startsWith(".")) continue;
      const ext = extname(entry).toLowerCase();
      if (!AUDIO_EXTS.has(ext)) continue;
      const filePath = join(WATCH_FOLDER, entry);
      try {
        const stat = statSync(filePath);
        if (stat.isFile()) {
          await processFile(filePath);
        }
      } catch (err: any) {
        console.error(`Error processing ${entry}: ${err.message}`);
      }
    }
  } catch (err: any) {
    console.error(`Error scanning folder: ${err.message}`);
  }
}

// --- Main ---

await ensureWatchFolder();

console.log(`\n  Transcriber Watcher`);
console.log(`  Watch folder: ${WATCH_FOLDER}`);
console.log(`  Output folder: ${OUTPUT_FOLDER}`);
console.log(`  Language: ${LANGUAGE}`);
console.log(`  Polling every ${POLL_INTERVAL / 1000}s\n`);

// Initial scan
await scanFolder();

// Poll for new files
setInterval(scanFolder, POLL_INTERVAL);
