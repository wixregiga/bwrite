import { kindTitle, type TermKind } from "./term-kind";
import type { TermId } from "./term-id";
import { RefusalError } from "./refusal";

/**
 * A relationship a Classification records to another DomainTerm of the same language.
 * `context` is the bounded context a term belongs to, `aggregate` an Entity's owning
 * Aggregate, `identity` the identity Value Object of an Aggregate or Entity, and
 * `raisedBy` the Aggregate that raises a Domain Event.
 */
export type Relation = "context" | "aggregate" | "identity" | "raisedBy";

export const RELATION_NAMES: readonly Relation[] = ["context", "aggregate", "identity", "raisedBy"];

export interface RelationRule {
  relation: Relation;
  /** The field label. */
  label: string;
  /** How the relation reads in a sentence. */
  noun: string;
  /** The kind the related term must be classified as. */
  target: TermKind;
  help: string;
}

const CONTEXT: RelationRule = {
  relation: "context",
  label: "Bounded context",
  noun: "bounded context",
  target: "bounded_context",
  help: "The bounded context this term belongs to, when it belongs to one.",
};

/**
 * The relationships each kind takes, all optional. An Entity takes no bounded context of
 * its own: it is in its Aggregate's.
 */
export const RELATIONS: Readonly<Record<TermKind, readonly RelationRule[]>> = {
  bounded_context: [],
  aggregate: [
    CONTEXT,
    {
      relation: "identity",
      label: "Identity",
      noun: "identity",
      target: "value_object",
      help: "The Value Object that identifies the aggregate and its root entity, from the same bounded context.",
    },
  ],
  entity: [
    {
      relation: "aggregate",
      label: "Aggregate",
      noun: "Aggregate",
      target: "aggregate",
      help: "The Aggregate this entity belongs to. Its bounded context is the Aggregate's.",
    },
    {
      relation: "identity",
      label: "Local identity",
      noun: "local identity",
      target: "value_object",
      help: "The Value Object that tells this entity apart inside its Aggregate, when it has one worth naming.",
    },
  ],
  value_object: [CONTEXT],
  domain_event: [
    CONTEXT,
    {
      relation: "raisedBy",
      label: "Raised by",
      noun: "raising Aggregate",
      target: "aggregate",
      help: "The Aggregate whose operation raises this event, from the same bounded context.",
    },
  ],
  domain_service: [CONTEXT],
  specification: [CONTEXT],
};

export function relationRule(kind: TermKind, relation: Relation): RelationRule | undefined {
  return RELATIONS[kind].find((r) => r.relation === relation);
}

/**
 * A DomainTerm's kind and its relationships to other DomainTerms. It holds exactly the
 * relations its kind takes, each null until chosen. Two are equal when their kind and
 * relations are equal.
 */
export type Classification = { readonly kind: TermKind } & { readonly [R in Relation]?: TermId | null };

/**
 * The construction door of a Classification. Invariant placement-fits-the-kind: it holds
 * only the relations its kind takes, so a relation the kind does not take is refused.
 */
export function classificationOf(kind: TermKind, relations: Partial<Record<string, TermId | null>> = {}): Classification {
  const takes = RELATIONS[kind].map((r) => r.relation as string);
  for (const relation of Object.keys(relations)) {
    if (!takes.includes(relation)) {
      throw new RefusalError(`${kindTitle(kind)} takes no relation “${relation}”.`, relation);
    }
  }
  const classification: Record<string, unknown> = { kind };
  for (const relation of takes) classification[relation] = relations[relation] ?? null;
  return Object.freeze(classification) as Classification;
}

export function relationOf(classification: Classification, relation: Relation): TermId | null {
  return classification[relation] ?? null;
}

/** The relations a classification has chosen, as pairs, in the order its kind lists them. */
export function chosenRelations(classification: Classification): { rule: RelationRule; target: TermId }[] {
  return RELATIONS[classification.kind].flatMap((rule) => {
    const target = relationOf(classification, rule.relation);
    return target === null ? [] : [{ rule, target }];
  });
}

/** Changes the kind, keeping the bounded context when the new kind also takes one. */
export function withKind(previous: Classification | null, kind: TermKind | null): Classification | null {
  if (kind === null) return null;
  if (previous?.kind === kind) return previous;
  const keepsContext = relationRule(kind, "context") !== undefined && previous !== null;
  return classificationOf(kind, keepsContext ? { context: relationOf(previous, "context") } : {});
}

/** Sets one relation the classification's kind takes. */
export function withRelation(classification: Classification, relation: Relation, target: TermId | null): Classification {
  const { kind, ...relations } = classification;
  return classificationOf(kind, { ...relations, [relation]: target });
}

export function sameClassification(a: Classification | null, b: Classification | null): boolean {
  if (a === null || b === null) return a === b;
  return a.kind === b.kind && RELATION_NAMES.every((r) => relationOf(a, r) === relationOf(b, r));
}
