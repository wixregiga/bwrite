// What a change set does to a canonical VocabularyDocument, whatever file keeps it. The rules
// follow arclint's own, so both formats agree on what a change takes with it:
//   removing a bounded context removes everything recorded in it, its questions, and the
//   relations that name it;
//   removing an Aggregate removes its Entities, and its Domain Events no longer name a raiser;
//   changing a term's kind removes the term as it was, with what goes with it, and records the
//   new one in its place;
//   renaming a term within its bounded context carries every reference to it along; moving an
//   Aggregate to another bounded context takes its Entities with it.

import { kindTitle, kindWithArticle } from "../domain/term-kind";
import type { TermKey, VocabularyChange, VocabularyDocument, VocabularyTerm } from "./vocabulary-document";
import { refuse } from "./problem";
import { findAggregate, findTerm, sameKey, sameName, termKeyOf } from "./vocabulary-shape";

export function describeKey(key: TermKey): string {
  return key.context === undefined ? key.name : `${key.name} in ${key.context}`;
}

/** "Aggregate Order in Sales", or "unclassified term Gift Wrap". */
export function describeTerm(term: VocabularyTerm, document: VocabularyDocument): string {
  const kind = term.kind ? kindTitle(term.kind) : "unclassified term";
  return `${kind} ${describeKey(termKeyOf(term, document))}`;
}

const COMPARED_FIELDS = ["name", "kind", "status", "context", "aggregate", "identity", "raisedBy", "aliases", "definition", "invariants", "assertions", "proposal"] as const;

/** The fields whose values differ between two versions of a term. */
export function changedFields(before: VocabularyTerm, after: VocabularyTerm): string[] {
  return COMPARED_FIELDS.filter((field) => JSON.stringify(before[field] ?? null) !== JSON.stringify(after[field] ?? null));
}

export function cloneDocument(document: VocabularyDocument): VocabularyDocument {
  return structuredClone(document);
}

/** The Aggregate an Entity belongs to, resolved by name. */
function ownerOf(document: VocabularyDocument, entity: VocabularyTerm): VocabularyTerm | undefined {
  return entity.aggregate === undefined ? undefined : findAggregate(document.terms, entity.aggregate);
}

function sameContext(a: string | undefined, b: string | undefined): boolean {
  return a === undefined || b === undefined ? a === b : sameName(a, b);
}

/** Removes `term` and what goes with it. */
function removeWithCascade(document: VocabularyDocument, term: VocabularyTerm): void {
  if (term.kind === "bounded_context") {
    const inside = (t: VocabularyTerm) =>
      t.kind === "entity" ? sameContext(ownerOf(document, t)?.context, term.name) : t.context !== undefined && sameName(t.context, term.name);
    document.terms = document.terms.filter((t) => t !== term && !inside(t));
    if (document.questions) document.questions = document.questions.filter((q) => q.context === undefined || !sameName(q.context, term.name));
    if (document.relations) document.relations = document.relations.filter((r) => !sameName(r.from, term.name) && !sameName(r.to, term.name));
    return;
  }
  if (term.kind === "aggregate") {
    document.terms = document.terms.filter((t) => t !== term && !(t.kind === "entity" && ownerOf(document, t) === term));
    for (const event of document.terms) {
      if (event.kind === "domain_event" && event.raisedBy !== undefined && sameName(event.raisedBy, term.name) && sameContext(event.context, term.context)) {
        delete event.raisedBy;
      }
    }
    return;
  }
  document.terms = document.terms.filter((t) => t !== term);
}

/** Carries references to `before` over to `after`, a term of the same kind under a new key. */
function carryReferences(document: VocabularyDocument, before: VocabularyTerm, after: VocabularyTerm): void {
  if (before.kind === "bounded_context") {
    for (const t of document.terms) if (t.context !== undefined && sameName(t.context, before.name)) t.context = after.name;
    for (const q of document.questions ?? []) if (q.context !== undefined && sameName(q.context, before.name)) q.context = after.name;
    for (const r of document.relations ?? []) {
      if (sameName(r.from, before.name)) r.from = after.name;
      if (sameName(r.to, before.name)) r.to = after.name;
    }
    return;
  }
  const moved = !sameContext(before.context, after.context);
  if (before.kind === "aggregate") {
    for (const t of document.terms) {
      if (t.kind === "entity" && ownerOf(document, t) === before) t.aggregate = after.name;
      if (t.kind === "domain_event" && t.raisedBy !== undefined && sameName(t.raisedBy, before.name) && sameContext(t.context, before.context)) {
        if (moved) delete t.raisedBy;
        else t.raisedBy = after.name;
      }
    }
    return;
  }
  if (before.kind === "value_object" && !moved) {
    for (const t of document.terms) {
      const context = t.kind === "entity" ? ownerOf(document, t)?.context : t.context;
      if (t.identity !== undefined && sameName(t.identity, before.name) && sameContext(context, before.context)) t.identity = after.name;
    }
  }
}

/** The term as a file keeps it: an Entity's context is its Aggregate's and is never written. */
function stored(term: VocabularyTerm): VocabularyTerm {
  const copy = structuredClone(term);
  if (copy.kind === "entity") delete copy.context;
  if (copy.status === "accepted") delete copy.status;
  return copy;
}

/** Applies one change in place. Refuses a change that names a term the document does not hold. */
export function applyChange(document: VocabularyDocument, change: VocabularyChange): void {
  if (change.type === "remove-term") {
    const index = findTerm(document, change.term);
    if (index < 0) throw refuse("invalid-request", `There is no term ${describeKey(change.term)} to remove.`);
    removeWithCascade(document, document.terms[index]);
    return;
  }
  const next = stored(change.term);
  const key = change.replaces ?? termKeyOf(next, document);
  const index = findTerm(document, key);
  if (index < 0) {
    if (change.replaces) throw refuse("invalid-request", `There is no term ${describeKey(change.replaces)} to replace.`);
    document.terms.push(next);
    return;
  }
  const before = document.terms[index];
  if (before.kind !== next.kind && !change.replaces) {
    throw refuse(
      "invalid-request",
      `${describeKey(key)} is already ${before.kind ? kindWithArticle(before.kind) : "an unclassified term"}; name it in replaces to change its kind.`,
    );
  }
  if (before.kind !== next.kind) {
    removeWithCascade(document, before);
    const at = Math.min(index, document.terms.length);
    document.terms.splice(at, 0, next);
    return;
  }
  if (!sameKey(termKeyOf(before, document), termKeyOf(next, document)) || before.name !== next.name) carryReferences(document, before, next);
  document.terms[document.terms.indexOf(before)] = next;
}

/** Applies the changes in order to a copy of `document`. */
export function applyChanges(document: VocabularyDocument, changes: readonly VocabularyChange[]): VocabularyDocument {
  const result = cloneDocument(document);
  for (const change of changes) applyChange(result, change);
  return result;
}
