import { test, expect } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { concatenateAudio } from "./index";

async function ffmpeg(...args: string[]): Promise<string> {
  const proc = Bun.spawn(["ffmpeg", "-hide_banner", "-y", ...args], { stdout: "pipe", stderr: "pipe" });
  const [stderr, code] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
  if (code !== 0) throw new Error(stderr.slice(-300));
  return stderr;
}

/** A mono 16-bit WAV tone, built by hand so the test needs ffmpeg as little as possible. */
function wav(seconds: number, rate: number): Uint8Array<ArrayBuffer> {
  const n = seconds * rate;
  const view = new DataView(new ArrayBuffer(44 + n * 2));
  const ascii = (at: number, s: string) => [...s].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
  ascii(0, "RIFF"); view.setUint32(4, 36 + n * 2, true); ascii(8, "WAVEfmt ");
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  ascii(36, "data"); view.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) view.setInt16(44 + i * 2, Math.sin((2 * Math.PI * 440 * i) / rate) * 12000, true);
  return new Uint8Array(view.buffer);
}

test("stitching keeps every file's audio, whatever the formats", async () => {
  const dir = mkdtempSync(join(tmpdir(), "stitch-"));
  try {
    const wide = new File([wav(3, 48000)], "a.wav");
    const narrow = new File([wav(2, 8000)], "c.wav");
    await Bun.write(join(dir, "b.wav"), wav(4, 48000));
    await ffmpeg("-i", join(dir, "b.wav"), "-c:a", "libopus", join(dir, "b.opus"));
    const opus = new File([await Bun.file(join(dir, "b.opus")).arrayBuffer()], "b.opus"); // WhatsApp voice notes

    const merged = join(dir, "merged.mp3");
    await Bun.write(merged, await concatenateAudio([wide, opus, narrow]));

    // Seconds that actually decode, not what the header claims.
    const log = await ffmpeg("-i", merged, "-f", "null", "-");
    const [, h, m, s] = [...log.matchAll(/time=(\d+):(\d+):([\d.]+)/g)].pop()!;
    expect(Number(h) * 3600 + Number(m) * 60 + Number(s)).toBeCloseTo(9, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 60_000);
