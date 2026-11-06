import { afterEach, expect, mock, test } from "bun:test";
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, link, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildMarkdown, processRecording, writeUnique, type TranscriptionService } from "./watcher-core";
import { assemblyAIService } from "./watcher";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "transcriber-test-"));
  roots.push(root);
  const watchDirectory = join(root, "inbox"), outputDirectory = join(root, "output");
  await mkdir(watchDirectory);
  await mkdir(outputDirectory);
  const filePath = join(watchDirectory, "Recording.m4a");
  await writeFile(filePath, "synthetic-audio");
  const service = {
    upload: mock(async (_audio: Uint8Array) => "https://example.invalid/upload"),
    submit: mock(async (_url: string) => "job-test"),
    wait: mock(async (_id: string) => ({ text: "Fallback transcript", audio_duration: 12 })),
  } satisfies TranscriptionService;
  return { filePath, watchDirectory, outputDirectory, service };
}

test("plain text survives missing or empty diarization", () => {
  expect(buildMarkdown("test", { text: "Texto completo" })).toContain("Texto completo");
  expect(buildMarkdown("test", { text: "Texto completo", utterances: [] })).toContain("Texto completo");
  expect(buildMarkdown("test", {})).toContain("No se detectó voz.");
  expect(buildMarkdown("test", { text: "ignored", utterances: [{ speaker: "A", text: "Hola", start: 62000, end: 63000 }] })).toContain("**[01:02] A:** Hola");
});

test("exclusive filenames preserve existing content and concurrent collisions", async () => {
  const f = await fixture();
  await writeFile(join(f.outputDirectory, "Recording.md"), "original notes");
  const paths = await Promise.all([
    writeUnique(f.outputDirectory, "Recording.md", "first"),
    writeUnique(f.outputDirectory, "Recording.md", "second"),
  ]);
  expect(new Set(paths).size).toBe(2);
  expect(await readFile(join(f.outputDirectory, "Recording.md"), "utf8")).toBe("original notes");
  expect(await Promise.all(paths.map((path) => readFile(path, "utf8")))).toEqual(["first", "second"]);
});

test("processing preserves both a previous transcript and a same-name archived recording", async () => {
  const f = await fixture();
  await writeFile(join(f.outputDirectory, "Recording.md"), "private notes");
  const archive = join(f.watchDirectory, ".processed");
  await mkdir(archive);
  await writeFile(join(archive, "Recording.m4a"), "older recording");
  const result = await processRecording(f);
  expect(await readFile(join(f.outputDirectory, "Recording.md"), "utf8")).toBe("private notes");
  expect(await readFile(join(archive, "Recording.m4a"), "utf8")).toBe("older recording");
  expect(await readFile(result.archivePath, "utf8")).toBe("synthetic-audio");
  expect(await readFile(result.outputPath, "utf8")).toContain("Fallback transcript");
  expect(await Bun.file(f.filePath).exists()).toBe(false);
});

test("retry after output failure uses the completed job without upload or paid resubmission", async () => {
  const f = await fixture();
  await rm(f.outputDirectory, { recursive: true });
  await writeFile(f.outputDirectory, "blocking file");
  await expect(processRecording(f)).rejects.toThrow();
  expect(await readFile(f.filePath, "utf8")).toBe("synthetic-audio");
  await rm(f.outputDirectory);
  const result = await processRecording(f);
  expect(await readFile(result.outputPath, "utf8")).toContain("Fallback transcript");
  expect(f.service.upload).toHaveBeenCalledTimes(1);
  expect(f.service.submit).toHaveBeenCalledTimes(1);
  expect(f.service.wait).toHaveBeenCalledTimes(1);
});

test("retry after archive failure keeps the source and reuses the saved transcript", async () => {
  const f = await fixture();
  await writeFile(join(f.watchDirectory, ".processed"), "blocking file");
  await expect(processRecording(f)).rejects.toThrow();
  expect(await readFile(f.filePath, "utf8")).toBe("synthetic-audio");
  await rm(join(f.watchDirectory, ".processed"));
  await processRecording(f);
  expect((await readdir(f.outputDirectory)).filter((name) => name.endsWith(".md"))).toHaveLength(1);
  expect(f.service.submit).toHaveBeenCalledTimes(1);
});

test("polling retries resume the existing job, including across fresh service objects", async () => {
  const f = await fixture();
  f.service.wait.mockRejectedValueOnce(new Error("temporary polling error"));
  await expect(processRecording(f)).rejects.toThrow("temporary polling error");
  const fresh = { upload: mock(f.service.upload), submit: mock(f.service.submit), wait: mock(async () => ({ text: "Recovered" })) };
  const result = await processRecording({ ...f, service: fresh });
  expect(fresh.upload).toHaveBeenCalledTimes(0);
  expect(fresh.submit).toHaveBeenCalledTimes(0);
  expect(fresh.wait).toHaveBeenCalledWith("job-test");
  expect(await readFile(result.outputPath, "utf8")).toContain("Recovered");
});

test("an ambiguous submission outcome pauses instead of creating another paid job", async () => {
  const f = await fixture();
  f.service.submit.mockRejectedValueOnce(new Error("response lost"));
  await expect(processRecording(f)).rejects.toThrow("response lost");
  await expect(processRecording(f)).rejects.toThrow("Automatic resubmission is paused");
  expect(f.service.upload).toHaveBeenCalledTimes(1);
  expect(f.service.submit).toHaveBeenCalledTimes(1);
  expect(await readFile(f.filePath, "utf8")).toBe("synthetic-audio");
});

test("a source replaced during transcription is kept alongside the earlier archived bytes", async () => {
  const f = await fixture();
  f.service.wait.mockImplementationOnce(async () => {
    await writeFile(f.filePath, "newer recording");
    return { text: "earlier transcript", audio_duration: 1 };
  });
  await expect(processRecording(f)).rejects.toThrow("recording changed");
  expect(await readFile(f.filePath, "utf8")).toBe("newer recording");
  expect(await readFile(join(f.watchDirectory, ".processed", "Recording.m4a"), "utf8")).toBe("synthetic-audio");
  const result = await processRecording(f);
  expect(await readFile(result.archivePath, "utf8")).toBe("newer recording");
  expect(f.service.submit).toHaveBeenCalledTimes(2);
});

test("different recordings with the same name are processed independently", async () => {
  const f = await fixture();
  const first = await processRecording(f);
  await writeFile(f.filePath, "another recording");
  const second = await processRecording(f);
  expect(first.outputPath).not.toBe(second.outputPath);
  expect(first.archivePath).not.toBe(second.archivePath);
  expect(await readFile(first.archivePath, "utf8")).toBe("synthetic-audio");
  expect(await readFile(second.archivePath, "utf8")).toBe("another recording");
});

test("poll HTTP failures are reported immediately and no live requests occur", async () => {
  const request = mock(async () => new Response("service unavailable", { status: 503 })) as unknown as typeof fetch;
  const service = assemblyAIService("test-key", "es", request, async () => {});
  await expect(service.wait("test-job")).rejects.toThrow("HTTP 503");
  expect(request).toHaveBeenCalledTimes(1);
});

test("checkpoint parse errors preserve the source instead of starting a fresh paid job", async () => {
  const f = await fixture();
  f.service.wait.mockRejectedValueOnce(new Error("pause"));
  await expect(processRecording(f)).rejects.toThrow("pause");
  const dir = join(f.watchDirectory, ".transcriber-state");
  const state = (await readdir(dir))[0]!;
  await writeFile(join(dir, state), "broken JSON");
  await expect(processRecording(f)).rejects.toThrow();
  expect(f.service.submit).toHaveBeenCalledTimes(1);
  expect(await readFile(f.filePath, "utf8")).toBe("synthetic-audio");
});


test("a checkpoint archive replaced by a source symlink never permits source removal", async () => {
  const f = await fixture();
  f.service.wait.mockImplementationOnce(async () => {
    await writeFile(f.filePath, "temporary newer bytes");
    return { text: "saved transcript", audio_duration: 1 };
  });
  await expect(processRecording(f)).rejects.toThrow("recording changed");
  await writeFile(f.filePath, "synthetic-audio");
  const archive = join(f.watchDirectory, ".processed", "Recording.m4a");
  await rm(archive);
  await symlink(f.filePath, archive);
  await expect(processRecording(f)).rejects.toThrow("regular file");
  expect(await readFile(f.filePath, "utf8")).toBe("synthetic-audio");
  expect(await readFile(archive, "utf8")).toBe("synthetic-audio");
  expect(f.service.submit).toHaveBeenCalledTimes(1);
});

test("a separately named regular hardlink remains a valid archive after source removal", async () => {
  const f = await fixture();
  f.service.wait.mockImplementationOnce(async () => {
    await writeFile(f.filePath, "temporary newer bytes");
    return { text: "saved transcript", audio_duration: 1 };
  });
  await expect(processRecording(f)).rejects.toThrow("recording changed");
  await writeFile(f.filePath, "synthetic-audio");
  const archive = join(f.watchDirectory, ".processed", "Recording.m4a");
  await rm(archive);
  await link(f.filePath, archive);
  const result = await processRecording(f);
  expect(await readFile(result.archivePath, "utf8")).toBe("synthetic-audio");
  expect(await Bun.file(f.filePath).exists()).toBe(false);
  expect(f.service.submit).toHaveBeenCalledTimes(1);
});


test("async submission pins Universal-3.5 Pro with automatic language detection", async () => {
  let payload: Record<string, unknown> = {};
  const request = mock(async (_url: string | URL | Request, options?: RequestInit) => {
    payload = JSON.parse(String(options?.body));
    return Response.json({ id: "fixture-job" });
  }) as unknown as typeof fetch;
  await assemblyAIService("fixture-key", "auto", request).submit("https://example.invalid/audio");
  expect(payload.speech_models).toEqual(["universal-3-5-pro"]);
  expect(payload.language_detection).toBe(true);
  expect(payload.speaker_labels).toBe(true);
  expect(payload.language_code).toBeUndefined();
});

test("an explicit language remains supported without conflicting detection fields", async () => {
  let payload: Record<string, unknown> = {};
  const request = mock(async (_url: string | URL | Request, options?: RequestInit) => {
    payload = JSON.parse(String(options?.body));
    return Response.json({ id: "fixture-job" });
  }) as unknown as typeof fetch;
  await assemblyAIService("fixture-key", "es", request).submit("https://example.invalid/audio");
  expect(payload.language_code).toBe("es");
  expect(payload.language_detection).toBeUndefined();
  expect(payload.speech_models).toEqual(["universal-3-5-pro"]);
});

test("transcript metadata reports the returned model, not a hardcoded model claim", () => {
  const md = buildMarkdown("fixture", { text: "Hola", speech_model_used: "universal-3-5-pro", language_code: "es" });
  expect(md).toContain("**Modelo:** AssemblyAI universal-3-5-pro");
  expect(md).toContain("**Idioma detectado:** es");
  expect(buildMarkdown("fixture", { text: "Hola" })).toContain("no informado por el servicio");
  expect(buildMarkdown("fixture", { text: "Hola", speech_model_used: "universal-3-pro" })).toContain("**Modelo:** AssemblyAI universal-3-pro");
});
