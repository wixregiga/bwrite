import { kindCue, kindTitle } from "./term-kind";
import { readingProblem, type Reading, type TermReference } from "./term-reference";
import type { TermId } from "./term-id";
import { ruleLabel } from "./placed-rule";
import type { UbiquitousLanguage } from "./ubiquitous-language";
import { cleanTermName, findTermMatches, hasWordCharacter, type MatchableTerm } from "./terms";

export const MAX_WORDING_LENGTH = 200;

/** A reference before it has a range: the term it ties to and how the occurrence reads. */
export interface ReferenceDraft {
  termId: TermId | null;
  reading: Reading;
}

export interface ReferenceDraftErrors {
  term?: string;
  value?: string;
}

/** Checks a draft for the association dialog against the language as it is now. */
export function referenceDraftErrors(draft: ReferenceDraft, language: UbiquitousLanguage): ReferenceDraftErrors {
  const errors: ReferenceDraftErrors = {};
  const term = draft.termId === null ? undefined : language.term(draft.termId);
  if (!term) errors.term = "Choose the term this text refers to.";
  if (draft.reading.kind === "value") {
    if (term && term.classification?.kind !== "value_object") {
      errors.term = `A value belongs to a Value Object; “${term.name}” is not classified as one.`;
    }
    const problem = readingProblem(draft.reading);
    if (problem) errors.value = problem;
  }
  return errors;
}

/** The references other than those overlapping `[from, to)`, with `next` added in order. */
export function withReference(
  references: readonly TermReference[],
  from: number,
  to: number,
  next: TermReference | null,
): TermReference[] {
  const kept = references.filter((r) => r.to <= from || r.from >= to);
  if (next) kept.push(next);
  return kept.sort((a, b) => a.from - b.from);
}

export function overlappingReferences(references: readonly TermReference[], from: number, to: number): TermReference[] {
  return references.filter((r) => r.from < to && r.to > from);
}

/** A domain usage in feature text: an accepted term found by name, or an explicit reference. */
export type DomainUsage =
  | { kind: "recognized"; termId: TermId; from: number; to: number }
  | { kind: "reference"; termId: TermId; from: number; to: number; reference: TermReference };

/**
 * Every domain usage in `text`, sorted by position. An explicit reference decides the
 * meaning of its own range, so a name match overlapping it is dropped; matches elsewhere,
 * including other text spelled the same, are unaffected.
 */
export function resolveUsages(
  text: string,
  acceptedTerms: readonly MatchableTerm[],
  references: readonly TermReference[],
): DomainUsage[] {
  const usages: DomainUsage[] = references.map((reference) => ({
    kind: "reference",
    termId: reference.termId,
    from: reference.from,
    to: reference.to,
    reference,
  }));
  for (const m of findTermMatches(text, acceptedTerms)) {
    if (overlappingReferences(references, m.from, m.to).length === 0) {
      usages.push({ kind: "recognized", termId: m.termId as TermId, from: m.from, to: m.to });
    }
  }
  return usages.sort((a, b) => a.from - b.from);
}

/** The usage covering `pos`, treating both ends as inside. */
export function usageAt(usages: readonly DomainUsage[], pos: number): DomainUsage | null {
  for (const u of usages) {
    if (u.from > pos) break;
    if (pos <= u.to) return u;
  }
  return null;
}

/**
 * The visible editor cue for a reference: the term's kind, which Value Object a value
 * belongs to, or which rule of which term a Rule line states.
 */
export function referenceCue(reference: TermReference, language: UbiquitousLanguage): string {
  const term = language.term(reference.termId);
  if (!term) return "missing term";
  const reading = reference.reading;
  if (reading.kind === "value") return `value · ${term.name}`;
  if (reading.kind === "rule") {
    const rule = language.rule(term.id, reading.ruleKey);
    if (!rule) return `rule of ${term.name}`;
    return rule.kind === "invariant" ? `invariant of ${term.name}` : `assertion of ${term.name} on ${rule.operation}`;
  }
  return term.classification ? kindCue(term.classification.kind) : "term";
}

/**
 * The word shown with a reference's badge so its reading is not told by color alone:
 * "value" for a value of a Value Object, "invariant" or "assertion" for a placed rule.
 * Null when the occurrence simply names its term.
 */
export function readingWord(reference: TermReference, language: UbiquitousLanguage): string | null {
  const reading = reference.reading;
  if (reading.kind === "names") return null;
  if (reading.kind === "value") return "value";
  return language.rule(reference.termId, reading.ruleKey)?.kind ?? "rule";
}

/** A sentence describing what a reference says, for popovers and assistive technology. */
export function describeReference(reference: TermReference, language: UbiquitousLanguage): string {
  const term = language.term(reference.termId);
  if (!term) return "Refers to a term that is no longer in this Ubiquitous Language.";
  const kind = term.classification ? kindTitle(term.classification.kind) : "unclassified term";
  const reading = reference.reading;
  if (reading.kind === "value") return `Value “${cleanTermName(reading.value)}” of ${term.name} (${kind}).`;
  if (reading.kind === "rule") {
    const rule = language.rule(term.id, reading.ruleKey);
    if (!rule) return `States a rule of ${term.name} that is no longer placed.`;
    return `States ${ruleLabel(rule)} “${rule.key}” of ${term.name} (${kind}).`;
  }
  return `Names ${term.name} (${kind}).`;
}

export interface WordingOption {
  id: "keep" | "name" | "value" | "qualified";
  label: string;
  text: string;
}

/**
 * Wordings an author may choose to replace the selected text with. "keep" is always first
 * and changes nothing. The qualified name is offered only when it differs from the plain
 * wording, which is the term's name, or the value for a value reading.
 */
export function wordingOptions(draft: ReferenceDraft, current: string, language: UbiquitousLanguage): WordingOption[] {
  const options: WordingOption[] = [{ id: "keep", label: "Keep the text as written", text: current }];
  const term = draft.termId === null ? undefined : language.term(draft.termId);
  if (!term || draft.reading.kind === "rule") return options;

  const value = draft.reading.kind === "value" ? cleanTermName(draft.reading.value) : null;
  if (value !== null && value.length === 0) return options;
  const plain = value ?? term.name;
  options.push(value !== null ? { id: "value", label: "The value", text: value } : { id: "name", label: "The term's name", text: plain });

  const qualified = language.qualifiedName(term.id, value).text;
  if (qualified !== plain) options.push({ id: "qualified", label: "Qualified name", text: qualified });

  // Drop choices identical to the text already there.
  return options.filter((o, i) => i === 0 || o.text !== current);
}

/** Problems with replacement wording; the same rules a reference range follows. */
export function wordingError(text: string): string | undefined {
  if (text.trim().length === 0) return "Enter the wording to use.";
  if (/[\r\n]/.test(text)) return "Keep the wording on one line.";
  if (!hasWordCharacter(text)) return "The wording needs at least one letter or digit.";
  if (text.length > MAX_WORDING_LENGTH) return `Keep the wording to ${MAX_WORDING_LENGTH} characters or fewer.`;
  return undefined;
}

export interface ReplacementPreview {
  before: string;
  removed: string;
  inserted: string;
  after: string;
}

/** The line holding `[from, to)` split around the replacement, for showing before applying it. */
export function replacementPreview(text: string, from: number, to: number, inserted: string): ReplacementPreview {
  const lineStart = text.lastIndexOf("\n", from - 1) + 1;
  const lineEndIndex = text.indexOf("\n", to);
  const lineEnd = lineEndIndex === -1 ? text.length : lineEndIndex;
  return {
    before: text.slice(lineStart, from).trimStart(),
    removed: text.slice(from, to),
    inserted,
    after: text.slice(to, lineEnd).trimEnd(),
  };
}

/** The 1-based line number of `pos` in `text`. */
export function lineNumberAt(text: string, pos: number): number {
  return text.slice(0, pos).split("\n").length;
}
