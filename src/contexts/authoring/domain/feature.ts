import type { FeatureId } from "./feature-id";
import type { TermId } from "./term-id";
import type { ProjectId } from "./project-id";
import { RefusalError, attempt, failure, type Result } from "./refusal";
import { ruleKeyOf, termReferenceOf, type TermReference } from "./term-reference";

/** A feature title may be left empty in the editor; renaming only keeps it on one line and trims it. */
export function cleanFeatureTitle(raw: string): string {
  return raw.replace(/[\r\n]+/g, " ").trim();
}

export interface FeatureParts {
  id: FeatureId;
  projectId: ProjectId;
  title: string;
  /** Free text: notes, Given/When/Then statements, Scenarios, and Rules in any mix. */
  body: string;
  references: readonly TermReference[];
}

/** Rebuilds every reference through its construction door against `body`, sorted by position. */
function referencesIn(body: string, references: readonly TermReference[]): TermReference[] {
  return references
    .map((r) => termReferenceOf(body, r.from, r.to, r.termId, r.reading))
    .sort((a, b) => a.from - b.from || a.to - b.to);
}

/**
 * One capability of a Project, written as free text with a title, together with the
 * TermReferences that tie occurrences in that text to DomainTerms. The text and its
 * references change together, so a reference always fits the text as it is now.
 */
export class Feature {
  readonly id: FeatureId;
  readonly projectId: ProjectId;
  readonly title: string;
  readonly body: string;
  /** Sorted by position. */
  readonly references: readonly TermReference[];

  /** Creates a feature from its parts; throws a RefusalError when its references do not fit its text. */
  constructor(parts: FeatureParts) {
    this.id = parts.id;
    this.projectId = parts.projectId;
    this.title = parts.title;
    this.body = parts.body;
    this.references = referencesIn(parts.body, parts.references);
    const refusal = this.ensureReferencesNeverOverlap();
    if (refusal) throw refusal;
  }

  retitle(title: string): Result<Feature, RefusalError> {
    const refusal = this.ensureReferencesNeverOverlap();
    if (refusal) return failure(refusal);
    return attempt(() => new Feature({ ...this.parts(), title }));
  }

  /** Replaces the text and its references together, as the editor reports them after an edit. */
  edit(body: string, references: readonly TermReference[]): Result<Feature, RefusalError> {
    const placed = attempt(() => referencesIn(body, references));
    if (!placed.ok) return placed;
    const refusal = this.ensureReferencesNeverOverlap(placed.value);
    if (refusal) return failure(refusal);
    return attempt(() => new Feature({ ...this.parts(), body, references: placed.value }));
  }

  /** Unties every occurrence that states the rule `ruleKey` of `termId`; the text stays as written. */
  removeRuleReferences(termId: TermId, ruleKey: string): Result<Feature, RefusalError> {
    const references = this.references.filter((r) => r.termId !== termId || ruleKeyOf(r) !== ruleKey);
    const refusal = this.ensureReferencesNeverOverlap(references);
    if (refusal) return failure(refusal);
    return attempt(() => new Feature({ ...this.parts(), references }));
  }

  /** The references that state the rule `ruleKey` of `termId`. */
  ruleReferences(termId: TermId, ruleKey: string): TermReference[] {
    return this.references.filter((r) => r.termId === termId && ruleKeyOf(r) === ruleKey);
  }

  /** Invariant references-never-overlap: no piece of the text is tied to two terms. */
  private ensureReferencesNeverOverlap(references: readonly TermReference[] = this.references): RefusalError | null {
    const sorted = [...references].sort((a, b) => a.from - b.from);
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].from < sorted[i - 1].to) {
        return new RefusalError("Two references in this feature cover the same text.");
      }
    }
    return null;
  }

  private parts(): FeatureParts {
    return { id: this.id, projectId: this.projectId, title: this.title, body: this.body, references: this.references };
  }
}
