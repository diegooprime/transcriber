import { test, expect } from "bun:test";
import { escapeHtml } from "./escape";
import { MAX_FILES, handleTranscribe, parseSpeakers as validateSpeakers } from "./index";

test("escapeHtml escapes angle brackets", () => {
  expect(escapeHtml("<script>alert(1)</script>")).toBe(
    "&lt;script&gt;alert(1)&lt;/script&gt;"
  );
});

test("escapeHtml escapes quotes", () => {
  expect(escapeHtml('"><img src=x onerror=alert(1)>')).toBe(
    "&quot;&gt;&lt;img src=x onerror=alert(1)&gt;"
  );
});

test("escapeHtml escapes ampersands", () => {
  expect(escapeHtml("a&b")).toBe("a&amp;b");
});

test("escapeHtml handles single quotes", () => {
  expect(escapeHtml("it's")).toBe("it&#039;s");
});

test("escapeHtml passes through safe strings unchanged", () => {
  expect(escapeHtml("Speaker A")).toBe("Speaker A");
  expect(escapeHtml("[00:12] Hello world")).toBe("[00:12] Hello world");
});

test("escapeHtml handles empty string", () => {
  expect(escapeHtml("")).toBe("");
});

test("speakers validation accepts valid range", () => {
  expect(validateSpeakers("2")).toBe(2);
  expect(validateSpeakers("1")).toBe(1);
  expect(validateSpeakers("20")).toBe(20);
});

test("speakers validation rejects out of range", () => {
  expect(validateSpeakers("0")).toBeUndefined();
  expect(validateSpeakers("-1")).toBeUndefined();
  expect(validateSpeakers("21")).toBeUndefined();
  expect(validateSpeakers("999999")).toBeUndefined();
});

test("speakers validation rejects non-numbers", () => {
  expect(validateSpeakers("abc")).toBeUndefined();
  expect(validateSpeakers("NaN")).toBeUndefined();
  expect(validateSpeakers("Infinity")).toBeUndefined();
});

test("speakers validation handles null/empty", () => {
  expect(validateSpeakers(null)).toBeUndefined();
  expect(validateSpeakers("")).toBeUndefined();
});

// File count limit: rejected before any audio work or network call
async function post(count: number): Promise<Response> {
  const form = new FormData();
  for (let i = 0; i < count; i++) form.append("audio", new File(["x"], `${i}.mp3`));
  return handleTranscribe(new Request("http://localhost/api/transcribe", { method: "POST", body: form }));
}

test("file count limit rejects more than 20 files", async () => {
  expect(MAX_FILES).toBe(20);
  const res = await post(MAX_FILES + 1);
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ error: "Too many files (max 20)" });
});

test("a request without files is rejected", async () => {
  expect((await post(0)).status).toBe(400);
});
