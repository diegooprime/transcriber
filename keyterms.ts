import { readFileSync } from "fs";
import { homedir } from "os";

// Diego's shared dictionary (vault Utility/Agents/dictionary.md): one "- term" per line, most important first.
// Read on every request so his edits apply without a restart. DBRAIN_DICTIONARY overrides the path.
const DICTIONARY_PATHS = [
  "/srv/dbrain/Utility/Agents/dictionary.md",
  `${homedir()}/Desktop/dbrain/Utility/Agents/dictionary.md`,
];
const MAX_WORDS_PER_TERM = 6; // AssemblyAI keyterms_prompt: at most 6 words a term
const MAX_WORDS = 1000; // and 1000 words in all (Universal-3 Pro / 3.5 Pro; Universal-2 takes 200)

// Speech models that accept keyterms_prompt.
export const KEYTERM_MODELS = new Set(["universal-3-pro", "universal-3-5-pro", "universal-2", "slam-1"]);

/** The dictionary's terms in its order, within AssemblyAI's limits; [] when the file is missing. */
export function keyterms(path = process.env.DBRAIN_DICTIONARY): string[] {
  let text: string | undefined;
  for (const p of path ? [path] : DICTIONARY_PATHS) {
    try {
      text = readFileSync(p, "utf8");
      break;
    } catch {}
  }
  if (text === undefined) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  let words = 0;
  for (const line of text.split("\n")) {
    if (!line.startsWith("- ")) continue;
    const t = line.slice(2).trim();
    const n = t.split(/\s+/).length;
    if (!t || n > MAX_WORDS_PER_TERM || seen.has(t.toLowerCase())) continue;
    if (words + n > MAX_WORDS) break;
    out.push(t);
    seen.add(t.toLowerCase());
    words += n;
  }
  return out;
}
