import { ARCLINT_CONCEPTS, type ArcLintConcept } from "./arclint-concepts";

export function arclintConcept(type: string): ArcLintConcept {
  const concept = ARCLINT_CONCEPTS.find((c) => c.type === type);
  if (!concept) throw new Error(`ArcLint's vocabulary has no concept "${type}"`);
  return concept;
}

/**
 * The ArcLint concepts that name a term, and so can classify a DomainTerm. The keys are
 * ArcLint's own concept types. Their nesting follows `arclint domain schema`: a bounded
 * context holds aggregates, value objects, events, services, and specifications; an
 * aggregate holds its member entities.
 */
export const TERM_KINDS = [
  "bounded_context",
  "aggregate",
  "entity",
  "value_object",
  "domain_event",
  "domain_service",
  "specification",
] as const;

/** The Domain-Driven Design building block a DomainTerm is, as arclint defines it. */
export type TermKind = (typeof TERM_KINDS)[number];

export function isTermKind(value: unknown): value is TermKind {
  return (TERM_KINDS as readonly unknown[]).includes(value);
}

/** ArcLint concepts that are not term kinds, with the reason each is excluded. */
export const CONCEPTS_NOT_TERM_KINDS: Readonly<Record<string, string>> = {
  aggregate_root:
    "An Aggregate term stands for the aggregate and its root entity together: the aggregate's name is the root's name, and its identity is the root's. Classify the root as an Aggregate.",
  invariant: "A keyed rule placed on an Aggregate or a Value Object term, not a named term.",
  assertion: "A keyed guarantee placed on an operation of an Aggregate or a Domain Service term, not a named term.",
  business_rule: "An intake word that ArcLint resolves to an invariant or an assertion and never records itself.",
  question: "An open question recorded under a bounded context, not a named term.",
};

/** The levels of the hierarchy, outermost first, for presenting the kinds where they nest. */
export const KIND_LEVELS: readonly { label: string; kinds: readonly TermKind[] }[] = [
  { label: "Top level", kinds: ["bounded_context"] },
  { label: "In a bounded context", kinds: ["aggregate", "value_object", "domain_event", "domain_service", "specification"] },
  { label: "In an aggregate", kinds: ["entity"] },
];

/** Short visible labels for editor cues. Full names come from ArcLint's concept titles. */
const CUE_WORDS: Record<TermKind, string> = {
  bounded_context: "context",
  aggregate: "aggregate",
  entity: "entity",
  value_object: "value object",
  domain_event: "event",
  domain_service: "service",
  specification: "specification",
};

export function kindTitle(kind: TermKind): string {
  return arclintConcept(kind).title;
}

export function kindCue(kind: TermKind): string {
  return CUE_WORDS[kind];
}

export function articleFor(word: string): string {
  return /^[AEIOU]/i.test(word) ? "an" : "a";
}

/** "an Aggregate", "a Value Object". */
export function kindWithArticle(kind: TermKind): string {
  const title = kindTitle(kind);
  return `${articleFor(title)} ${title}`;
}
