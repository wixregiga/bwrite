// Between a UbiquitousLanguage and the VocabularyDocument its VocabularyFile holds: building the
// language from the document, and stating a changed language as the VocabularyChanges that
// bring the file in step with it. Both directions are pure.

import type { TermKey, VocabularyAssertion, VocabularyChange, VocabularyDocument, VocabularyRule, VocabularyTerm } from "./vocabulary-document";
import { RELATIONS, classificationOf, relationOf, type Relation } from "../domain/classification";
import { type TermKind } from "../domain/term-kind";
import { termIdFor, type TermId } from "../domain/term-id";
import { type DomainTerm } from "../domain/domain-term";
import { featureIdOf, type FeatureId } from "../domain/feature-id";
import { placedRuleOf, type PlacedRule } from "../domain/placed-rule";
import type { ProjectId } from "../domain/project-id";
import { normalizeTermName } from "../domain/terms";
import { UbiquitousLanguage } from "../domain/ubiquitous-language";
import type { VocabularyFile } from "../domain/vocabulary-file";

/** What a Project's VocabularyFile holds as last read: the file, and its document when the file exists. */
export interface RecordedVocabulary {
  readonly file: VocabularyFile;
  /** Null when the folder has no VocabularyFile yet. */
  readonly document: VocabularyDocument | null;
}

/**
 * Everything one Project's language is built from: its VocabularyFile, the document the file
 * holds (null while there is no file), and the proposed terms BWrite keeps for the Project
 * itself because the file cannot hold them.
 */
export interface LanguageSource {
  readonly file: VocabularyFile;
  readonly document: VocabularyDocument | null;
  readonly localProposals: readonly VocabularyTerm[];
}

/** A language together with each of its terms as its source states it, by TermId. */
export interface BuiltLanguage {
  readonly source: LanguageSource;
  readonly language: UbiquitousLanguage;
  readonly recorded: ReadonlyMap<TermId, VocabularyTerm>;
}

/** What a changed language means for its sources. */
export interface LanguageEdit {
  /** The changes that bring the VocabularyFile in step, in the order they must be applied. */
  readonly changes: readonly VocabularyChange[];
  /** BWrite's own proposed terms afterwards; empty when the file holds proposals. */
  readonly localProposals: readonly VocabularyTerm[];
  /** Terms whose TermId changes because the change moved them to another bounded context. */
  readonly retargets: readonly (readonly [TermId, TermId])[];
}

/** Bounded contexts first, then what Aggregates name, then Aggregates, then what sits in or beside them. */
const KIND_RANK: Readonly<Record<TermKind, number>> = {
  bounded_context: 0,
  value_object: 1,
  aggregate: 2,
  entity: 3,
  domain_event: 4,
  domain_service: 5,
  specification: 6,
};

const sameName = (a: string, b: string) => normalizeTermName(a) === normalizeTermName(b);

/**
 * The Aggregate an Entity names. The document writes no bounded context on an Entity, so when
 * Aggregates in several bounded contexts share the name, the nearest one before the Entity in
 * the document is its Aggregate, the order every format writes an Aggregate and its Entities in.
 */
function aggregateIndexOf(terms: readonly VocabularyTerm[], index: number): number {
  const entity = terms[index]!;
  if (entity.aggregate === undefined) return -1;
  const candidates = terms.flatMap((t, i) => (t.kind === "aggregate" && sameName(t.name, entity.aggregate!) ? [i] : []));
  if (candidates.length <= 1) return candidates[0] ?? -1;
  return candidates.filter((i) => i < index).at(-1) ?? candidates[0]!;
}

/** The bounded context a document term's name is unique in: its own, or an Entity's Aggregate's. */
function keyContextOf(terms: readonly VocabularyTerm[], index: number): string | undefined {
  const term = terms[index]!;
  if (term.kind === "bounded_context") return undefined;
  if (term.kind === "entity") {
    const aggregate = aggregateIndexOf(terms, index);
    return aggregate < 0 ? undefined : terms[aggregate]!.context;
  }
  return term.context;
}

function keyOf(terms: readonly VocabularyTerm[], index: number): TermKey {
  const context = keyContextOf(terms, index);
  return context === undefined ? { name: terms[index]!.name } : { name: terms[index]!.name, context };
}

function sameKey(a: TermKey, b: TermKey): boolean {
  return sameName(a.name, b.name) && (a.context ?? "") === (b.context ?? "");
}

function rulesOf(term: VocabularyTerm): PlacedRule[] {
  return [
    ...(term.invariants ?? []).map((r) => placedRuleOf({ kind: "invariant", key: r.key, statement: r.statement, operation: "" })),
    ...(term.assertions ?? []).map((r) =>
      placedRuleOf({ kind: "assertion", key: r.key, statement: r.statement, operation: r.on }),
    ),
  ];
}

/**
 * Builds a Project's UbiquitousLanguage from its source. Each term's TermId comes from its
 * bounded context and name. A relation the document names is tied to the term of that name
 * and kind (a bounded context by name; an identity or raising Aggregate inside the term's own
 * bounded context); one that names no such term stays as the document wrote it and is
 * written back unchanged. Throws a RefusalError when the terms break an invariant.
 */
export function buildLanguage(projectId: ProjectId, source: LanguageSource): BuiltLanguage {
  const local = source.file.holdsProposals ? [] : source.localProposals;
  const all = [...(source.document?.terms ?? []), ...local];
  const ids = all.map((t, i) => termIdFor(keyContextOf(all, i), t.name));

  const find = (kind: TermKind, name: string | undefined, context: string | undefined | null): TermId | null => {
    if (name === undefined) return null;
    const index = all.findIndex(
      (t, i) => t.kind === kind && sameName(t.name, name) && (context === null || keyContextOf(all, i) === context),
    );
    return index < 0 ? null : ids[index]!;
  };

  const terms: DomainTerm[] = all.map((t, i) => {
    const context = keyContextOf(all, i);
    const relations: Partial<Record<Relation, TermId | null>> = {};
    if (t.kind) {
      for (const { relation } of RELATIONS[t.kind]) {
        if (relation === "context") relations.context = find("bounded_context", t.context, null);
        if (relation === "aggregate") {
          const aggregate = aggregateIndexOf(all, i);
          relations.aggregate = aggregate < 0 ? null : ids[aggregate]!;
        }
        if (relation === "identity") relations.identity = find("value_object", t.identity, context);
        if (relation === "raisedBy") relations.raisedBy = find("aggregate", t.raisedBy, context);
      }
    }
    return {
      id: ids[i]!,
      name: t.name,
      definition: t.definition,
      aliases: [...(t.aliases ?? [])],
      status: t.status === "proposed" ? "proposed" : "accepted",
      proposal: t.proposal
        ? { featureId: featureIdOf(t.proposal.featureId), text: t.proposal.text, proposedAt: t.proposal.proposedAt }
        : null,
      classification: t.kind ? classificationOf(t.kind, relations) : null,
      rules: rulesOf(t),
    };
  });

  return {
    source,
    language: new UbiquitousLanguage(projectId, source.file, terms),
    recorded: new Map(ids.map((id, i) => [id, all[i]!])),
  };
}

type RelationField = "context" | "aggregate" | "identity" | "raisedBy";

/**
 * One term of `language` as the document states it. `base` is the term as its source last
 * stated it and `baseTerm` the term as built from that, so a relation the source named but
 * the language could not tie to a term is written back as the source wrote it.
 */
function documentTermOf(
  language: UbiquitousLanguage,
  term: DomainTerm,
  base: VocabularyTerm | undefined,
  baseTerm: DomainTerm | undefined,
  featureTitle: (featureId: FeatureId) => string | null,
): VocabularyTerm {
  const c = term.classification;
  const kept = (field: RelationField): string | undefined => {
    if (!base || base[field] === undefined) return undefined;
    const before = baseTerm?.classification ?? null;
    if (c === null) return before === null && field === "context" ? base.context : undefined;
    return before?.kind === c.kind && relationOf(before, field as Relation) === null ? base[field] : undefined;
  };
  const named = (field: RelationField): string | undefined => {
    if (!c || !RELATIONS[c.kind].some((r) => r.relation === field)) return c === null ? kept(field) : undefined;
    return language.related(c, field)?.name ?? kept(field);
  };

  const invariants: VocabularyRule[] = term.rules
    .filter((r) => r.kind === "invariant")
    .map((r) => ({ key: r.key, statement: r.statement }));
  const assertions: VocabularyAssertion[] = term.rules
    .filter((r) => r.kind === "assertion")
    .map((r) => ({ key: r.key, statement: r.statement, on: r.operation! }));

  const out: VocabularyTerm = { name: term.name, definition: term.definition };
  if (c) out.kind = c.kind;
  const context = named("context");
  if (context !== undefined) out.context = context;
  const aggregate = named("aggregate");
  if (aggregate !== undefined) out.aggregate = aggregate;
  const identity = named("identity");
  if (identity !== undefined) out.identity = identity;
  const raisedBy = named("raisedBy");
  if (raisedBy !== undefined) out.raisedBy = raisedBy;
  if (term.status === "proposed") out.status = "proposed";
  if (term.aliases.length > 0) out.aliases = [...term.aliases];
  if (invariants.length > 0) out.invariants = invariants;
  if (assertions.length > 0) out.assertions = assertions;
  if (term.proposal) {
    const recordedTitle = base?.proposal?.featureId === term.proposal.featureId ? base.proposal.feature : null;
    out.proposal = {
      feature: recordedTitle ?? featureTitle(term.proposal.featureId) ?? "",
      featureId: term.proposal.featureId,
      text: term.proposal.text,
      proposedAt: term.proposal.proposedAt,
    };
  }
  return out;
}

/** Every term of `language` as the document states it, in the language's order. */
function documentTermsOf(
  built: BuiltLanguage,
  language: UbiquitousLanguage,
  featureTitle: (featureId: FeatureId) => string | null,
): VocabularyTerm[] {
  return language.terms.map((t) =>
    documentTermOf(language, t, built.recorded.get(t.id), built.language.term(t.id), featureTitle),
  );
}

const rank = (term: VocabularyTerm) => (term.kind ? KIND_RANK[term.kind] : -1);

/**
 * The edit that brings a Project's sources in step with `after`, a language one command made
 * from `built.language`. A term the file holds (an accepted one, or a proposed one when the
 * file holds proposals) that the command changed is put whole, naming the key it had when its
 * name, bounded context, or kind changed; a term that left the file is removed. Terms are put
 * in the order the file needs them: bounded contexts, Value Objects, Aggregates, then what sits
 * in or beside them, and removed in the reverse order. BWrite's own proposed terms are kept
 * apart when the file cannot hold them.
 */
export function languageEdit(
  built: BuiltLanguage,
  after: UbiquitousLanguage,
  featureTitle: (featureId: FeatureId) => string | null,
): LanguageEdit {
  const before = built.language;
  const holdsProposals = built.source.file.holdsProposals;
  const inFile = (t: DomainTerm) => t.status === "accepted" || holdsProposals;

  const beforeDocs = documentTermsOf(built, before, featureTitle);
  const afterDocs = documentTermsOf(built, after, featureTitle);
  const beforeIndex = new Map(before.terms.map((t, i) => [t.id, i]));

  const puts: { term: VocabularyTerm; replaces?: TermKey }[] = [];
  const removes: { key: TermKey; term: VocabularyTerm }[] = [];
  const retargets: [TermId, TermId][] = [];

  after.terms.forEach((t, i) => {
    const doc = afterDocs[i]!;
    const key = keyOf(afterDocs, i);
    const movedTo = termIdFor(key.context, key.name);
    if (movedTo !== t.id) retargets.push([t.id, movedTo]);
    if (!inFile(t)) return;
    const b = beforeIndex.get(t.id);
    if (b === undefined || !inFile(before.terms[b]!)) {
      puts.push({ term: doc });
      return;
    }
    const beforeDoc = beforeDocs[b]!;
    const beforeKey = keyOf(beforeDocs, b);
    // An Entity's bounded context is its Aggregate's and is never written: when its Aggregate
    // moves, the file moves the Entity with it, so only a change of the Entity's own entry counts.
    const movedWithItsAggregate = doc.kind === "entity" && beforeDoc.kind === "entity" && beforeDoc.aggregate === doc.aggregate;
    const rekeyed =
      (!movedWithItsAggregate && !sameKey(beforeKey, key)) || beforeDoc.kind !== doc.kind || beforeDoc.name !== doc.name;
    if (rekeyed) puts.push({ term: doc, replaces: beforeKey });
    else if (JSON.stringify(beforeDoc) !== JSON.stringify(doc)) puts.push({ term: doc });
  });

  before.terms.forEach((t, b) => {
    if (!inFile(t)) return;
    const now = after.term(t.id);
    if (!now || !inFile(now)) removes.push({ key: keyOf(beforeDocs, b), term: beforeDocs[b]! });
  });

  puts.sort((x, y) => rank(x.term) - rank(y.term));
  removes.sort((x, y) => rank(y.term) - rank(x.term));
  const changes: VocabularyChange[] = [
    ...removes.map(({ key }): VocabularyChange => ({ type: "remove-term", term: key })),
    ...puts.map(({ term, replaces }): VocabularyChange =>
      replaces ? { type: "put-term", term, replaces } : { type: "put-term", term },
    ),
  ];
  const localProposals = holdsProposals ? [] : afterDocs.filter((d) => d.status === "proposed");
  return { changes, localProposals, retargets };
}
