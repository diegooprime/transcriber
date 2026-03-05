import { readFileSync } from "fs";
import { getApiKey } from "./preferences";
import type { TranscriptData, TranscriptOptions } from "./types";

const BASE_URL = "https://api.assemblyai.com/v2";

function headers(json = false): Record<string, string> {
  const h: Record<string, string> = { Authorization: getApiKey() };
  if (json) h["Content-Type"] = "application/json";
  return h;
}

export async function uploadAudio(filePath: string): Promise<string> {
  const body = readFileSync(filePath);

  const res = await fetch(`${BASE_URL}/upload`, {
    method: "POST",
    headers: headers(),
    body,
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Upload failed: ${err}`);
  }

  const data = (await res.json()) as { upload_url: string };
  return data.upload_url;
}

export async function createTranscript(
  audioUrl: string,
  opts: TranscriptOptions
): Promise<string> {
  const body: Record<string, unknown> = {
    audio_url: audioUrl,
    speaker_labels: true,
    language_code: opts.language,
    speech_models: ["universal-3-pro"],
  };

  if (opts.speakersExpected && opts.speakersExpected > 0) {
    body.speakers_expected = opts.speakersExpected;
  }

  const res = await fetch(`${BASE_URL}/transcript`, {
    method: "POST",
    headers: headers(true),
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Transcript creation failed: ${err}`);
  }

  const data = (await res.json()) as { id: string };
  return data.id;
}

export async function pollTranscript(
  id: string,
  onStatus?: (status: string) => void
): Promise<TranscriptData> {
  const maxAttempts = 120;

  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, 3000));

    const res = await fetch(`${BASE_URL}/transcript/${id}`, {
      headers: headers(),
    });

    const data = (await res.json()) as {
      status: string;
      error?: string;
      utterances?: TranscriptData["utterances"];
      audio_duration?: number;
      text?: string;
    };

    onStatus?.(data.status);

    if (data.status === "completed") {
      return {
        utterances: data.utterances || [],
        duration: data.audio_duration || 0,
        text: data.text || "",
      };
    }

    if (data.status === "error") {
      throw new Error(`Transcription error: ${data.error}`);
    }
  }

  throw new Error("Transcription timed out after 6 minutes");
}

export async function transcribeFile(
  filePath: string,
  opts: TranscriptOptions,
  onProgress?: (phase: string) => void
): Promise<TranscriptData> {
  onProgress?.("Uploading audio...");
  const uploadUrl = await uploadAudio(filePath);

  onProgress?.("Creating transcription...");
  const id = await createTranscript(uploadUrl, opts);

  onProgress?.("Transcribing...");
  const result = await pollTranscript(id, (status) => {
    onProgress?.(`Transcribing... (${status})`);
  });

  onProgress?.("Done!");
  return result;
}
