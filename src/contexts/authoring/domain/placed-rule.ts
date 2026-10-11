import { RefusalError } from "./refusal";
import { cleanTermName, hasWordCharacter } from "./terms";
import type { TermId } from "./term-id";

export type PlacedRuleKind = "invariant" | "assertion";

/**
 * A Rule from a Feature placed on the DomainTerm it belongs to: one of the term's
 * invariants, which hold at all times, or an assertion on one of the term's operations.
 */
export interface PlacedRule {
  readonly kind: PlacedRuleKind;
  /** Short kebab-case key, unique within the term that holds the rule. */
  readonly key: string;
  /** The rule in the team's own words. */
  readonly statement: string;
  /** The operation an assertion is on; null for an invariant. */
  readonly operation: string | null;
}

export interface PlacedRuleDraft {
  kind: PlacedRuleKind;
  key: string;
  statement: string;
  operation: string;
}

export interface PlacedRuleProblems {
  key?: string;
  statement?: string;
  operation?: string;
}

// [ASSUMPTION] Prototype limits: a key is a short label, a statement one or two sentences.
export const MAX_RULE_KEY_LENGTH = 60;
export const MAX_STATEMENT_LENGTH = 500;
export const MAX_OPERATION_LENGTH = 80;

const RULE_KEY = /^[\p{Ll}\p{Lo}\p{N}]+(?:-[\p{Ll}\p{Lo}\p{N}]+)*$/u;
const LEADING_ARTICLES = new Set(["a", "an", "the"]);
const KEY_WORDS = 8;

/**
 * A key derived from a rule's text: its first words, lowercased and joined by hyphens,
 * without a leading article. "An Order always has a line" becomes "order-always-has-a-line".
 */
export function ruleKeyFrom(text: string): string {
  const words = text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const start = words.length > 1 && LEADING_ARTICLES.has(words[0]!) ? 1 : 0;
  return words.slice(start, start + KEY_WORDS).join("-");
}

export function isRuleKey(key: string): boolean {
  return RULE_KEY.test(key) && key.length <= MAX_RULE_KEY_LENGTH;
}

/** Everything wrong with a draft, by field; empty when it can be placed. */
export function placedRuleProblems(draft: PlacedRuleDraft): PlacedRuleProblems {
  const problems: PlacedRuleProblems = {};
  const key = draft.key.trim();
  if (key.length === 0) problems.key = "Enter a key.";
  else if (!RULE_KEY.test(key)) problems.key = "Write the key in lowercase words joined by hyphens, such as order-has-lines.";
  else if (key.length > MAX_RULE_KEY_LENGTH) problems.key = `Keep the key to ${MAX_RULE_KEY_LENGTH} characters or fewer.`;

  // Invariant has-a-statement.
  const statement = draft.statement.trim();
  if (statement.length === 0) problems.statement = "Enter the rule's statement.";
  else if (statement.length > MAX_STATEMENT_LENGTH) {
    problems.statement = `Keep the statement to ${MAX_STATEMENT_LENGTH} characters or fewer.`;
  }

  // Invariant assertion-names-its-operation.
  if (draft.kind === "assertion") {
    const operation = cleanTermName(draft.operation);
    if (operation.length === 0) problems.operation = "Name the operation this assertion is on.";
    else if (!hasWordCharacter(operation)) problems.operation = "An operation name needs at least one letter or digit.";
    else if (operation.length > MAX_OPERATION_LENGTH) {
      problems.operation = `Keep the operation name to ${MAX_OPERATION_LENGTH} characters or fewer.`;
    }
  }
  return problems;
}

/**
 * The construction door of a PlacedRule. It holds a nonempty statement, and an assertion
 * always names its operation; a draft that breaks either is refused.
 */
export function placedRuleOf(draft: PlacedRuleDraft): PlacedRule {
  const problems = placedRuleProblems(draft);
  for (const field of ["key", "statement", "operation"] as const) {
    const problem = problems[field];
    if (problem) throw new RefusalError(problem, field);
  }
  return Object.freeze({
    kind: draft.kind,
    key: draft.key.trim(),
    statement: draft.statement.trim(),
    operation: draft.kind === "assertion" ? cleanTermName(draft.operation) : null,
  });
}

/** How a rule reads in a sentence: "invariant" or "assertion on Classify". */
export function ruleLabel(rule: PlacedRule): string {
  return rule.kind === "invariant" ? "invariant" : `assertion on ${rule.operation}`;
}

/** A rule placed on, or removed from, a term, as one editor step reports it; its inverse undoes it. */
export interface RuleChange {
  kind: "placed" | "removed";
  termId: TermId;
  rule: PlacedRule;
}

export function inverseRuleChange(change: RuleChange): RuleChange {
  return { ...change, kind: change.kind === "placed" ? "removed" : "placed" };
}
