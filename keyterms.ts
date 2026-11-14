import { existsSync, readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

// Diego's spellings, read on every request so his edits apply without a restart:
// 1. the dictionary (vault System/Lookups/dictionary.md): one "- term" per line, most important first;
// 2. the names Atlas computes from every note's first line (vault System/Atlas/names.csv, column `name`,
//    most-linked in 90 days first).
// DBRAIN_VAULT picks the vault; DBRAIN_DICTIONARY and DBRAIN_NAMES override either file.
const VAULT =
  process.env.DBRAIN_VAULT || (existsSync("/srv/dbrain") ? "/srv/dbrain" : join(homedir(), "Desktop/dbrain"));
export const DICTIONARY_PATH = join(VAULT, "System/Lookups/dictionary.md");
export const NAMES_PATH = join(VAULT, "System/Atlas/names.csv");
const MAX_WORDS_PER_TERM = 6; // AssemblyAI keyterms_prompt: at most 6 words a term
const MAX_WORDS = 1000; // and 1000 words in all (Universal-3 Pro / 3.5 Pro; Universal-2 takes 200)

// Speech models that accept keyterms_prompt.
export const KEYTERM_MODELS = new Set(["universal-3-pro", "universal-3-5-pro", "universal-2", "slam-1"]);

function read(p: string): string | undefined {
  try {
    return readFileSync(p, "utf8");
  } catch {
    return undefined;
  }
}

/** The `- term` lines of the dictionary, in order. */
export function dictionaryTerms(text: string): string[] {
  return text
    .split("\n")
    .filter((l) => l.startsWith("- "))
    .map((l) => l.slice(2).trim());
}

/** The `name` column of Atlas's names.csv, in order (RFC 4180 quoting). */
export function namesCsvTerms(text: string): string[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') (cell += '"'), i++;
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") row.push(cell), (cell = "");
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell), rows.push(row), (row = []), (cell = "");
    } else cell += c;
  }
  if (cell || row.length) row.push(cell), rows.push(row);
  const col = rows[0]?.map((h) => h.trim().replace(/^﻿/, "")).indexOf("name") ?? -1;
  if (col < 0) return [];
  return rows.slice(1).map((r) => (r[col] ?? "").trim());
}

/** Dictionary terms, then Atlas names, deduplicated without case, within AssemblyAI's limits; [] when both are missing. */
export function keyterms(
  dictionary = process.env.DBRAIN_DICTIONARY || DICTIONARY_PATH,
  names = process.env.DBRAIN_NAMES || NAMES_PATH,
): string[] {
  const d = read(dictionary);
  const n = read(names);
  const candidates = [...(d ? dictionaryTerms(d) : []), ...(n ? namesCsvTerms(n) : [])];
  const out: string[] = [];
  const seen = new Set<string>();
  let words = 0;
  for (const t of candidates) {
    const k = t.split(/\s+/).length;
    if (!t || k > MAX_WORDS_PER_TERM || seen.has(t.toLowerCase())) continue;
    if (words + k > MAX_WORDS) break;
    out.push(t);
    seen.add(t.toLowerCase());
    words += k;
  }
  return out;
}
