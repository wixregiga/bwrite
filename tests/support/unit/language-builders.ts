import { classificationOf, type Relation } from "../../../src/contexts/authoring/domain/classification";
import type { DomainTerm } from "../../../src/contexts/authoring/domain/domain-term";
import { featureIdOf } from "../../../src/contexts/authoring/domain/feature-id";
import { placedRuleOf, type PlacedRule } from "../../../src/contexts/authoring/domain/placed-rule";
import { projectIdOf } from "../../../src/contexts/authoring/domain/project-id";
import { termIdOf, type TermId } from "../../../src/contexts/authoring/domain/term-id";
import type { TermKind } from "../../../src/contexts/authoring/domain/term-kind";
import { UbiquitousLanguage } from "../../../src/contexts/authoring/domain/ubiquitous-language";
import type { VocabularyFile } from "../../../src/contexts/authoring/domain/vocabulary-file";

// Builds the inputs of a unit test through the model's own constructors, so a test
// states only what differs from an accepted, unclassified term without rules.

export const PROJECT = projectIdOf("project-test");

export const FEATURE = featureIdOf("feature-test");

/** arclint's file, as BWrite's server reports it for a folder arclint is set up for. */
export const ARCLINT_FILE: VocabularyFile = {
  format: "arclint",
  file: "domain.arclint.yaml",
  found: true,
  holdsProposals: false,
  holdsUnplacedTerms: false,
};

/** BWrite's own file, as BWrite's server reports it for any other folder. */
export const BWRITE_FILE: VocabularyFile = {
  format: "bwrite",
  file: "ubiquitous-language.bwrite.yaml",
  found: true,
  holdsProposals: true,
  holdsUnplacedTerms: true,
};

export const id = (value: string): TermId => termIdOf(value);

/** An accepted term with no aliases, no classification, and no rules, unless overridden. */
export function accepted(termId: string, name: string, overrides: Partial<DomainTerm> = {}): DomainTerm {
  return {
    id: id(termId),
    name,
    definition: `The ${name}.`,
    aliases: [],
    status: "accepted",
    proposal: null,
    classification: null,
    rules: [],
    ...overrides,
  };
}

/** A proposed term carrying its proposal, unless overridden. */
export function proposed(termId: string, name: string, overrides: Partial<DomainTerm> = {}): DomainTerm {
  return accepted(termId, name, {
    status: "proposed",
    proposal: { featureId: FEATURE, text: name.toLowerCase(), proposedAt: "2026-10-09T10:00:00.000Z" },
    ...overrides,
  });
}

/** The classification of `kind` whose relations name their targets by term id; null leaves a relation empty. */
export function classified(kind: TermKind, relations: Partial<Record<Relation, string | null>> = {}) {
  return classificationOf(
    kind,
    Object.fromEntries(Object.entries(relations).map(([r, target]) => [r, target === null ? null : id(target!)])),
  );
}

export function invariant(key: string, statement = `The ${key} rule holds.`): PlacedRule {
  return placedRuleOf({ kind: "invariant", key, statement, operation: "" });
}

export function assertion(key: string, operation: string, statement = `The ${key} rule holds.`): PlacedRule {
  return placedRuleOf({ kind: "assertion", key, statement, operation });
}

/** A language kept in BWrite's own file, which holds proposed and unplaced terms. */
export function language(...terms: DomainTerm[]): UbiquitousLanguage {
  return new UbiquitousLanguage(PROJECT, BWRITE_FILE, terms);
}
