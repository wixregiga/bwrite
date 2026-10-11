import { docStringDelimiter, matchLineKeyword } from "./gherkin";

/** The fields of a term that recognition needs. Accepted terms only. */
export interface MatchableTerm {
  id: string;
  name: string;
  aliases?: readonly string[];
}

export interface TermMatch {
  termId: string;
  from: number;
  to: number;
}

/** Collapses whitespace and trims; the display form of a term name. */
export function cleanTermName(name: string): string {
  return name.normalize("NFC").trim().replace(/\s+/gu, " ");
}

/** Comparison key for detecting duplicate term names. */
export function normalizeTermName(name: string): string {
  return cleanTermName(name).toLowerCase();
}

const WORD_CHAR = "[\\p{L}\\p{M}\\p{N}_]";
const HAS_WORD_CHAR = new RegExp(WORD_CHAR, "u");

export function hasWordCharacter(text: string): boolean {
  return HAS_WORD_CHAR.test(text);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

interface CompiledTerm {
  id: string;
  pattern: RegExp;
}

function compilePhrase(id: string, phrase: string): CompiledTerm | null {
  const name = cleanTermName(phrase);
  if (!hasWordCharacter(name)) return null;
  // Words may be separated by any run of horizontal whitespace, never a line break.
  const body = name.split(" ").map(escapeRegExp).join("[^\\S\\r\\n]+");
  return {
    id,
    pattern: new RegExp(`(?<!${WORD_CHAR})(?:${body})(?!${WORD_CHAR})`, "giu"),
  };
}

/**
 * Every phrase that names exactly one term: each term's name and aliases. A phrase that names
 * terms in several bounded contexts is left out, so recognition never guesses between them;
 * an explicit TermReference on the occurrence decides which term it means.
 */
function compilePhrases(terms: readonly MatchableTerm[]): CompiledTerm[] {
  const owners = new Map<string, { phrase: string; ids: Set<string> }>();
  for (const term of terms) {
    for (const phrase of [term.name, ...(term.aliases ?? [])]) {
      const key = normalizeTermName(phrase);
      const entry = owners.get(key) ?? { phrase, ids: new Set<string>() };
      entry.ids.add(term.id);
      owners.set(key, entry);
    }
  }
  return [...owners.values()]
    .filter((entry) => entry.ids.size === 1)
    .map((entry) => compilePhrase([...entry.ids][0]!, entry.phrase))
    .filter((c): c is CompiledTerm => c !== null);
}

const compiledCache = new WeakMap<readonly MatchableTerm[], CompiledTerm[]>();

function compileTerms(terms: readonly MatchableTerm[]): CompiledTerm[] {
  let compiled = compiledCache.get(terms);
  if (!compiled) {
    compiled = compilePhrases(terms);
    compiledCache.set(terms, compiled);
  }
  return compiled;
}

/**
 * Finds accepted-term occurrences in a single line of text.
 * `excludeTo` marks a leading span (a Gherkin keyword) that matches may not overlap.
 * Overlapping candidates resolve to the longest, then the earliest.
 */
function matchLine(
  line: string,
  offset: number,
  compiled: readonly CompiledTerm[],
  excludeTo: number,
  out: TermMatch[],
): void {
  const candidates: TermMatch[] = [];
  for (const { id, pattern } of compiled) {
    pattern.lastIndex = 0;
    for (let m = pattern.exec(line); m; m = pattern.exec(line)) {
      if (m.index >= excludeTo) {
        candidates.push({ termId: id, from: m.index, to: m.index + m[0].length });
      }
    }
  }
  if (candidates.length === 0) return;

  candidates.sort((a, b) => b.to - b.from - (a.to - a.from) || a.from - b.from);
  const chosen: TermMatch[] = [];
  for (const c of candidates) {
    if (chosen.every((k) => c.to <= k.from || c.from >= k.to)) chosen.push(c);
  }
  chosen.sort((a, b) => a.from - b.from);
  for (const c of chosen) out.push({ termId: c.termId, from: offset + c.from, to: offset + c.to });
}

/**
 * Finds every occurrence of the given terms in feature text, case-insensitively and
 * at whole-term boundaries. Gherkin keywords at the start of a line are syntax, not
 * vocabulary usage, so they are never reported (inside doc strings they are prose).
 * Offsets are UTF-16 code unit offsets into `text`, sorted ascending.
 */
export function findTermMatches(text: string, terms: readonly MatchableTerm[]): TermMatch[] {
  const compiled = compileTerms(terms);
  const out: TermMatch[] = [];
  if (compiled.length === 0) return out;

  let openDocString: string | null = null;
  let lineStart = 0;
  while (lineStart <= text.length) {
    const newline = text.indexOf("\n", lineStart);
    const lineEnd = newline === -1 ? text.length : newline;
    const line = text.slice(lineStart, lineEnd).replace(/\r$/, "");

    const delimiter = docStringDelimiter(line);
    if (openDocString !== null) {
      if (delimiter === openDocString) openDocString = null;
      else matchLine(line, lineStart, compiled, 0, out);
    } else if (delimiter !== null) {
      openDocString = delimiter;
    } else {
      const keyword = matchLineKeyword(line);
      matchLine(line, lineStart, compiled, keyword ? keyword.to : 0, out);
    }

    if (newline === -1) break;
    lineStart = newline + 1;
  }
  return out;
}
