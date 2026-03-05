import type { TranscriptData } from "./types";

function formatTimestamp(ms: number): string {
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function formatMarkdown(
  data: TranscriptData,
  title: string,
  speakerNames: Record<string, string> = {}
): string {
  const mins = Math.floor(data.duration / 60);
  const secs = Math.floor(data.duration % 60);
  const speakers = [
    ...new Set(
      data.utterances.map((u) => speakerNames[u.speaker] || u.speaker)
    ),
  ];

  let md = `# Transcripción — ${title}\n`;
  md += `**Duración:** ${mins} minutos ${secs} segundos\n`;
  md += `**Modelo:** AssemblyAI universal-3-pro\n`;
  md += `**Participantes:** ${speakers.join(", ")}\n`;
  md += `**Fecha:** ${new Date().toISOString().split("T")[0]}\n\n---\n\n`;

  for (const u of data.utterances) {
    const ts = formatTimestamp(u.start);
    const name = speakerNames[u.speaker] || u.speaker;
    md += `**[${ts}] ${name}:** ${u.text}\n\n`;
  }

  return md;
}

export function getSpeakers(data: TranscriptData): string[] {
  return [...new Set(data.utterances.map((u) => u.speaker))].sort();
}
