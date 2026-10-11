// The wire contract between BWrite's page and BWrite's Node process for a Project's
// VocabularyFile: the routes, the request and answer payloads, and the event the page listens
// for. These shapes evolve on the wire's own clock; the canonical document they carry is
// application/vocabulary-document.ts, and adapters on both sides assign between the two.

import type { Answer as Envelope, Refusal } from "../../../shared/transport/answer";

/** The Domain-Driven Design building blocks a term may be, as arclint names them. */
export type TermKindPayload = "bounded_context" | "aggregate" | "entity" | "value_object" | "domain_event" | "domain_service" | "specification";

/** The VocabularyFile behind a Project, as the wire states it. */
export interface VocabularyFilePayload {
  format: "arclint" | "bwrite";
  /** The file, relative to the Project's folder. */
  file: string;
  /** False when the folder has no such file yet. */
  found: boolean;
  /** Whether the format keeps proposed terms. */
  holdsProposals: boolean;
  /** Whether the format keeps terms without a kind or a bounded context. */
  holdsUnplacedTerms: boolean;
}

// The canonical document

export interface RulePayload {
  key: string;
  statement: string;
}

export interface AssertionPayload extends RulePayload {
  /** The operation the guarantee belongs to. */
  on: string;
}

/** Where a proposed term came from. Only BWrite's format keeps proposed terms. */
export interface ProposalPayload {
  /** The title of the Feature the text was selected in, as written at the time. */
  feature: string;
  /** BWrite's id of that Feature, so the panel can open it while it still exists. */
  featureId: string;
  /** The selected text exactly as it appeared. */
  text: string;
  /** ISO 8601. */
  proposedAt: string;
}

/**
 * One DomainTerm. Relations name other terms by name; a term is found by its name within its
 * bounded context. An Entity's bounded context is its Aggregate's and is never written.
 */
export interface TermPayload {
  name: string;
  definition: string;
  aliases?: string[];
  /** Absent: not classified yet. Only BWrite's format keeps unclassified terms. */
  kind?: TermKindPayload;
  /** The bounded context's name. Absent: not placed in one (BWrite's format only). */
  context?: string;
  /** An Entity's Aggregate. */
  aggregate?: string;
  /** The identity Value Object of an Aggregate or Entity. */
  identity?: string;
  /** The Aggregate that raises a Domain Event. */
  raisedBy?: string;
  /** Aggregate and Value Object only. */
  invariants?: RulePayload[];
  /** Aggregate and Domain Service only. */
  assertions?: AssertionPayload[];
  /** Absent means accepted. */
  status?: "accepted" | "proposed";
  /** Present exactly when status is "proposed". */
  proposal?: ProposalPayload;
}

export interface QuestionPayload {
  /** The bounded context it is about; absent when the language has no bounded context. */
  context?: string;
  key: string;
  text: string;
}

export interface RelationPayload {
  from: string;
  to: string;
  kind: string;
  description?: string;
}

/**
 * BWrite's canonical form of a UbiquitousLanguage. BWrite's own file is exactly this document
 * written as YAML, in this field order, with terms in the order the author added them:
 *
 *   version: 1
 *   project: shop
 *   description: Selling things online.
 *   terms:
 *     - name: Sales
 *       kind: bounded_context
 *       definition: Taking and fulfilling orders.
 *     - name: Order
 *       kind: aggregate
 *       context: Sales
 *       identity: OrderId
 *       aliases: [Purchase Order]
 *       definition: A customer's request to buy products.
 *       invariants:
 *         - key: has-lines
 *           statement: An Order has at least one line.
 *     - name: Gift Wrap
 *       status: proposed
 *       definition: Wrapping an item as a gift.
 *       proposal: { feature: Checkout, featureId: f-1, text: gift wrap, proposedAt: 2026-10-10T12:00:00.000Z }
 *   questions:
 *     - context: Sales
 *       key: who-pays-shipping
 *       text: Who pays shipping on a return?
 */
export interface DocumentPayload {
  version: 1;
  project: string;
  description?: string;
  terms: TermPayload[];
  questions?: QuestionPayload[];
  relations?: RelationPayload[];
}

// Changes

/** A term's key: its name within its bounded context (an Entity: its Aggregate's context). */
export interface TermKeyPayload {
  name: string;
  context?: string;
}

/**
 * The change set the page sends. `put-term` states the whole term as it must be afterwards;
 * `replaces` names it as it was when the name, context, or kind changed, otherwise the key of
 * `term` itself is the term to update or create. Each adapter turns changes into its own edits
 * (arclint define and remove calls, or a rewrite of BWrite's file), applied in order.
 */
export type ChangePayload =
  | { type: "put-term"; term: TermPayload; replaces?: TermKeyPayload }
  | { type: "remove-term"; term: TermKeyPayload };

/** One step a change set will take, worded for the author: an exact arclint command, or a file edit. */
export interface PlannedStepPayload {
  description: string;
  /** For arclint, the argv after `arclint`; absent for BWrite's own file. */
  command?: string[];
}

/** One architecture rule binding a Project, as one `arclint rules --format json` entry carries it; fields beyond these pass through. */
export interface ArcLintRulePayload {
  id: string;
  type: string;
  severity: string;
  proposition: string;
  builtIn?: boolean;
  [field: string]: unknown;
}

// Requests and answers

export interface ChangeRequest {
  path: string;
  changes: ChangePayload[];
}

export interface CreateRequest {
  path: string;
  /** arclint runs `arclint domain init`; bwrite writes an empty document named after the folder. */
  format: VocabularyFilePayload["format"];
}

export type ProjectProblemKind =
  /** The path does not resolve inside a folder BWrite was started with. */
  | "outside-roots"
  /** The path is not an existing folder. */
  | "not-a-folder"
  /** arclint is not installed where BWrite runs, and the folder needs it. */
  | "arclint-missing"
  /** arclint ran and refused or failed; the message is arclint's own. */
  | "arclint-failed"
  /** BWrite's file exists but is not a valid VocabularyDocument; the message says where. */
  | "file-invalid"
  /** The change needs something the file's format cannot keep, such as a proposed term in arclint's. */
  | "format-cannot-hold"
  /** The request itself is malformed. */
  | "invalid-request"
  /** BWrite's server side failed while doing the work, such as a file it may not write; the message is the system's own. */
  | "server-failed";

export type ProjectProblem = Refusal<ProjectProblemKind>;

export type Answer<T> = Envelope<T, ProjectProblemKind>;

export interface Roots {
  /** The folder BWrite was started in; a new Project's path defaults to it. */
  launchRoot: string;
  /** Every folder BWrite may read, the launch root first. */
  roots: string[];
}

export interface LoadedVocabulary {
  path: string;
  source: VocabularyFilePayload;
  document: DocumentPayload | null;
}

export type RootsAnswer = Answer<Roots>;
export type VocabularyAnswer = Answer<LoadedVocabulary>;
export type PlanAnswer = Answer<{ path: string; steps: PlannedStepPayload[] }>;
/** Rules exist only for a folder arclint is set up for; for any other the list is empty. */
export type RulesAnswer = Answer<{ path: string; rules: ArcLintRulePayload[] }>;

// Routes, all on BWrite's own origin. GET routes take the path as the `path` query parameter.

/** The largest request body BWrite's Node process reads, in bytes. */
export const MAX_BODY_BYTES = 1024 * 1024;

export const ROUTES = {
  roots: "/api/roots",
  /** GET: VocabularyAnswer. */
  vocabulary: "/api/project/vocabulary",
  /** POST CreateRequest: VocabularyAnswer. */
  create: "/api/project/vocabulary/create",
  /** POST ChangeRequest: PlanAnswer, changing nothing. */
  plan: "/api/project/vocabulary/plan",
  /** POST ChangeRequest: VocabularyAnswer, the file as read back after the change. */
  apply: "/api/project/vocabulary/apply",
  /** GET: RulesAnswer. */
  rules: "/api/project/rules",
  /** Server-sent events: VOCABULARY_CHANGED whenever the Project's VocabularyFile changes on disk. */
  events: "/api/project/events",
} as const;

export const VOCABULARY_CHANGED = "vocabulary-changed";
