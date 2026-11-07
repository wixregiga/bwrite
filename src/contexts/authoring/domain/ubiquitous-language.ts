import { RELATIONS, chosenRelations, classificationOf, relationOf, relationRule, type Classification, type Relation, type RelationRule } from "./classification";
import { kindWithArticle } from "./term-kind";
import type { ProjectId } from "./project-id";
import { RefusalError, attempt, failure, type Result } from "./refusal";
import { cleanTermName, hasWordCharacter, normalizeTermName } from "./terms";
import { MAX_DEFINITION_LENGTH, MAX_TERM_NAME_LENGTH, type DomainTerm } from "./domain-term";
import { type TermId } from "./term-id";
import { type TermProposal } from "./term-proposal";
import type { PlacedRule } from "./placed-rule";
import { QualifiedName } from "./qualified-name";
import type { VocabularyFile } from "./vocabulary-file";

export interface ProposalDraft {
  name: string;
  definition: string;
  classification: Classification | null;
}

export interface ProposalProblems {
  name?: string;
  definition?: string;
}

/** What a TermReference points at: a term, and for a rule reading one of its PlacedRules. */
export interface ReferenceTarget {
  termId: TermId;
  ruleKey: string | null;
}

const HOLDS_INVARIANTS = ["aggregate", "value_object"] as const;
const HOLDS_ASSERTIONS = ["aggregate", "domain_service"] as const;

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

function quoted(name: string): string {
  return `“${name}”`;
}

/** The bounded context a term is in: its own, or for an Entity its Aggregate's. Null is the unplaced language. */
function contextIn(terms: readonly DomainTerm[], classification: Classification | null): TermId | null {
  if (!classification) return null;
  if (classification.kind === "entity") {
    const aggregateId = relationOf(classification, "aggregate");
    const aggregate = terms.find((t) => t.id === aggregateId);
    return aggregate?.classification?.kind === "aggregate" ? relationOf(aggregate.classification, "context") : null;
  }
  return relationOf(classification, "context");
}

/** Whether `target` can be the `rule` relation of a term classified as `classification`. */
function fits(
  terms: readonly DomainTerm[],
  termId: TermId | null,
  classification: Classification,
  rule: RelationRule,
  target: DomainTerm,
): "fits" | "self" | "kind" | "context" {
  if (target.id === termId) return "self";
  if (target.classification?.kind !== rule.target) return "kind";
  // A term's bounded context is chosen freely, and an Entity takes its Aggregate's;
  // everything else it relates to is in its own bounded context.
  if (rule.relation === "context" || rule.relation === "aggregate") return "fits";
  return contextIn(terms, target.classification) === contextIn(terms, classification) ? "fits" : "context";
}

interface Misfit {
  term: DomainTerm;
  rule: RelationRule;
  target: DomainTerm;
  why: "self" | "kind" | "context";
}

function firstMisfit(terms: readonly DomainTerm[], counts: (why: Misfit["why"]) => boolean): Misfit | null {
  for (const term of terms) {
    if (!term.classification) continue;
    for (const { rule, target: targetId } of chosenRelations(term.classification)) {
      const target = terms.find((t) => t.id === targetId);
      if (!target) continue;
      const why = fits(terms, term.id, term.classification, rule, target);
      if (why !== "fits" && counts(why)) return { term, rule, target, why };
    }
  }
  return null;
}

/** Says why a relation does not fit, from the side of the term the author is changing. */
function misfitReason(terms: readonly DomainTerm[], misfit: Misfit, changing: TermId | null): string {
  const { term, rule, target, why } = misfit;
  const contextName = (t: DomainTerm) => {
    const id = contextIn(terms, t.classification);
    const context = terms.find((c) => c.id === id);
    return context ? quoted(context.name) : "no bounded context";
  };
  if (why === "self") return `A term cannot be its own ${rule.noun}.`;
  if (term.id === changing) {
    return why === "kind"
      ? `${quoted(target.name)} is not ${kindWithArticle(rule.target)}, so it cannot be the ${rule.noun} of ${quoted(term.name)}.`
      : `${quoted(target.name)} is in ${contextName(target)}, so it cannot be the ${rule.noun} of a term in ${contextName(term)}.`;
  }
  if (target.id === changing) {
    return why === "kind"
      ? `${quoted(term.name)} uses it as its ${rule.noun}, so it must stay ${kindWithArticle(rule.target)}. Change the ${rule.noun} of ${quoted(term.name)} first.`
      : `${quoted(term.name)} uses it as its ${rule.noun}, so it must stay in the same bounded context as ${quoted(term.name)}. Change the ${rule.noun} of ${quoted(term.name)} first.`;
  }
  return `This would leave the ${rule.noun} of ${quoted(term.name)} in another bounded context. Change the ${rule.noun} of ${quoted(term.name)} first.`;
}

/**
 * The words one Project's team has agreed on or proposed, as DomainTerms. It is kept in the
 * Project's VocabularyFile and built from it: `file` says which file and what its format can
 * hold, and is null while that file is not known yet. Every Project has exactly one,
 * identified by the Project's ProjectId. Proposing, classifying, recording, and placing rules
 * on its terms happen here, because a term's name is checked against every other term of its
 * bounded context and a term is related only to terms of the same language. Every command
 * returns a new language, or the refusal that leaves this one unchanged.
 */
export class UbiquitousLanguage {
  readonly projectId: ProjectId;
  readonly file: VocabularyFile | null;
  readonly terms: readonly DomainTerm[];
  #accepted: readonly DomainTerm[] | null = null;

  /** Builds a language from its terms; throws a RefusalError when they break an invariant. */
  constructor(projectId: ProjectId, file: VocabularyFile | null, terms: readonly DomainTerm[]) {
    this.projectId = projectId;
    this.file = file;
    this.terms = terms;
    const refusal =
      this.ensureNamesAreUnique() ??
      this.ensurePlacementsStayInTheLanguage() ??
      this.ensureInvariantsOnlyOnAggregatesAndValues() ??
      this.ensureAssertionsOnlyOnAggregatesAndServices() ??
      this.ensureProposedTermsKeepTheirProposal() ??
      this.ensureRuleKeysAreUniquePerTerm() ??
      this.ensureRelationsFitTheirKind() ??
      this.ensureRelationsStayInOneBoundedContext() ??
      termIdsRepeat(terms);
    if (refusal) throw refusal;
  }

  // Commands

  /** Proposes a new term. It is never accepted by proposing it. */
  propose(draft: ProposalDraft, id: TermId, proposal: TermProposal): Result<UbiquitousLanguage, RefusalError> {
    const name = cleanTermName(draft.name);
    const definition = draft.definition.trim();
    const refusal =
      this.assertProposingRequiresAName(name) ??
      this.nameProblem(name, draft.classification) ??
      this.assertProposingRequiresADefinition(definition) ??
      definitionProblem(definition);
    if (refusal) return failure(refusal);

    const term: DomainTerm = {
      id,
      name,
      definition,
      aliases: [],
      status: "proposed",
      proposal,
      classification: draft.classification,
      rules: [],
    };
    const terms = [...this.terms, term];
    return this.settle(
      terms,
      this.assertProposingNeverAccepts(term) ??
        this.ensureNamesAreUnique(terms) ??
        this.ensurePlacementsStayInTheLanguage(terms) ??
        this.ensureInvariantsOnlyOnAggregatesAndValues(terms) ??
        this.ensureAssertionsOnlyOnAggregatesAndServices(terms) ??
        this.ensureProposedTermsKeepTheirProposal(terms) ??
        this.ensureRuleKeysAreUniquePerTerm(terms) ??
        this.ensureRelationsFitTheirKind(terms, id) ??
        this.ensureRelationsStayInOneBoundedContext(terms, id),
    );
  }

  /** Classifies a term, or clears its classification. Whether it is accepted never changes. */
  classify(termId: TermId, classification: Classification | null): Result<UbiquitousLanguage, RefusalError> {
    const before = this.term(termId);
    if (!before) return failure(missingTerm());
    const after: DomainTerm = { ...before, classification };
    const terms = this.terms.map((t) => (t.id === termId ? after : t));
    return this.settle(
      terms,
      this.assertClassifyingKeepsAcceptance(before, after) ??
        (before.status === "accepted" ? this.fileCannotHold(terms, before.classification, classification) : null) ??
        rulesKindRefusal(after) ??
        this.ensureNamesAreUnique(terms) ??
        this.ensurePlacementsStayInTheLanguage(terms) ??
        this.ensureInvariantsOnlyOnAggregatesAndValues(terms) ??
        this.ensureAssertionsOnlyOnAggregatesAndServices(terms) ??
        this.ensureProposedTermsKeepTheirProposal(terms) ??
        this.ensureRuleKeysAreUniquePerTerm(terms) ??
        this.ensureRelationsFitTheirKind(terms, termId) ??
        this.ensureRelationsStayInOneBoundedContext(terms, termId),
    );
  }

  /**
   * Records a proposed term in the VocabularyFile as accepted, classified as `classification`.
   * It is recorded only once classified, and only as the file can hold it: arclint's file keeps
   * a term only with a kind, inside a bounded context, and an Aggregate only with its identity.
   */
  record(termId: TermId, classification: Classification | null): Result<UbiquitousLanguage, RefusalError> {
    const before = this.term(termId);
    if (!before) return failure(missingTerm());
    if (before.status !== "proposed") {
      return failure(new RefusalError(`${quoted(before.name)} is already recorded in this Ubiquitous Language.`));
    }
    const refusal = this.assertRecordingRequiresAClassification(classification);
    if (refusal) return failure(refusal);
    const after: DomainTerm = { ...before, status: "accepted", proposal: null, classification };
    const terms = this.terms.map((t) => (t.id === termId ? after : t));
    return this.settle(
      terms,
      this.fileCannotHold(terms, null, classification) ??
        rulesKindRefusal(after) ??
        this.ensureNamesAreUnique(terms) ??
        this.ensurePlacementsStayInTheLanguage(terms) ??
        this.ensureInvariantsOnlyOnAggregatesAndValues(terms) ??
        this.ensureAssertionsOnlyOnAggregatesAndServices(terms) ??
        this.ensureProposedTermsKeepTheirProposal(terms) ??
        this.ensureRuleKeysAreUniquePerTerm(terms) ??
        this.ensureRelationsFitTheirKind(terms, termId) ??
        this.ensureRelationsStayInOneBoundedContext(terms, termId),
    );
  }

  /** Places a Rule on a term: an invariant of an Aggregate or Value Object, or an assertion of an Aggregate or Domain Service. */
  placeRule(termId: TermId, rule: PlacedRule): Result<UbiquitousLanguage, RefusalError> {
    const before = this.term(termId);
    if (!before) return failure(missingTerm());
    const refusal = placementRefusal(before, rule);
    if (refusal) return failure(refusal);
    const after: DomainTerm = { ...before, rules: [...before.rules, rule] };
    const terms = this.terms.map((t) => (t.id === termId ? after : t));
    return this.settle(
      terms,
      this.ensureNamesAreUnique(terms) ??
        this.ensurePlacementsStayInTheLanguage(terms) ??
        this.ensureInvariantsOnlyOnAggregatesAndValues(terms) ??
        this.ensureAssertionsOnlyOnAggregatesAndServices(terms) ??
        this.ensureProposedTermsKeepTheirProposal(terms) ??
        this.ensureRuleKeysAreUniquePerTerm(terms) ??
        this.ensureRelationsFitTheirKind(terms) ??
        this.ensureRelationsStayInOneBoundedContext(terms),
    );
  }

  /** Removes one of a term's PlacedRules. The Features that state it are the caller's to update. */
  removeRule(termId: TermId, ruleKey: string): Result<UbiquitousLanguage, RefusalError> {
    const before = this.term(termId);
    if (!before) return failure(missingTerm());
    if (!before.rules.some((r) => r.key === ruleKey)) {
      return failure(new RefusalError(`${quoted(before.name)} holds no rule keyed ${quoted(ruleKey)}.`));
    }
    const after: DomainTerm = { ...before, rules: before.rules.filter((r) => r.key !== ruleKey) };
    const terms = this.terms.map((t) => (t.id === termId ? after : t));
    return this.settle(
      terms,
      this.ensureNamesAreUnique(terms) ??
        this.ensurePlacementsStayInTheLanguage(terms) ??
        this.ensureInvariantsOnlyOnAggregatesAndValues(terms) ??
        this.ensureAssertionsOnlyOnAggregatesAndServices(terms) ??
        this.ensureProposedTermsKeepTheirProposal(terms) ??
        this.ensureRuleKeysAreUniquePerTerm(terms) ??
        this.ensureRelationsFitTheirKind(terms) ??
        this.ensureRelationsStayInOneBoundedContext(terms),
    );
  }

  // Queries

  term(id: TermId): DomainTerm | undefined {
    return this.terms.find((t) => t.id === id);
  }

  /** Accepted terms only: the ones recognized by name in Features. The same array on every call. */
  acceptedTerms(): readonly DomainTerm[] {
    this.#accepted ??= this.terms.filter((t) => t.status === "accepted");
    return this.#accepted;
  }

  proposedTerms(): readonly DomainTerm[] {
    return this.terms.filter((t) => t.status === "proposed");
  }

  rule(termId: TermId, ruleKey: string): PlacedRule | undefined {
    return this.term(termId)?.rules.find((r) => r.key === ruleKey);
  }

  /** Whether a reference's term, and for a rule reading its rule, is in this language. */
  resolves(target: ReferenceTarget): boolean {
    const term = this.term(target.termId);
    return term !== undefined && (target.ruleKey === null || term.rules.some((r) => r.key === target.ruleKey));
  }

  /** The bounded context a classification puts a term in. An Entity is in its Aggregate's. */
  contextOf(classification: Classification | null): DomainTerm | undefined {
    const id = contextIn(this.terms, classification);
    return id === null ? undefined : this.term(id);
  }

  /**
   * The terms that may fill a relation of a term classified as `classification`: the right
   * kind, not the term itself, and in the same bounded context. Two terms with no bounded
   * context are both in the unplaced language.
   */
  relationCandidates(termId: TermId | null, classification: Classification, relation: Relation): DomainTerm[] {
    const rule = relationRule(classification.kind, relation);
    if (!rule) return [];
    return this.terms.filter((t) => fits(this.terms, termId, classification, rule, t) === "fits");
  }

  /** The classification with every relation that no longer fits cleared, after the author changed another. */
  fitRelations(termId: TermId | null, classification: Classification): Classification {
    const { kind, ...relations } = classification;
    const kept: Partial<Record<Relation, TermId | null>> = { ...relations };
    for (const rule of RELATIONS[kind]) {
      const target = this.related(classification, rule.relation);
      if (target && fits(this.terms, termId, classification, rule, target) !== "fits") kept[rule.relation] = null;
    }
    return classificationOf(kind, kept);
  }

  /** What arclint will need that the classification does not say yet. Never a reason to refuse. */
  arclintNeeds(classification: Classification | null): string[] {
    if (classification?.kind === "aggregate" && relationOf(classification, "identity") === null) {
      return ["arclint needs this Aggregate's identity: a Value Object term from the same bounded context."];
    }
    if (classification?.kind === "entity" && relationOf(classification, "aggregate") === null) {
      return ["arclint needs the Aggregate this Entity belongs to."];
    }
    return [];
  }

  /**
   * The term's qualified name: its bounded context, then its Aggregate for an Entity, then
   * the term, then the value when one is given. Containment only.
   */
  qualifiedName(termId: TermId, value: string | null = null): QualifiedName {
    const term = this.term(termId);
    if (!term) throw new RefusalError("That term is no longer in this Ubiquitous Language.");
    const path: string[] = [];
    const c = term.classification;
    if (c?.kind === "entity") {
      const aggregate = this.related(c, "aggregate");
      if (aggregate?.classification?.kind === "aggregate") {
        const context = this.contextOf(aggregate.classification);
        if (context) path.push(context.name);
        path.push(aggregate.name);
      }
    } else if (c && c.kind !== "bounded_context") {
      const context = this.contextOf(c);
      if (context) path.push(context.name);
    }
    path.push(term.name);
    if (value !== null && cleanTermName(value).length > 0) path.push(value);
    return QualifiedName.of(path);
  }

  /** Every problem a proposal draft has, by field, for showing while the author types. */
  proposalProblems(draft: { name: string; definition: string; classification?: Classification | null }): ProposalProblems {
    const name = cleanTermName(draft.name);
    const definition = draft.definition.trim();
    const problems: ProposalProblems = {};
    const nameRefusal = this.assertProposingRequiresAName(name) ?? this.nameProblem(name, draft.classification ?? null);
    if (nameRefusal) problems.name = nameRefusal.message;
    const definitionRefusal = this.assertProposingRequiresADefinition(definition) ?? definitionProblem(definition);
    if (definitionRefusal) problems.definition = definitionRefusal.message;
    return problems;
  }

  /** The term a classification relates to through `relation`, when it has chosen one. */
  related(classification: Classification, relation: Relation): DomainTerm | undefined {
    const id = relationOf(classification, relation);
    return id === null ? undefined : this.term(id);
  }

  // Invariants

  /** names-are-unique: no two terms in one bounded context whose names differ only in letter case or spacing. */
  private ensureNamesAreUnique(terms: readonly DomainTerm[] = this.terms): RefusalError | null {
    const seen = new Map<string, DomainTerm>();
    for (const term of terms) {
      const key = `${contextIn(terms, term.classification) ?? ""}\u0000${normalizeTermName(term.name)}`;
      const other = seen.get(key);
      if (other) {
        return new RefusalError(`${quoted(other.name)} and ${quoted(term.name)} differ only in letter case or spacing.`, "name");
      }
      seen.set(key, term);
    }
    return null;
  }

  /** placements-stay-in-the-language: a term is classified only in relation to terms of this language. */
  private ensurePlacementsStayInTheLanguage(terms: readonly DomainTerm[] = this.terms): RefusalError | null {
    const ids = new Set(terms.map((t) => t.id));
    for (const term of terms) {
      if (!term.classification) continue;
      const outside = chosenRelations(term.classification).find(({ target }) => !ids.has(target));
      if (outside) {
        return new RefusalError(
          `${quoted(term.name)} is classified in relation to a term outside this Ubiquitous Language: its ${outside.rule.noun}.`,
        );
      }
    }
    return null;
  }

  /** invariants-only-on-aggregates-and-values. */
  private ensureInvariantsOnlyOnAggregatesAndValues(terms: readonly DomainTerm[] = this.terms): RefusalError | null {
    const holder = terms.find(
      (t) => t.rules.some((r) => r.kind === "invariant") && !HOLDS_INVARIANTS.some((k) => k === t.classification?.kind),
    );
    return holder
      ? new RefusalError(`${quoted(holder.name)} holds invariants without being classified as an Aggregate or a Value Object.`)
      : null;
  }

  /** assertions-only-on-aggregates-and-services. */
  private ensureAssertionsOnlyOnAggregatesAndServices(terms: readonly DomainTerm[] = this.terms): RefusalError | null {
    const holder = terms.find(
      (t) => t.rules.some((r) => r.kind === "assertion") && !HOLDS_ASSERTIONS.some((k) => k === t.classification?.kind),
    );
    return holder
      ? new RefusalError(`${quoted(holder.name)} holds assertions without being classified as an Aggregate or a Domain Service.`)
      : null;
  }

  /** proposed-terms-keep-their-proposal. */
  private ensureProposedTermsKeepTheirProposal(terms: readonly DomainTerm[] = this.terms): RefusalError | null {
    const lost = terms.find((t) => t.status === "proposed" && t.proposal === null);
    return lost ? new RefusalError(`${quoted(lost.name)} is proposed but no longer says where it was proposed from.`) : null;
  }

  /** rule-keys-are-unique-per-term */
  private ensureRuleKeysAreUniquePerTerm(terms: readonly DomainTerm[] = this.terms): RefusalError | null {
    for (const term of terms) {
      const keys = new Set<string>();
      for (const rule of term.rules) {
        if (keys.has(rule.key)) return new RefusalError(`${quoted(term.name)} holds two rules keyed ${quoted(rule.key)}.`, "key");
        keys.add(rule.key);
      }
    }
    return null;
  }

  /** relations-fit-their-kind, worded for the term being changed. */
  private ensureRelationsFitTheirKind(
    terms: readonly DomainTerm[] = this.terms,
    changing: TermId | null = null,
  ): RefusalError | null {
    const misfit = firstMisfit(terms, (why) => why !== "context");
    return misfit ? new RefusalError(misfitReason(terms, misfit, changing), misfit.rule.relation) : null;
  }

  /** relations-stay-in-one-bounded-context, worded for the term being changed. */
  private ensureRelationsStayInOneBoundedContext(
    terms: readonly DomainTerm[] = this.terms,
    changing: TermId | null = null,
  ): RefusalError | null {
    const misfit = firstMisfit(terms, (why) => why === "context");
    return misfit ? new RefusalError(misfitReason(terms, misfit, changing), misfit.rule.relation) : null;
  }

  // Assertions

  /** classifying-keeps-acceptance, on Classify. */
  private assertClassifyingKeepsAcceptance(before: DomainTerm, after: DomainTerm): RefusalError | null {
    return before.status !== after.status || before.proposal !== after.proposal
      ? new RefusalError("Classifying a term never changes whether it is accepted or proposed.")
      : null;
  }

  /** recording-requires-a-classification, on Record. */
  private assertRecordingRequiresAClassification(classification: Classification | null): RefusalError | null {
    return classification === null
      ? new RefusalError("Classify the term before recording it in the vocabulary.", "kind")
      : null;
  }

  /** proposing-never-accepts, on Propose. */
  private assertProposingNeverAccepts(term: DomainTerm): RefusalError | null {
    return term.status !== "proposed" ? new RefusalError("Proposing a term never accepts it.") : null;
  }

  /** proposing-requires-a-name, on Propose. */
  private assertProposingRequiresAName(name: string): RefusalError | null {
    return name.length === 0 ? new RefusalError("Enter a term name.", "name") : null;
  }

  /** proposing-requires-a-definition, on Propose. */
  private assertProposingRequiresADefinition(definition: string): RefusalError | null {
    return definition.length === 0 ? new RefusalError("Enter a definition.", "definition") : null;
  }

  // Helpers

  /**
   * Why the VocabularyFile cannot keep an accepted term classified as `classification`, which
   * was classified as `previous` (null for a term not in the file yet). A format that keeps
   * unplaced terms keeps any classification; arclint's needs a kind, a bounded context, an
   * Entity's Aggregate, and the identity of a term that becomes an Aggregate.
   */
  private fileCannotHold(
    terms: readonly DomainTerm[],
    previous: Classification | null,
    classification: Classification | null,
  ): RefusalError | null {
    const file = this.file;
    if (!file) return new RefusalError("This project's vocabulary file has not been read yet.");
    if (!file.found) return new RefusalError(`Create ${file.file} first: this project has no vocabulary file yet.`);
    if (file.holdsUnplacedTerms) return null;
    if (!classification) return new RefusalError(`${file.file} keeps only classified terms. Choose its kind.`, "kind");
    if (classification.kind === "entity") {
      return relationOf(classification, "aggregate") === null
        ? new RefusalError(`${file.file} keeps an Entity only inside its Aggregate. Choose the Aggregate.`, "aggregate")
        : null;
    }
    if (classification.kind !== "bounded_context" && contextIn(terms, classification) === null) {
      return new RefusalError(`${file.file} keeps a term only inside a bounded context. Choose its bounded context.`, "context");
    }
    if (classification.kind === "aggregate" && previous?.kind !== "aggregate" && relationOf(classification, "identity") === null) {
      return new RefusalError(
        `${file.file} keeps an Aggregate only with its identity: a Value Object term from the same bounded context.`,
        "identity",
      );
    }
    return null;
  }

  /** A cleaned name's problems other than being empty: its shape, its length, and a name already taken in its bounded context. */
  private nameProblem(name: string, classification: Classification | null): RefusalError | null {
    if (!hasWordCharacter(name)) return new RefusalError("A term name needs at least one letter or digit.", "name");
    if (name.length > MAX_TERM_NAME_LENGTH) {
      return new RefusalError(`Keep the term name to ${MAX_TERM_NAME_LENGTH} characters or fewer.`, "name");
    }
    const key = normalizeTermName(name);
    const context = contextIn(this.terms, classification);
    const taken = this.terms.find(
      (t) => normalizeTermName(t.name) === key && contextIn(this.terms, t.classification) === context,
    );
    if (!taken) return null;
    return new RefusalError(
      taken.status === "accepted"
        ? `${quoted(taken.name)} is already an accepted term in this project's Ubiquitous Language.`
        : `${quoted(taken.name)} has already been proposed.`,
      "name",
    );
  }

  /** The language with `terms`, or the refusal found while checking them. */
  private settle(terms: readonly DomainTerm[], refusal: RefusalError | null): Result<UbiquitousLanguage, RefusalError> {
    if (refusal) return failure(refusal);
    return attempt(() => new UbiquitousLanguage(this.projectId, this.file, terms));
  }
}

function missingTerm(): RefusalError {
  return new RefusalError("That term is no longer in this Ubiquitous Language.");
}

function definitionProblem(definition: string): RefusalError | null {
  return definition.length > MAX_DEFINITION_LENGTH
    ? new RefusalError(`Keep the definition to ${MAX_DEFINITION_LENGTH} characters or fewer.`, "definition")
    : null;
}

function classifiedAs(term: DomainTerm): string {
  return term.classification ? kindWithArticle(term.classification.kind) : "not classified";
}

/** Why a term reclassified as `after` could no longer hold its rules, in the words an author needs. */
function rulesKindRefusal(after: DomainTerm): RefusalError | null {
  const kind = after.classification?.kind;
  const invariants = after.rules.filter((r) => r.kind === "invariant").length;
  const assertions = after.rules.filter((r) => r.kind === "assertion").length;
  if (invariants > 0 && !HOLDS_INVARIANTS.some((k) => k === kind)) {
    return new RefusalError(
      `Remove its ${plural(invariants, "invariant")} first. Only an Aggregate or a Value Object holds invariants.`,
    );
  }
  if (assertions > 0 && !HOLDS_ASSERTIONS.some((k) => k === kind)) {
    return new RefusalError(
      `Remove its ${plural(assertions, "assertion")} first. Only an Aggregate or a Domain Service holds assertions.`,
    );
  }
  return null;
}

/** Why `rule` cannot be placed on `term`: a key it already uses, or a kind that does not hold such rules. */
function placementRefusal(term: DomainTerm, rule: PlacedRule): RefusalError | null {
  if (term.rules.some((r) => r.key === rule.key)) {
    return new RefusalError(`${quoted(term.name)} already holds a rule keyed ${quoted(rule.key)}. Choose another key.`, "key");
  }
  const kind = term.classification?.kind;
  if (rule.kind === "invariant" && !HOLDS_INVARIANTS.some((k) => k === kind)) {
    return new RefusalError(
      `Only an Aggregate or a Value Object holds invariants, and ${quoted(term.name)} is ${classifiedAs(term)}.`,
      "term",
    );
  }
  if (rule.kind === "assertion" && !HOLDS_ASSERTIONS.some((k) => k === kind)) {
    return new RefusalError(
      `Only an Aggregate or a Domain Service holds assertions, and ${quoted(term.name)} is ${classifiedAs(term)}.`,
      "term",
    );
  }
  return null;
}

function termIdsRepeat(terms: readonly DomainTerm[]): RefusalError | null {
  const ids = new Set<string>();
  for (const term of terms) {
    if (ids.has(term.id)) return new RefusalError(`Two terms share the ID ${term.id}.`);
    ids.add(term.id);
  }
  return null;
}

