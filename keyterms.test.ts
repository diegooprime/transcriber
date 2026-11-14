import { test, expect } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { keyterms, namesCsvTerms } from "./keyterms";

test("keyterms: dictionary order, limits, missing files", () => {
  const dir = mkdtempSync(join(tmpdir(), "keyterms-"));
  try {
    const f = join(dir, "dictionary.md");
    const none = join(dir, "missing.csv");
    const many = Array.from({ length: 600 }, (_, i) => `- w${i} x`).join("\n");
    writeFileSync(f, `Intro, not a term.\n\n- Lis\n- Claude Code\n- lis\n- a b c d e f g\n${many}\n`);
    const t = keyterms(f, none);
    expect(t.slice(0, 3)).toEqual(["Lis", "Claude Code", "w0 x"]);
    expect(t.reduce((n, x) => n + x.split(" ").length, 0)).toBeLessThanOrEqual(1000);
    expect(keyterms(join(dir, "missing.md"), none)).toEqual([]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("keyterms: Atlas names follow the dictionary, deduplicated", () => {
  const dir = mkdtempSync(join(tmpdir(), "keyterms-"));
  try {
    const d = join(dir, "dictionary.md");
    const n = join(dir, "names.csv");
    writeFileSync(d, "- Tailscale\n- Lis Gutiérrez\n");
    writeFileSync(n, 'name,note,module\nLis Gutiérrez,Lis Gutiérrez,People\n"Rodríguez, Ana",Ana Rodríguez,People\nmamá,Lis Gutiérrez,People\n');
    expect(keyterms(d, n)).toEqual(["Tailscale", "Lis Gutiérrez", "Rodríguez, Ana", "mamá"]);
    expect(keyterms(join(dir, "none.md"), n)).toEqual(["Lis Gutiérrez", "Rodríguez, Ana", "mamá"]);
    expect(namesCsvTerms("note,module\nx,y\n")).toEqual([]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
