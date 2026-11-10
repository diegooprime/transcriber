import index from "./index.html";
import { tmpdir } from "os";
import { join } from "path";
import { unlinkSync, writeFileSync } from "fs";
import { KEYTERM_MODELS, keyterms } from "./keyterms";

const AAI_KEY = process.env.ASSEMBLYAI_API_KEY!;
const PORT = Number(process.env.PORT) || 3456;

export const MAX_FILES = 20;

/** The speaker count AssemblyAI should expect, or undefined to let it decide. */
export function parseSpeakers(input: string | null): number | undefined {
  if (!input) return undefined;
  const n = Number(input);
  return Number.isFinite(n) && n >= 1 && n <= 20 ? n : undefined;
}

const VIDEO_EXTS = new Set(["mp4", "mkv", "mov", "avi", "webm", "flv", "wmv", "m4v", "3gp"]);

function isVideoFile(name: string): boolean {
  const ext = name.split(".").pop()?.toLowerCase() || "";
  return VIDEO_EXTS.has(ext);
}

async function extractAudio(file: File): Promise<{ buffer: Buffer<ArrayBuffer>; tmpPath?: string }> {
  if (!isVideoFile(file.name)) {
    return { buffer: Buffer.from(await file.arrayBuffer()) };
  }

  const tmpDir = tmpdir();
  const videoPath = join(tmpDir, `transcriber_vid_${Date.now()}_${Math.random().toString(36).slice(2)}.${file.name.split(".").pop()}`);
  const audioPath = videoPath.replace(/\.[^.]+$/, ".mp3");

  writeFileSync(videoPath, Buffer.from(await file.arrayBuffer()));

  try {
    const proc = Bun.spawn(
      ["ffmpeg", "-y", "-i", videoPath, "-vn", "-acodec", "libmp3lame", "-q:a", "2", audioPath],
      { stdout: "pipe", stderr: "pipe" }
    );

    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      const stderr = await new Response(proc.stderr).text();
      throw new Error(`ffmpeg audio extraction failed (exit ${exitCode}): ${stderr.slice(-200)}`);
    }

    let audioBuffer: Buffer<ArrayBuffer>;
    try {
      audioBuffer = Buffer.from(await Bun.file(audioPath).arrayBuffer());
    } catch (err) {
      try { unlinkSync(audioPath); } catch {}
      throw err;
    }
    return { buffer: audioBuffer, tmpPath: audioPath };
  } finally {
    try { unlinkSync(videoPath); } catch {}
  }
}

export async function concatenateAudio(files: File[]): Promise<Buffer<ArrayBuffer>> {
  // Extract audio from any video files first
  const extracted: { buffer: Buffer<ArrayBuffer>; tmpPath?: string }[] = [];
  try {
    for (const f of files) {
      extracted.push(await extractAudio(f));
    }

    // If single file, return directly (clean up tmp if it was a video extraction)
    if (extracted.length === 1) {
      const single = extracted[0]!;
      if (single.tmpPath) try { unlinkSync(single.tmpPath); } catch {}
      return single.buffer;
    }
  } catch (err) {
    // Cleanup extracted tmp files on error
    for (const e of extracted) {
      if (e.tmpPath) try { unlinkSync(e.tmpPath); } catch {}
    }
    throw err;
  }

  // Write extracted audio buffers to tmp for concat
  const tmpDir = tmpdir();
  const tmpFiles: string[] = [];

  try {
    for (let i = 0; i < extracted.length; i++) {
      const tmpPath = join(tmpDir, `transcriber_${Date.now()}_${i}.mp3`);
      writeFileSync(tmpPath, extracted[i]!.buffer);
      tmpFiles.push(tmpPath);
    }

    // Concatenate with ffmpeg's concat filter, which decodes each input on its own. The concat
    // demuxer assumes every file shares the first one's codec and, with exit code 0, drops the
    // audio of any that doesn't (an .opus after an .mp3, a .wav at another sample rate).
    const inputs = tmpFiles.flatMap((f) => ["-i", f]);
    const filter = tmpFiles.map((_, i) => `[${i}:a:0]`).join("") + `concat=n=${tmpFiles.length}:v=0:a=1[a]`;
    const outPath = join(tmpDir, `transcriber_merged_${Date.now()}.mp3`);
    const proc = Bun.spawn(
      ["ffmpeg", "-y", ...inputs, "-filter_complex", filter, "-map", "[a]", "-c:a", "libmp3lame", "-q:a", "2", outPath],
      { stdout: "pipe", stderr: "pipe" }
    );

    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      const stderr = await new Response(proc.stderr).text();
      throw new Error(`ffmpeg concat failed (exit ${exitCode}): ${stderr.slice(-200)}`);
    }

    const merged = await Bun.file(outPath).arrayBuffer();

    // Cleanup
    unlinkSync(outPath);
    return Buffer.from(merged);
  } finally {
    for (const f of tmpFiles) {
      try { unlinkSync(f); } catch {}
    }
    // Cleanup any video extraction tmp files
    for (const e of extracted) {
      if (e.tmpPath) try { unlinkSync(e.tmpPath); } catch {}
    }
  }
}

export async function handleTranscribe(req: Request): Promise<Response> {
  const formData = await req.formData();
  const files = formData.getAll("audio") as File[];
  const language = (formData.get("language") as string) || "es";
  const speakersExpected = formData.get("speakers_expected") as string | null;

  if (!files.length) {
    return Response.json({ error: "No files provided" }, { status: 400 });
  }

  if (files.length > MAX_FILES) {
    return Response.json({ error: `Too many files (max ${MAX_FILES})` }, { status: 400 });
  }

  try {
    // Step 1: Extract audio from videos (if any) + concatenate if multiple
    const audioBuffer = await concatenateAudio(files);

    // Step 2: Upload to AssemblyAI
    const uploadRes = await fetch("https://api.assemblyai.com/v2/upload", {
      method: "POST",
      headers: { Authorization: AAI_KEY },
      body: audioBuffer,
    });

    if (!uploadRes.ok) {
      console.error(`Upload failed: ${await uploadRes.text()}`);
      return Response.json({ error: "Audio upload failed" }, { status: 500 });
    }

    const { upload_url } = (await uploadRes.json()) as { upload_url: string };

    // Step 3: Create transcription with speaker labels
    const model = "universal-3-pro";
    const transcriptBody: Record<string, unknown> = {
      audio_url: upload_url,
      speaker_labels: true,
      language_code: language,
      speech_models: [model],
    };
    const terms = KEYTERM_MODELS.has(model) ? keyterms() : [];
    if (terms.length) transcriptBody.keyterms_prompt = terms; // his people, places and tools, spelled his way

    const speakers = parseSpeakers(speakersExpected);
    if (speakers !== undefined) transcriptBody.speakers_expected = speakers;

    const createRes = await fetch("https://api.assemblyai.com/v2/transcript", {
      method: "POST",
      headers: {
        Authorization: AAI_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(transcriptBody),
    });

    if (!createRes.ok) {
      console.error(`Transcription create failed: ${await createRes.text()}`);
      return Response.json({ error: "Transcription request failed" }, { status: 500 });
    }

    const { id } = (await createRes.json()) as { id: string };

    // Step 4: Poll until complete (max 10 min)
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
        return Response.json({
          status: "completed",
          utterances: data.utterances || [],
          duration: data.audio_duration || 0,
          text: data.text || "",
        });
      }

      if (data.status === "error") {
        console.error(`Transcription error: ${data.error}`);
        return Response.json({ error: "Transcription failed" }, { status: 500 });
      }
    }

    return Response.json({ error: "Transcription timed out" }, { status: 504 });
  } catch (err: any) {
    console.error("Transcription error:", err);
    return Response.json({ error: "Internal transcription error" }, { status: 500 });
  }
}

// Only serve when run directly, so tests can import this file.
if (import.meta.main) {
  Bun.serve({
    port: PORT,
    hostname: "127.0.0.1",
    maxRequestBodySize: 2 * 1024 * 1024 * 1024, // 2 GB
    routes: {
      "/": index,
    },
    fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/api/transcribe" && req.method === "POST") {
        return handleTranscribe(req);
      }
      return new Response("Not found", { status: 404 });
    },
    // Production by default (the service is reached through Tailscale Serve, which the dev
    // server's Host check blocks). DEV=1 for local HMR; `bun --hot` alone only reloads the server.
    development: process.env.DEV === "1" ? { hmr: true, console: true } : false,
  });

  console.log(`\n  🎙️  Transcriber running at http://localhost:${PORT}\n`);
}
