// What an author should see recognized in a Feature's text, stated from the authoring
// context's recorded definition rather than read from BWrite's code, so the acceptance suites
// judge the page against the specification:
//   an accepted term's name or alias is recognized case-insensitively, as whole words, its words
//   separated by spaces or tabs but never a line break;
//   a phrase that names terms in several bounded contexts is not recognized;
//   a Gherkin keyword at the start of a line is syntax, except inside a doc string;
//   where occurrences overlap, the longest wins, then the earliest.

/** A term as the suites know it: its identity, its name, and its aliases. */
export interface NamedTerm {
  id: string;
  name: string;
  aliases?: readonly string[];
}

export interface RecognizedOccurrence {
  termId: string;
  from: number;
  to: number;
}

const WORD = "[\\p{L}\\p{M}\\p{N}_]";
const SECTIONS = ["Scenario Template", "Scenario Outline", "Background", "Scenarios", "Scenario", "Examples", "Example", "Feature", "Rule"];
const STEPS = ["Given", "When", "Then", "And", "But", "*"];

/** A name as an author would type it: composed, trimmed, its inner whitespace one space. */
function spelled(name: string): string {
  return name.normalize("NFC").trim().replace(/\s+/gu, " ");
}

/** The TermId a recorded term has: its bounded context and its name, compared without case. */
export function termIdFor(context: string | null | undefined, name: string): string {
  const part = (text: string) => encodeURIComponent(spelled(text).toLowerCase());
  return `term:${context ? part(context) : ""}/${part(name)}`;
}

/** Where the authored prose of a line starts: after a leading Gherkin keyword, if any. */
function proseStart(line: string): number {
  const indent = line.length - line.trimStart().length;
  const rest = line.slice(indent);
  const section = SECTIONS.find((k) => rest.startsWith(`${k}:`));
  if (section) return indent + section.length + 1;
  const step = STEPS.find((k) => rest.startsWith(k) && /^[ \t]/.test(rest.slice(k.length)));
  return step ? indent + step.length : 0;
}

function docStringFence(line: string): string | null {
  const rest = line.trimStart();
  return rest.startsWith('"""') ? '"""' : rest.startsWith("```") ? "```" : null;
}

/** Every recognized occurrence in `text`, in text order, with UTF-16 offsets. */
export function recognize(text: string, terms: readonly NamedTerm[]): RecognizedOccurrence[] {
  const owners = new Map<string, { phrase: string; ids: Set<string> }>();
  for (const term of terms) {
    for (const phrase of [term.name, ...(term.aliases ?? [])]) {
      const key = spelled(phrase).toLowerCase();
      const owner = owners.get(key) ?? { phrase: spelled(phrase), ids: new Set<string>() };
      owner.ids.add(term.id);
      owners.set(key, owner);
    }
  }
  const patterns = [...owners.values()]
    .filter((owner) => owner.ids.size === 1 && new RegExp(WORD, "u").test(owner.phrase))
    .map((owner) => ({
      termId: [...owner.ids][0]!,
      pattern: new RegExp(
        `(?<!${WORD})(?:${owner.phrase.split(" ").map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[^\\S\\r\\n]+")})(?!${WORD})`,
        "giu",
      ),
    }));

  const found: RecognizedOccurrence[] = [];
  let fence: string | null = null;
  let offset = 0;
  for (const raw of text.split("\n")) {
    const line = raw.replace(/\r$/, "");
    const delimiter = docStringFence(line);
    let start: number | null = null;
    if (fence !== null) {
      if (delimiter === fence) fence = null;
      else start = 0;
    } else if (delimiter !== null) {
      fence = delimiter;
    } else {
      start = proseStart(line);
    }
    if (start !== null) {
      const candidates: RecognizedOccurrence[] = [];
      for (const { termId, pattern } of patterns) {
        for (const m of line.matchAll(pattern)) {
          if (m.index >= start) candidates.push({ termId, from: m.index, to: m.index + m[0].length });
        }
      }
      candidates.sort((a, b) => b.to - b.from - (a.to - a.from) || a.from - b.from);
      const kept: RecognizedOccurrence[] = [];
      for (const c of candidates) if (kept.every((k) => c.to <= k.from || c.from >= k.to)) kept.push(c);
      kept.sort((a, b) => a.from - b.from);
      for (const k of kept) found.push({ termId: k.termId, from: offset + k.from, to: offset + k.to });
    }
    offset += raw.length + 1;
  }
  return found;
}
