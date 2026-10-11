import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import type {
  VocabularyAssertion,
  VocabularyDocument,
  VocabularyQuestion,
  VocabularyRelation,
  VocabularyRule,
  VocabularyTerm,
} from "../../../src/contexts/authoring/application/vocabulary-document";

// Reads a folder's recorded domain the way BWrite's server does: through
// `arclint domain list --format json`, mapped onto the contract's VocabularyDocument.
// The mapping refuses any field arclint answers with that it does not know, so a
// change in arclint's listing fails the unit tests instead of being dropped.

/** The root of this repository, whose domain.arclint.yaml records BWrite's own domain. */
export const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url)).replace(/[\\/]+$/u, "");

// arclint's answer, as `arclint domain list --format json` writes it.

interface ListedRule {
  key: string;
  statement: string;
}

interface ListedAssertion extends ListedRule {
  on: string;
}

interface ListedEntity {
  name: string;
  definition: string;
  identity?: string;
  aliases?: string[];
}

interface ListedAggregate extends ListedEntity {
  entities?: ListedEntity[];
  invariants?: ListedRule[];
  assertions?: ListedAssertion[];
  repository?: string;
  factory?: string;
}

interface ListedValueObject {
  name: string;
  definition: string;
  aliases?: string[];
  invariants?: ListedRule[];
}

interface ListedEvent {
  name: string;
  definition: string;
  raisedBy?: string;
}

interface ListedService {
  name: string;
  definition: string;
  assertions?: ListedAssertion[];
}

interface ListedSpecification {
  name: string;
  definition: string;
}

interface ListedQuestion {
  key: string;
  text: string;
}

interface ListedContext {
  name: string;
  definition: string;
  aggregates?: ListedAggregate[];
  valueObjects?: ListedValueObject[];
  events?: ListedEvent[];
  services?: ListedService[];
  specifications?: ListedSpecification[];
  questions?: ListedQuestion[];
}

export interface ArcLintDomainList {
  contexts: ListedContext[] | null;
  found: boolean;
  project: string;
  relations: VocabularyRelation[] | null;
  source: string;
}

const FIELDS = {
  list: ["contexts", "found", "project", "relations", "source"],
  context: ["name", "definition", "aggregates", "valueObjects", "events", "services", "specifications", "questions"],
  aggregate: ["name", "definition", "identity", "aliases", "entities", "invariants", "assertions", "repository", "factory"],
  entity: ["name", "definition", "identity", "aliases"],
  valueObject: ["name", "definition", "aliases", "invariants"],
  event: ["name", "definition", "raisedBy"],
  service: ["name", "definition", "assertions"],
  specification: ["name", "definition"],
  rule: ["key", "statement"],
  assertion: ["key", "statement", "on"],
  question: ["key", "text"],
  relation: ["from", "to", "kind", "description"],
} as const;

/** Fails when arclint answered with a field this mapping does not know. */
function known(what: keyof typeof FIELDS, value: object): void {
  const allowed: readonly string[] = FIELDS[what];
  const unknown = Object.keys(value).filter((k) => !allowed.includes(k));
  if (unknown.length > 0) {
    throw new Error(`arclint domain list answered a ${what} with fields this mapping does not know: ${unknown.join(", ")}`);
  }
}

/** Runs `arclint domain list --format json` in `folder` and returns its answer as arclint wrote it. */
export function arclintDomainList(folder: string = REPO_ROOT): ArcLintDomainList {
  const out = execFileSync("arclint", ["domain", "list", "--format", "json"], { cwd: folder, encoding: "utf8" });
  const list = JSON.parse(out) as ArcLintDomainList;
  known("list", list);
  if (list.found !== true) throw new Error(`arclint found no domain file in ${folder}`);
  return list;
}

const rulesOf = (rules: readonly ListedRule[] | undefined): VocabularyRule[] | undefined =>
  rules && rules.length > 0
    ? rules.map((r) => {
        known("rule", r);
        return { key: r.key, statement: r.statement };
      })
    : undefined;

const assertionsOf = (rules: readonly ListedAssertion[] | undefined): VocabularyAssertion[] | undefined =>
  rules && rules.length > 0
    ? rules.map((r) => {
        known("assertion", r);
        return { key: r.key, statement: r.statement, on: r.on };
      })
    : undefined;

/** The term with every absent or empty optional field left out, as the contract writes it. */
function term(fields: VocabularyTerm): VocabularyTerm {
  const out: VocabularyTerm = { name: fields.name, definition: fields.definition };
  for (const [key, value] of Object.entries(fields) as [keyof VocabularyTerm, unknown][]) {
    if (key === "name" || key === "definition" || value === undefined) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    (out as unknown as Record<string, unknown>)[key] = value;
  }
  return out;
}

/** Maps arclint's answer to the contract's VocabularyDocument. */
export function documentOf(list: ArcLintDomainList): VocabularyDocument {
  const terms: VocabularyTerm[] = [];
  const questions: VocabularyQuestion[] = [];
  for (const c of list.contexts ?? []) {
    known("context", c);
    terms.push(term({ name: c.name, kind: "bounded_context", definition: c.definition }));
    for (const a of c.aggregates ?? []) {
      known("aggregate", a);
      terms.push(
        term({
          name: a.name,
          kind: "aggregate",
          context: c.name,
          identity: a.identity,
          aliases: a.aliases,
          definition: a.definition,
          invariants: rulesOf(a.invariants),
          assertions: assertionsOf(a.assertions),
        }),
      );
      for (const e of a.entities ?? []) {
        known("entity", e);
        terms.push(
          term({ name: e.name, kind: "entity", aggregate: a.name, identity: e.identity, aliases: e.aliases, definition: e.definition }),
        );
      }
    }
    for (const v of c.valueObjects ?? []) {
      known("valueObject", v);
      terms.push(
        term({
          name: v.name,
          kind: "value_object",
          context: c.name,
          aliases: v.aliases,
          definition: v.definition,
          invariants: rulesOf(v.invariants),
        }),
      );
    }
    for (const e of c.events ?? []) {
      known("event", e);
      terms.push(term({ name: e.name, kind: "domain_event", context: c.name, raisedBy: e.raisedBy, definition: e.definition }));
    }
    for (const s of c.services ?? []) {
      known("service", s);
      terms.push(
        term({ name: s.name, kind: "domain_service", context: c.name, definition: s.definition, assertions: assertionsOf(s.assertions) }),
      );
    }
    for (const s of c.specifications ?? []) {
      known("specification", s);
      terms.push(term({ name: s.name, kind: "specification", context: c.name, definition: s.definition }));
    }
    for (const q of c.questions ?? []) {
      known("question", q);
      questions.push({ context: c.name, key: q.key, text: q.text });
    }
  }
  const relations = (list.relations ?? []).map((r): VocabularyRelation => {
    known("relation", r);
    return r.description === undefined
      ? { from: r.from, to: r.to, kind: r.kind }
      : { from: r.from, to: r.to, kind: r.kind, description: r.description };
  });
  const document: VocabularyDocument = { version: 1, project: list.project, terms };
  if (questions.length > 0) document.questions = questions;
  if (relations.length > 0) document.relations = relations;
  return document;
}

/** The VocabularyDocument of `folder`'s domain.arclint.yaml, read through arclint. */
export function arclintDocument(folder: string = REPO_ROOT): VocabularyDocument {
  return documentOf(arclintDomainList(folder));
}

/** Runs arclint in `folder` with `args`, as BWrite's server would; throws with arclint's words when it refuses. */
export function runArclint(folder: string, ...args: string[]): string {
  return execFileSync("arclint", args, { cwd: folder, encoding: "utf8", stdio: "pipe" });
}
