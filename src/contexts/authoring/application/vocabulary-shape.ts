// Strict reading of untrusted values into the canonical VocabularyDocument shapes. Every
// failure names where it is, as a path inside the value (`terms[3].kind`), so BWrite's file
// and the page's requests are refused with a message that points at the offending field.

import { TERM_KINDS, isTermKind, type TermKind } from "../domain/term-kind";
import { normalizeTermName } from "../domain/terms";
import type { TermKey, VocabularyAssertion, VocabularyChange, VocabularyDocument, VocabularyProposal, VocabularyQuestion, VocabularyRelation, VocabularyRule, VocabularyTerm } from "./vocabulary-document";

export class ShapeError extends Error {
  readonly at: string;

  constructor(at: string, message: string) {
    super(`${at}: ${message}`);
    this.name = "ShapeError";
    this.at = at;
  }
}

/** The arclint context map's relationship kinds, as `arclint domain schema` lists them. */
export const RELATION_KINDS = [
  "partnership",
  "shared_kernel",
  "customer_supplier",
  "conformist",
  "anticorruption_layer",
  "open_host_service",
  "published_language",
  "separate_ways",
] as const;

/** The kinds that may carry invariants, and the kinds that may carry assertions. */
export const INVARIANT_KINDS: readonly TermKind[] = ["aggregate", "value_object"];
export const ASSERTION_KINDS: readonly TermKind[] = ["aggregate", "domain_service"];

type Fields = Record<string, unknown>;

function record(value: unknown, at: string): Fields {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new ShapeError(at, "must be a mapping");
  return value as Fields;
}

function onlyFields(value: Fields, at: string, allowed: readonly string[]): void {
  for (const field of Object.keys(value)) {
    if (!allowed.includes(field)) throw new ShapeError(`${at}.${field}`, `is not a field BWrite knows; the fields are ${allowed.join(", ")}`);
  }
}

function text(value: unknown, at: string, { empty = false }: { empty?: boolean } = {}): string {
  if (typeof value !== "string") throw new ShapeError(at, "must be text");
  if (!empty && value.trim().length === 0) throw new ShapeError(at, "must not be empty");
  return value;
}

function optionalText(value: unknown, at: string): string | undefined {
  return value === undefined ? undefined : text(value, at);
}

function list(value: unknown, at: string): unknown[] {
  if (!Array.isArray(value)) throw new ShapeError(at, "must be a list");
  return value;
}

/** A term's key: its name within its bounded context. Entities are keyed in their Aggregate's context. */
export function termKeyOf(term: VocabularyTerm, document: { terms: readonly VocabularyTerm[] }): TermKey {
  if (term.kind === "entity") {
    const owner = term.aggregate === undefined ? undefined : findAggregate(document.terms, term.aggregate);
    return { name: term.name, context: owner?.context };
  }
  return { name: term.name, context: term.context };
}

export function sameName(a: string, b: string): boolean {
  return normalizeTermName(a) === normalizeTermName(b);
}

function sameContext(a: string | undefined, b: string | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return sameName(a, b);
}

export function sameKey(a: TermKey, b: TermKey): boolean {
  return sameName(a.name, b.name) && sameContext(a.context, b.context);
}

/** The one aggregate with this name; entities name their aggregate without its context. */
export function findAggregate(terms: readonly VocabularyTerm[], name: string): VocabularyTerm | undefined {
  const found = terms.filter((t) => t.kind === "aggregate" && sameName(t.name, name));
  return found.length === 1 ? found[0] : undefined;
}

export function findTerm(document: { terms: readonly VocabularyTerm[] }, key: TermKey): number {
  return document.terms.findIndex((t) => sameKey(termKeyOf(t, document), key));
}

function readRule(value: unknown, at: string): VocabularyRule {
  const fields = record(value, at);
  onlyFields(fields, at, ["key", "statement"]);
  return { key: text(fields.key, `${at}.key`), statement: text(fields.statement, `${at}.statement`) };
}

function readAssertion(value: unknown, at: string): VocabularyAssertion {
  const fields = record(value, at);
  onlyFields(fields, at, ["key", "on", "statement"]);
  return { key: text(fields.key, `${at}.key`), on: text(fields.on, `${at}.on`), statement: text(fields.statement, `${at}.statement`) };
}

function readProposal(value: unknown, at: string): VocabularyProposal {
  const fields = record(value, at);
  onlyFields(fields, at, ["feature", "featureId", "text", "proposedAt"]);
  const proposedAt = fields.proposedAt instanceof Date ? fields.proposedAt.toISOString() : text(fields.proposedAt, `${at}.proposedAt`);
  if (Number.isNaN(Date.parse(proposedAt))) throw new ShapeError(`${at}.proposedAt`, "must be an ISO 8601 date and time");
  return {
    feature: text(fields.feature, `${at}.feature`, { empty: true }),
    featureId: text(fields.featureId, `${at}.featureId`),
    text: text(fields.text, `${at}.text`),
    proposedAt,
  };
}

const TERM_FIELDS = [
  "name",
  "kind",
  "status",
  "context",
  "aggregate",
  "identity",
  "raisedBy",
  "aliases",
  "definition",
  "invariants",
  "assertions",
  "proposal",
] as const;

/** Reads one term, checking every field it holds against the fields its kind takes. */
export function readTerm(value: unknown, at: string): VocabularyTerm {
  const fields = record(value, at);
  onlyFields(fields, at, TERM_FIELDS);
  const term: VocabularyTerm = { name: text(fields.name, `${at}.name`), definition: text(fields.definition, `${at}.definition`, { empty: true }) };

  if (fields.kind !== undefined) {
    if (!isTermKind(fields.kind)) throw new ShapeError(`${at}.kind`, `must be one of ${TERM_KINDS.join(", ")}`);
    term.kind = fields.kind;
  }
  const kind = term.kind;
  const takes = (field: string, allowed: boolean, why: string) => {
    if (fields[field] !== undefined && !allowed) throw new ShapeError(`${at}.${field}`, why);
  };
  takes("context", kind !== "bounded_context" && kind !== "entity", kind === "entity" ? "an Entity is in its Aggregate's bounded context, which is never written" : "a bounded context is in no bounded context");
  takes("aggregate", kind === "entity", "only an Entity names its Aggregate");
  takes("identity", kind === "aggregate" || kind === "entity", "only an Aggregate or an Entity has an identity");
  takes("raisedBy", kind === "domain_event", "only a Domain Event names the Aggregate that raises it");
  takes("invariants", kind !== undefined && INVARIANT_KINDS.includes(kind), "only an Aggregate or a Value Object holds invariants");
  takes("assertions", kind !== undefined && ASSERTION_KINDS.includes(kind), "only an Aggregate or a Domain Service holds assertions");

  const context = optionalText(fields.context, `${at}.context`);
  if (context !== undefined) term.context = context;
  const aggregate = optionalText(fields.aggregate, `${at}.aggregate`);
  if (aggregate !== undefined) term.aggregate = aggregate;
  const identity = optionalText(fields.identity, `${at}.identity`);
  if (identity !== undefined) term.identity = identity;
  const raisedBy = optionalText(fields.raisedBy, `${at}.raisedBy`);
  if (raisedBy !== undefined) term.raisedBy = raisedBy;

  if (fields.aliases !== undefined) {
    const aliases = list(fields.aliases, `${at}.aliases`).map((alias, i) => text(alias, `${at}.aliases[${i}]`));
    aliases.forEach((alias, i) => {
      if (aliases.findIndex((other) => sameName(other, alias)) !== i) throw new ShapeError(`${at}.aliases[${i}]`, `repeats the alias ${alias}`);
      if (sameName(alias, term.name)) throw new ShapeError(`${at}.aliases[${i}]`, "repeats the term's own name");
    });
    term.aliases = aliases;
  }

  const keys: string[] = [];
  const keyed = (key: string, ruleAt: string) => {
    if (keys.includes(key)) throw new ShapeError(ruleAt, `repeats the rule key ${key}; a term never gives two rules the same key`);
    keys.push(key);
  };
  if (fields.invariants !== undefined) {
    term.invariants = list(fields.invariants, `${at}.invariants`).map((rule, i) => readRule(rule, `${at}.invariants[${i}]`));
    term.invariants.forEach((rule, i) => keyed(rule.key, `${at}.invariants[${i}].key`));
  }
  if (fields.assertions !== undefined) {
    term.assertions = list(fields.assertions, `${at}.assertions`).map((rule, i) => readAssertion(rule, `${at}.assertions[${i}]`));
    term.assertions.forEach((rule, i) => keyed(rule.key, `${at}.assertions[${i}].key`));
  }

  if (fields.status !== undefined && fields.status !== "accepted" && fields.status !== "proposed") {
    throw new ShapeError(`${at}.status`, "must be accepted or proposed");
  }
  if (fields.status === "proposed") {
    term.status = "proposed";
    if (fields.proposal === undefined) throw new ShapeError(`${at}.proposal`, "is required on a proposed term");
    term.proposal = readProposal(fields.proposal, `${at}.proposal`);
  } else {
    if (fields.status === "accepted") term.status = "accepted";
    if (fields.proposal !== undefined) throw new ShapeError(`${at}.proposal`, "belongs only on a proposed term");
  }
  return term;
}

function readTermKey(value: unknown, at: string): TermKey {
  const fields = record(value, at);
  onlyFields(fields, at, ["name", "context"]);
  const key: TermKey = { name: text(fields.name, `${at}.name`) };
  const context = optionalText(fields.context, `${at}.context`);
  if (context !== undefined) key.context = context;
  return key;
}

/** Reads the change set of a plan or apply request. */
export function readChanges(value: unknown, at = "changes"): VocabularyChange[] {
  return list(value, at).map((entry, i) => {
    const changeAt = `${at}[${i}]`;
    const fields = record(entry, changeAt);
    if (fields.type === "put-term") {
      onlyFields(fields, changeAt, ["type", "term", "replaces"]);
      const change: VocabularyChange = { type: "put-term", term: readTerm(fields.term, `${changeAt}.term`) };
      if (fields.replaces !== undefined) change.replaces = readTermKey(fields.replaces, `${changeAt}.replaces`);
      return change;
    }
    if (fields.type === "remove-term") {
      onlyFields(fields, changeAt, ["type", "term"]);
      return { type: "remove-term", term: readTermKey(fields.term, `${changeAt}.term`) };
    }
    throw new ShapeError(`${changeAt}.type`, "must be put-term or remove-term");
  });
}

function readQuestion(value: unknown, at: string): VocabularyQuestion {
  const fields = record(value, at);
  onlyFields(fields, at, ["context", "key", "text"]);
  const question: VocabularyQuestion = { key: text(fields.key, `${at}.key`), text: text(fields.text, `${at}.text`) };
  const context = optionalText(fields.context, `${at}.context`);
  if (context !== undefined) question.context = context;
  return question;
}

function readRelation(value: unknown, at: string): VocabularyRelation {
  const fields = record(value, at);
  onlyFields(fields, at, ["from", "to", "kind", "description"]);
  const kind = text(fields.kind, `${at}.kind`);
  if (!(RELATION_KINDS as readonly string[]).includes(kind)) throw new ShapeError(`${at}.kind`, `must be one of ${RELATION_KINDS.join(", ")}`);
  const relation: VocabularyRelation = { from: text(fields.from, `${at}.from`), to: text(fields.to, `${at}.to`), kind };
  const description = optionalText(fields.description, `${at}.description`);
  if (description !== undefined) relation.description = description;
  return relation;
}

/** Reads a whole document: its shape, then every name it relates terms by. */
export function readDocument(value: unknown): VocabularyDocument {
  const at = "document";
  const fields = record(value, at);
  onlyFields(fields, at, ["version", "project", "description", "terms", "questions", "relations"]);
  if (fields.version !== 1) throw new ShapeError("version", "must be 1");
  const document: VocabularyDocument = {
    version: 1,
    project: text(fields.project, "project"),
    terms: list(fields.terms ?? [], "terms").map((term, i) => readTerm(term, `terms[${i}]`)),
  };
  const description = optionalText(fields.description, "description");
  if (description !== undefined) document.description = description;
  if (fields.questions !== undefined) document.questions = list(fields.questions, "questions").map((q, i) => readQuestion(q, `questions[${i}]`));
  if (fields.relations !== undefined) document.relations = list(fields.relations, "relations").map((r, i) => readRelation(r, `relations[${i}]`));
  checkDocument(document);
  return document;
}

/**
 * The checks across terms: names unique per bounded context, and every name a term, question,
 * or relation gives naming an existing term of the kind that relationship takes.
 */
export function checkDocument(document: VocabularyDocument): void {
  const contexts = document.terms.filter((t) => t.kind === "bounded_context");
  const contextNamed = (name: string, at: string) => {
    if (!contexts.some((c) => sameName(c.name, name))) throw new ShapeError(at, `names no bounded context; the bounded contexts are ${contexts.map((c) => c.name).join(", ") || "none"}`);
  };
  const inContext = (kind: TermKind, name: string, context: string | undefined) =>
    document.terms.some((t) => t.kind === kind && sameName(t.name, name) && sameContext(t.context, context));

  document.terms.forEach((term, i) => {
    const at = `terms[${i}]`;
    if (term.context !== undefined) contextNamed(term.context, `${at}.context`);
    if (term.kind === "entity") {
      if (term.aggregate === undefined) throw new ShapeError(`${at}.aggregate`, "is required on an Entity");
      const owners = document.terms.filter((t) => t.kind === "aggregate" && sameName(t.name, term.aggregate!));
      if (owners.length === 0) throw new ShapeError(`${at}.aggregate`, `names no Aggregate called ${term.aggregate}`);
      if (owners.length > 1) throw new ShapeError(`${at}.aggregate`, `names ${term.aggregate}, an Aggregate of several bounded contexts`);
      if (owners[0].context === undefined) throw new ShapeError(`${at}.aggregate`, `names ${term.aggregate}, which is in no bounded context`);
    }
    const context = term.kind === "entity" ? findAggregate(document.terms, term.aggregate!)!.context : term.context;
    if (term.identity !== undefined && !inContext("value_object", term.identity, context)) {
      throw new ShapeError(`${at}.identity`, `names no Value Object called ${term.identity} in the same bounded context`);
    }
    if (term.raisedBy !== undefined && !inContext("aggregate", term.raisedBy, context)) {
      throw new ShapeError(`${at}.raisedBy`, `names no Aggregate called ${term.raisedBy} in the same bounded context`);
    }
    const key = termKeyOf(term, document);
    const first = document.terms.findIndex((other) => sameKey(termKeyOf(other, document), key));
    if (first !== i) {
      throw new ShapeError(`${at}.name`, `repeats ${term.name}, already terms[${first}]${key.context ? ` in ${key.context}` : ""}; names are unique per bounded context`);
    }
  });

  const questionKeys: string[] = [];
  (document.questions ?? []).forEach((question, i) => {
    if (question.context !== undefined) contextNamed(question.context, `questions[${i}].context`);
    const id = `${normalizeTermName(question.context ?? "")}\u0000${question.key}`;
    if (questionKeys.includes(id)) throw new ShapeError(`questions[${i}].key`, `repeats the question key ${question.key}`);
    questionKeys.push(id);
  });
  (document.relations ?? []).forEach((relation, i) => {
    contextNamed(relation.from, `relations[${i}].from`);
    contextNamed(relation.to, `relations[${i}].to`);
    if (sameName(relation.from, relation.to)) throw new ShapeError(`relations[${i}].to`, "relates a bounded context to itself");
  });
}
