// arclint's recorded domain, as `arclint domain list --format json` answers it, read into
// BWrite's canonical VocabularyDocument: each bounded context is a bounded_context term, each
// Aggregate an aggregate term followed by its Entities, then Value Objects, Domain Events,
// Domain Services and Specifications; the context map's relations pass through.

import type { TermKind } from "../domain/term-kind";
import type { VocabularyDocument, VocabularyRelation, VocabularyRule, VocabularyTerm, VocabularyAssertion } from "../application/vocabulary-document";

interface ArclintNamed {
  name: string;
  definition: string;
  aliases?: string[];
}
interface ArclintEntity extends ArclintNamed {
  identity?: string;
}
interface ArclintAggregate extends ArclintNamed {
  identity?: string;
  entities?: ArclintEntity[];
  invariants?: VocabularyRule[];
  assertions?: VocabularyAssertion[];
  repository?: string;
  factory?: string;
}
interface ArclintValueObject extends ArclintNamed {
  invariants?: VocabularyRule[];
}
interface ArclintEvent extends ArclintNamed {
  raisedBy?: string;
}
interface ArclintService extends ArclintNamed {
  assertions?: VocabularyAssertion[];
}
interface ArclintContext {
  name: string;
  definition: string;
  aggregates?: ArclintAggregate[];
  valueObjects?: ArclintValueObject[];
  events?: ArclintEvent[];
  services?: ArclintService[];
  specifications?: ArclintNamed[];
  questions?: { key: string; text: string }[];
}
export interface ArclintDomain {
  found: boolean;
  project: string;
  description?: string;
  source: string;
  contexts: ArclintContext[] | null;
  relations: VocabularyRelation[] | null;
}

/** What an Aggregate records beyond the canonical document, carried when a change re-records it. */
export interface AggregateExtras {
  repository?: string;
  factory?: string;
}

export function extrasKey(context: string | undefined, aggregate: string): string {
  return `${(context ?? "").toLowerCase()}\u0000${aggregate.toLowerCase()}`;
}

function named(item: ArclintNamed, kind: TermKind, context: string | undefined): VocabularyTerm {
  const term: VocabularyTerm = { name: item.name, kind, definition: item.definition ?? "" };
  if (context !== undefined) term.context = context;
  if (item.aliases && item.aliases.length > 0) term.aliases = [...item.aliases];
  return term;
}

/** Maps arclint's JSON onto the canonical document, in arclint's own order. */
export function documentFromArclint(domain: ArclintDomain): { document: VocabularyDocument; extras: Map<string, AggregateExtras> } {
  const extras = new Map<string, AggregateExtras>();
  const document: VocabularyDocument = { version: 1, project: domain.project, terms: [] };
  if (domain.description) document.description = domain.description;
  const questions: NonNullable<VocabularyDocument["questions"]> = [];
  for (const context of domain.contexts ?? []) {
    document.terms.push({ name: context.name, kind: "bounded_context", definition: context.definition ?? "" });
    for (const aggregate of context.aggregates ?? []) {
      const term = named(aggregate, "aggregate", context.name);
      if (aggregate.identity) term.identity = aggregate.identity;
      if (aggregate.invariants?.length) term.invariants = aggregate.invariants.map(({ key, statement }) => ({ key, statement }));
      if (aggregate.assertions?.length) term.assertions = aggregate.assertions.map(({ key, on, statement }) => ({ key, on, statement }));
      document.terms.push(term);
      extras.set(extrasKey(context.name, aggregate.name), { repository: aggregate.repository, factory: aggregate.factory });
      for (const entity of aggregate.entities ?? []) {
        const member = named(entity, "entity", undefined);
        member.aggregate = aggregate.name;
        if (entity.identity) member.identity = entity.identity;
        document.terms.push(member);
      }
    }
    for (const value of context.valueObjects ?? []) {
      const term = named(value, "value_object", context.name);
      if (value.invariants?.length) term.invariants = value.invariants.map(({ key, statement }) => ({ key, statement }));
      document.terms.push(term);
    }
    for (const event of context.events ?? []) {
      const term = named(event, "domain_event", context.name);
      if (event.raisedBy) term.raisedBy = event.raisedBy;
      document.terms.push(term);
    }
    for (const service of context.services ?? []) {
      const term = named(service, "domain_service", context.name);
      if (service.assertions?.length) term.assertions = service.assertions.map(({ key, on, statement }) => ({ key, on, statement }));
      document.terms.push(term);
    }
    for (const specification of context.specifications ?? []) document.terms.push(named(specification, "specification", context.name));
    for (const question of context.questions ?? []) questions.push({ context: context.name, key: question.key, text: question.text });
  }
  if (questions.length > 0) document.questions = questions;
  if (domain.relations && domain.relations.length > 0) {
    document.relations = domain.relations.map((r) => (r.description ? { from: r.from, to: r.to, kind: r.kind, description: r.description } : { from: r.from, to: r.to, kind: r.kind }));
  }
  return { document, extras };
}
