import index from "./index.html";
import { tmpdir } from "os";
import { join } from "path";
import { unlinkSync, writeFileSync, existsSync } from "fs";

const AAI_KEY = process.env.ASSEMBLYAI_API_KEY!;
const PORT = Number(process.env.PORT) || 3456;

async function concatenateAudio(files: File[]): Promise<Buffer> {
  if (files.length === 1) {
    return Buffer.from(await files[0].arrayBuffer());
  }

  // Write all files to tmp
  const tmpDir = tmpdir();
  const tmpFiles: string[] = [];
  const listFile = join(tmpDir, `transcriber_concat_${Date.now()}.txt`);

  try {
    for (let i = 0; i < files.length; i++) {
      const ext = files[i].name.split(".").pop() || "m4a";
      const tmpPath = join(tmpDir, `transcriber_${Date.now()}_${i}.${ext}`);
      writeFileSync(tmpPath, Buffer.from(await files[i].arrayBuffer()));
      tmpFiles.push(tmpPath);
    }

    // Write ffmpeg concat list
    const listContent = tmpFiles.map((f) => `file '${f}'`).join("\n");
    writeFileSync(listFile, listContent);

    // Concatenate with ffmpeg
    const outPath = join(tmpDir, `transcriber_merged_${Date.now()}.mp3`);
    const proc = Bun.spawn(
      ["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", listFile, "-c:a", "libmp3lame", "-q:a", "2", outPath],
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
    // Cleanup tmp files
    for (const f of tmpFiles) {
      try { unlinkSync(f); } catch {}
    }
    try { unlinkSync(listFile); } catch {}
  }
}

Bun.serve({
  port: PORT,
  routes: {
    "/": index,
    "/api/transcribe": {
      POST: async (req) => {
        const formData = await req.formData();
        const files = formData.getAll("audio") as File[];
        const language = (formData.get("language") as string) || "es";
        const speakersExpected = formData.get("speakers_expected") as string | null;

        if (!files.length) {
          return Response.json({ error: "No audio files provided" }, { status: 400 });
        }

        try {
          // Step 1: Concatenate if multiple files
          const audioBuffer = await concatenateAudio(files);

          // Step 2: Upload to AssemblyAI
          const uploadRes = await fetch("https://api.assemblyai.com/v2/upload", {
            method: "POST",
            headers: { Authorization: AAI_KEY },
            body: audioBuffer,
          });

          if (!uploadRes.ok) {
            const err = await uploadRes.text();
            return Response.json({ error: `Upload failed: ${err}` }, { status: 500 });
          }

          const { upload_url } = (await uploadRes.json()) as { upload_url: string };

          // Step 3: Create transcription with speaker labels
          const transcriptBody: Record<string, unknown> = {
            audio_url: upload_url,
            speaker_labels: true,
            language_code: language,
            speech_models: ["universal-3-pro"],
          };

          if (speakersExpected) {
            transcriptBody.speakers_expected = Number(speakersExpected);
          }

          const createRes = await fetch("https://api.assemblyai.com/v2/transcript", {
            method: "POST",
            headers: {
              Authorization: AAI_KEY,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(transcriptBody),
          });

          if (!createRes.ok) {
            const err = await createRes.text();
            return Response.json({ error: `Transcription failed: ${err}` }, { status: 500 });
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
              return Response.json({ error: `Transcription error: ${data.error}` }, { status: 500 });
            }
          }

          return Response.json({ error: "Transcription timed out" }, { status: 504 });
        } catch (err: any) {
          return Response.json({ error: err.message || "Unknown error" }, { status: 500 });
        }
      },
    },
  },
  development: {
    hmr: true,
    console: true,
  },
});

console.log(`\n  🎙️  Transcriber running at http://localhost:${PORT}\n`);
