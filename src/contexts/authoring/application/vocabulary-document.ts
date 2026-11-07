// BWrite's canonical form of a UbiquitousLanguage and the change sets that edit it. The page
// builds its UbiquitousLanguage from this document and states its edits as these changes; the
// Node process reads every VocabularyFile format into it and applies the changes through the
// adapter for the file's format:
//   arclint  domain.arclint.yaml, read and changed only by running arclint (supported first)
//   bwrite   ubiquitous-language.bwrite.yaml, BWrite's own format, read and written by BWrite
// A folder arclint is set up for (arclint finds a rules.arclint.yaml) uses arclint's file;
// any other folder uses BWrite's. The wire carries the same shapes as the payloads in
// contracts/vocabulary-api.ts; adapters assign between the two.

import type { TermKind } from "../domain/term-kind";

// The canonical document

export interface VocabularyRule {
  key: string;
  statement: string;
}

export interface VocabularyAssertion extends VocabularyRule {
  /** The operation the guarantee belongs to. */
  on: string;
}

/** Where a proposed term came from. Only BWrite's format keeps proposed terms. */
export interface VocabularyProposal {
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
export interface VocabularyTerm {
  name: string;
  definition: string;
  aliases?: string[];
  /** Absent: not classified yet. Only BWrite's format keeps unclassified terms. */
  kind?: TermKind;
  /** The bounded context's name. Absent: not placed in one (BWrite's format only). */
  context?: string;
  /** An Entity's Aggregate. */
  aggregate?: string;
  /** The identity Value Object of an Aggregate or Entity. */
  identity?: string;
  /** The Aggregate that raises a Domain Event. */
  raisedBy?: string;
  /** Aggregate and Value Object only. */
  invariants?: VocabularyRule[];
  /** Aggregate and Domain Service only. */
  assertions?: VocabularyAssertion[];
  /** Absent means accepted. */
  status?: "accepted" | "proposed";
  /** Present exactly when status is "proposed". */
  proposal?: VocabularyProposal;
}

export interface VocabularyQuestion {
  /** The bounded context it is about; absent when the language has no bounded context. */
  context?: string;
  key: string;
  text: string;
}

export interface VocabularyRelation {
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
export interface VocabularyDocument {
  version: 1;
  project: string;
  description?: string;
  terms: VocabularyTerm[];
  questions?: VocabularyQuestion[];
  relations?: VocabularyRelation[];
}

// Changes

/** A term's key: its name within its bounded context (an Entity: its Aggregate's context). */
export interface TermKey {
  name: string;
  context?: string;
}

/**
 * The change set the page sends. `put-term` states the whole term as it must be afterwards;
 * `replaces` names it as it was when the name, context, or kind changed, otherwise the key of
 * `term` itself is the term to update or create. Each adapter turns changes into its own edits
 * (arclint define and remove calls, or a rewrite of BWrite's file), applied in order.
 */
export type VocabularyChange =
  | { type: "put-term"; term: VocabularyTerm; replaces?: TermKey }
  | { type: "remove-term"; term: TermKey };

/** One step a change set will take, worded for the author: an exact arclint command, or a file edit. */
export interface PlannedStep {
  description: string;
  /** For arclint, the argv after `arclint`; absent for BWrite's own file. */
  command?: string[];
}

/** One architecture rule binding a Project, as one `arclint rules --format json` entry carries it; fields beyond these pass through. */
export interface ArcLintRule {
  id: string;
  type: string;
  severity: string;
  proposition: string;
  builtIn?: boolean;
  [field: string]: unknown;
}
