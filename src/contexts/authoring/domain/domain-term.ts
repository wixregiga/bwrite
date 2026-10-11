import type { Classification } from "./classification";
import type { TermId } from "./term-id";
import type { TermProposal } from "./term-proposal";
import type { PlacedRule } from "./placed-rule";

// [ASSUMPTION] Length limits are prototype choices: a term name is a short noun
// phrase, and definitions are bounded to keep browser storage use predictable.
export const MAX_TERM_NAME_LENGTH = 80;
export const MAX_DEFINITION_LENGTH = 2000;

export type TermStatus = "accepted" | "proposed";

/**
 * A named concept in a Project's UbiquitousLanguage. An accepted term has an agreed
 * definition and is recognized in Features; a proposed term carries its TermProposal and
 * is never recognized as accepted. Its TermId stays the same while everything else changes.
 * It is reached only through its UbiquitousLanguage, which enforces what must hold of it.
 */
export interface DomainTerm {
  readonly id: TermId;
  readonly name: string;
  readonly definition: string;
  /** Other names the team uses for it; each is recognized in Features as the term. */
  readonly aliases: readonly string[];
  readonly status: TermStatus;
  /** Present exactly when the term is proposed. */
  readonly proposal: TermProposal | null;
  readonly classification: Classification | null;
  readonly rules: readonly PlacedRule[];
}
