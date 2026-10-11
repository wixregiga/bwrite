import type { TermId } from "./term-id";
import { isRuleKey } from "./placed-rule";
import { RefusalError } from "./refusal";
import { cleanTermName, hasWordCharacter } from "./terms";

// [ASSUMPTION] Prototype limit, matching the term name limit: a value is a short label.
export const MAX_VALUE_LENGTH = 80;

/**
 * How an occurrence is read: as naming its term, as one value of a Value Object term
 * ("shipped" as a value of Order Status), or as stating one of the term's PlacedRules.
 */
export type Reading =
  | { readonly kind: "names" }
  | { readonly kind: "value"; readonly value: string }
  | { readonly kind: "rule"; readonly ruleKey: string };

/**
 * One occurrence of text in a Feature tied on purpose to the DomainTerm it means. It
 * applies to that occurrence only, never to other text spelled the same. Offsets are
 * UTF-16 offsets into the feature text, and the range never spans a line break.
 */
export interface TermReference {
  readonly from: number;
  readonly to: number;
  readonly termId: TermId;
  readonly reading: Reading;
}

/** The text a reference ranges over: a string, or an editor document seen the same way. */
export interface TextSource {
  readonly length: number;
  slice(from: number, to: number): string;
}

function sourceOf(text: string | TextSource): TextSource {
  return typeof text === "string" ? { length: text.length, slice: (from, to) => text.slice(from, to) } : text;
}

/** True when `[from, to)` is nonempty, inside `text`, on one line, and contains a word character. */
export function isReferenceRange(text: string | TextSource, from: number, to: number): boolean {
  const source = sourceOf(text);
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to > source.length || from >= to) return false;
  const slice = source.slice(from, to);
  return !/[\r\n]/.test(slice) && hasWordCharacter(slice);
}

/** What is wrong with a reading on its own, or undefined when it is well formed. */
export function readingProblem(reading: Reading): string | undefined {
  if (reading.kind === "value") {
    const value = cleanTermName(reading.value);
    if (value.length === 0) return "Enter the value this text stands for.";
    if (value.length > MAX_VALUE_LENGTH) return `Keep the value to ${MAX_VALUE_LENGTH} characters or fewer.`;
  }
  if (reading.kind === "rule" && !isRuleKey(reading.ruleKey)) return "A rule reading names the key of a placed rule.";
  return undefined;
}

/**
 * The construction door of a TermReference. The range must be one line of `text` with a
 * word in it, and the reading well formed; anything else is refused.
 */
export function termReferenceOf(
  text: string | TextSource,
  from: number,
  to: number,
  termId: TermId,
  reading: Reading,
): TermReference {
  if (!isReferenceRange(text, from, to)) {
    throw new RefusalError("A reference covers a word or phrase on one line of the feature.");
  }
  const problem = readingProblem(reading);
  if (problem) throw new RefusalError(problem);
  const frozen: Reading =
    reading.kind === "value" ? { kind: "value", value: cleanTermName(reading.value) } : { ...reading };
  return Object.freeze({ from, to, termId, reading: Object.freeze(frozen) });
}

export function sameReading(a: Reading, b: Reading): boolean {
  if (a.kind === "value" && b.kind === "value") return a.value === b.value;
  if (a.kind === "rule" && b.kind === "rule") return a.ruleKey === b.ruleKey;
  return a.kind === b.kind;
}

/** The rule key a reference states, or null when it does not state a rule. */
export function ruleKeyOf(reference: TermReference): string | null {
  return reference.reading.kind === "rule" ? reference.reading.ruleKey : null;
}
