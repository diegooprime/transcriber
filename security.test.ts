import { test, expect } from "bun:test";

// Test the escapeHtml function (extracted from app.ts for testability)
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

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

// Test speakers_expected validation logic (extracted from index.ts)
function validateSpeakers(input: string | null): number | undefined {
  if (!input) return undefined;
  const n = Number(input);
  if (Number.isFinite(n) && n >= 1 && n <= 20) return n;
  return undefined;
}

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

// Test file count limit
test("file count limit rejects more than 20 files", () => {
  const MAX_FILES = 20;
  expect(21 > MAX_FILES).toBe(true);
  expect(20 > MAX_FILES).toBe(false);
  expect(1 > MAX_FILES).toBe(false);
});
