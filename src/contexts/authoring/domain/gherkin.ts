// Recognition of English Gherkin keywords at the start of a line.
// Shared by syntax styling and domain-term matching so both agree on
// which characters are Gherkin syntax rather than authored prose.

export type GherkinKeywordKind = "section" | "step";

export interface LineKeyword {
  /** Offset of the keyword within the line (after indentation). */
  from: number;
  /** Offset just past the keyword, including the trailing colon for sections. */
  to: number;
  kind: GherkinKeywordKind;
  /** The keyword as written, without its colon, such as "Rule" or "Given". */
  keyword: string;
}

// Longer keywords first so "Scenario Outline:" wins over "Scenario:".
const SECTION_KEYWORDS = [
  "Scenario Template",
  "Scenario Outline",
  "Background",
  "Scenarios",
  "Scenario",
  "Examples",
  "Example",
  "Feature",
  "Rule",
];

const STEP_KEYWORDS = ["Given", "When", "Then", "And", "But", "*"];

export function matchLineKeyword(line: string): LineKeyword | null {
  const indent = line.length - line.trimStart().length;
  const rest = line.slice(indent);
  for (const keyword of SECTION_KEYWORDS) {
    if (rest.startsWith(keyword) && rest.charAt(keyword.length) === ":") {
      return { from: indent, to: indent + keyword.length + 1, kind: "section", keyword };
    }
  }
  for (const keyword of STEP_KEYWORDS) {
    const next = rest.charAt(keyword.length);
    if (rest.startsWith(keyword) && (next === " " || next === "\t")) {
      return { from: indent, to: indent + keyword.length, kind: "step", keyword };
    }
  }
  return null;
}

/** Returns the doc string delimiter (`"""` or ```) that a line opens or closes, if any. */
export function docStringDelimiter(line: string): string | null {
  const rest = line.trimStart();
  if (rest.startsWith('"""')) return '"""';
  if (rest.startsWith("```")) return "```";
  return null;
}

/**
 * What one line of a feature body is. Bodies are free text, so a line that is not
 * Gherkin syntax is a note rather than an error, and a step keyword line is a statement
 * whether or not a Scenario encloses it.
 */
export type LineKind = "section" | "statement" | "note" | "comment" | "tag" | "table" | "docString" | "blank";

/** Classifies every line of `text`, in order. Lines are separated by "\n"; a trailing "\r" is ignored. */
export function lineKinds(text: string): LineKind[] {
  const kinds: LineKind[] = [];
  let openDocString: string | null = null;
  for (const raw of text.split("\n")) {
    const line = raw.replace(/\r$/, "");
    const delimiter = docStringDelimiter(line);
    if (openDocString !== null) {
      if (delimiter === openDocString) openDocString = null;
      kinds.push("docString");
      continue;
    }
    if (delimiter !== null) {
      openDocString = delimiter;
      kinds.push("docString");
      continue;
    }
    const rest = line.trimStart();
    const keyword = matchLineKeyword(line);
    if (rest.length === 0) kinds.push("blank");
    else if (rest.startsWith("#")) kinds.push("comment");
    else if (keyword) kinds.push(keyword.kind === "section" ? "section" : "statement");
    else if (/^@[^\s@]+(\s+@[^\s@]+)*\s*$/.test(rest)) kinds.push("tag");
    else if (rest.startsWith("|")) kinds.push("table");
    else kinds.push("note");
  }
  return kinds;
}

/**
 * A line that states one business rule under the Gherkin Rule keyword. `from` and `to`
 * delimit the rule's text after "Rule:", without surrounding spaces; they are equal when
 * nothing is written after the keyword yet. Offsets are into the whole text.
 */
export interface RuleLine {
  /** 1-based line number. */
  line: number;
  from: number;
  to: number;
  text: string;
}

/** The Rule line holding `pos`, or null when that line is not a Rule section (or sits in a doc string). */
export function ruleLineAt(text: string, pos: number): RuleLine | null {
  if (pos < 0 || pos > text.length) return null;
  const lineStart = text.lastIndexOf("\n", pos - 1) + 1;
  const newline = text.indexOf("\n", pos);
  const lineEnd = newline === -1 ? text.length : newline;
  const line = text.slice(lineStart, lineEnd).replace(/\r$/, "");
  const keyword = matchLineKeyword(line);
  if (keyword?.keyword !== "Rule") return null;
  const number = text.slice(0, lineStart).split("\n").length;
  if (lineKinds(text.slice(0, lineEnd))[number - 1] !== "section") return null;
  const rest = line.slice(keyword.to);
  const from = lineStart + keyword.to + (rest.length - rest.trimStart().length);
  const statement = rest.trim();
  return { line: number, from, to: from + statement.length, text: statement };
}
