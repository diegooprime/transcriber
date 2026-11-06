import { readdir, lstat, mkdir } from "node:fs/promises";
import { join, extname, basename } from "node:path";
import { homedir } from "node:os";
import { processRecording, type Transcript, type TranscriptionService } from "./watcher-core";

const POLL_INTERVAL = 3000;
const STABILITY_DELAY = 3000;
const AUDIO_EXTS = new Set([".m4a", ".mp3", ".wav", ".caf", ".aac", ".ogg", ".webm", ".flac", ".opus", ".aiff", ".aif"]);
export const SPEECH_MODEL = "universal-3-5-pro";

export function assemblyAIService(key: string, language: string, request: typeof fetch = fetch, sleep = Bun.sleep): TranscriptionService {
  const headers = { Authorization: key };
  async function json(response: Response, operation: string) {
    if (!response.ok) throw new Error(`${operation} failed (HTTP ${response.status})`);
    return response.json();
  }
  return {
    async upload(audio) {
      const data = await json(await request("https://api.assemblyai.com/v2/upload", {
        method: "POST", headers, body: audio, signal: AbortSignal.timeout(120_000),
      }), "Upload") as { upload_url?: string };
      if (!data.upload_url) throw new Error("Upload returned no URL.");
      return data.upload_url;
    },
    async submit(url) {
      const data = await json(await request("https://api.assemblyai.com/v2/transcript", {
        method: "POST", headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({
          audio_url: url,
          speaker_labels: true,
          speech_models: [SPEECH_MODEL],
          ...(language === "auto" ? { language_detection: true } : { language_code: language }),
        }),
        signal: AbortSignal.timeout(30_000),
      }), "Transcription creation") as { id?: string };
      if (!data.id) throw new Error("Transcription returned no job ID.");
      return data.id;
    },
    async wait(id) {
      for (let i = 0; i < 200; i++) {
        await sleep(POLL_INTERVAL);
        const data = await json(await request(`https://api.assemblyai.com/v2/transcript/${encodeURIComponent(id)}`, {
          headers, signal: AbortSignal.timeout(30_000),
        }), "Transcription polling") as Transcript & { status: string; error?: string };
        if (data.status === "completed") return data;
        if (data.status === "error") throw new Error(`Transcription error: ${data.error ?? "Unknown service error"}`);
        if (data.status !== "queued" && data.status !== "processing") throw new Error("Unrecognized transcription status.");
      }
      throw new Error("Transcription is still pending. A later scan will resume the same job.");
    },
  };
}

async function isFileStable(filePath: string): Promise<boolean> {
  try {
    let previous = await lstat(filePath);
    for (let i = 0; i < 2; i++) {
      await Bun.sleep(STABILITY_DELAY);
      const current = await lstat(filePath);
      if (!current.isFile() || current.size === 0) return false;
      if (current.size !== previous.size || current.mtimeMs !== previous.mtimeMs) return false;
      previous = current;
    }
    return previous.isFile();
  } catch { return false; }
}

export async function main() {
  const key = process.env.ASSEMBLYAI_API_KEY;
  if (!key) throw new Error("ASSEMBLYAI_API_KEY is required. No files were processed.");
  const watchDirectory = process.env.WATCH_FOLDER || join(homedir(), "Desktop", "Transcriber");
  const outputDirectory = process.env.OUTPUT_FOLDER || join(homedir(), "Desktop");
  const language = process.env.TRANSCRIBE_LANG || "auto";
  const service = assemblyAIService(key, language);
  await mkdir(watchDirectory, { recursive: true });
  console.log(`Transcriber Watcher\nWatch folder: ${watchDirectory}\nOutput folder: ${outputDirectory}\nLanguage: ${language}\nModel: ${SPEECH_MODEL}`);
  const retryAfter = new Map<string, number>();
  // One scan at a time. The previous interval callback could overlap long jobs.
  for (;;) {
    try {
      for (const entry of await readdir(watchDirectory)) {
        if (entry.startsWith(".") || !AUDIO_EXTS.has(extname(entry).toLowerCase())) continue;
        const filePath = join(watchDirectory, entry);
        try {
          if ((retryAfter.get(filePath) ?? 0) > Date.now()) continue;
          if (!(await isFileStable(filePath))) continue;
          console.log(`Processing: ${basename(filePath)}`);
          const result = await processRecording({ filePath, outputDirectory, watchDirectory, service });
          retryAfter.delete(filePath);
          console.log(`Saved: ${result.outputPath}\nArchived: ${result.archivePath}`);
        } catch (error) {
          retryAfter.set(filePath, Date.now() + 60_000);
          console.error(`Could not finish ${entry}: ${(error as Error).message}`);
        }
      }
    } catch (error) { console.error(`Could not scan folder: ${(error as Error).message}`); }
    await Bun.sleep(POLL_INTERVAL);
  }
}

// Importing the service in tests never starts a watcher or accesses real folders.
if (import.meta.main) await main();
