import { test, expect } from "bun:test";
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { keyterms } from "./keyterms";

test("keyterms: dictionary order, limits, missing file", () => {
  const dir = mkdtempSync(join(tmpdir(), "keyterms-"));
  const f = join(dir, "dictionary.md");
  const many = Array.from({ length: 600 }, (_, i) => `- w${i} x`).join("\n");
  writeFileSync(f, `Intro, not a term.\n\n- Lis\n- Claude Code\n- lis\n- a b c d e f g\n${many}\n`);
  const t = keyterms(f);
  expect(t.slice(0, 3)).toEqual(["Lis", "Claude Code", "w0 x"]);
  expect(t.reduce((n, x) => n + x.split(" ").length, 0)).toBeLessThanOrEqual(1000);
  expect(keyterms(join(dir, "missing.md"))).toEqual([]);
});
