import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { kindTitle, type TermKind } from "../domain/term-kind";
import { type Classification } from "../domain/classification";
import type { FeatureId } from "../domain/feature-id";
import type { DomainTerm } from "../domain/domain-term";
import type { TermId } from "../domain/term-id";
import { ruleLabel, type PlacedRule } from "../domain/placed-rule";
import type { UbiquitousLanguage } from "../domain/ubiquitous-language";
import type { ArcLintRule, VocabularyQuestion } from "../application/vocabulary-document";
import { UNCLASSIFIED, kindTermClassName, type MarkedKind } from "../editor/kind-marks";
import { ClassificationFields, termLabel } from "./classification-fields";
import { CloseIcon } from "./icons";
import { KindBadge } from "./kind-badge";

export type PanelTab = "accepted" | "proposed" | "model" | "rules";

const TABS: readonly { tab: PanelTab; label: string }[] = [
  { tab: "accepted", label: "Accepted" },
  { tab: "proposed", label: "Proposed" },
  { tab: "model", label: "Model" },
  { tab: "rules", label: "Rules" },
];

/** Where the project's VocabularyFile stands, as the panel shows it above the terms. */
export type VocabularyStatus =
  | { kind: "loading" }
  | { kind: "problem"; message: string }
  /** The folder has no VocabularyFile yet; creating one writes it in the folder's format. */
  | { kind: "missing"; file: string; format: string; onCreate(): void }
  | { kind: "ready" };

/** The rules arclint enforces in the project's folder, read only. */
export type RulesView =
  | { kind: "loading" }
  | { kind: "problem"; message: string }
  | { kind: "loaded"; format: "arclint" | "bwrite"; rules: readonly ArcLintRule[] };

export interface Occurrence {
  from: number;
  to: number;
  line: number;
  before: string;
  text: string;
  after: string;
  /** Present for an explicit association: what it says about this occurrence. */
  association: string | null;
}

/** Where a placed rule is stated: one Rule line of one feature of the project. */
export interface RuleStatement {
  featureId: FeatureId;
  featureTitle: string;
  line: number;
  from: number;
  to: number;
  /** True when it is in the feature open in the editor, so it can be jumped to. */
  inOpenFeature: boolean;
}

interface VocabularyPanelProps {
  id: string;
  open: boolean;
  /** True when the panel covers the workspace rather than sitting beside it. */
  overlay: boolean;
  projectName: string;
  language: UbiquitousLanguage;
  /** The file in use, such as "Vocabulary: domain.arclint.yaml (arclint)"; null until it is known. */
  fileLabel: string | null;
  status: VocabularyStatus;
  questions: readonly VocabularyQuestion[];
  rules: RulesView;
  tab: PanelTab;
  selection: TermId | null;
  /**
   * Identifies the open term's details across changes of its TermId, so a classification that
   * moves the term keeps the details mounted and keyboard focus where the author left it.
   */
  detailKey: string | null;
  /** Bumped whenever the panel should take focus: the detail heading when one is shown, otherwise the active tab. */
  focusRequest: number;
  recentTermId: TermId | null;
  featureTitleById(id: FeatureId): string | null;
  occurrencesOf(termId: TermId): Occurrence[];
  statementsOf(termId: TermId, ruleKey: string): RuleStatement[];
  onTabChange(tab: PanelTab): void;
  onSelect(termId: TermId | null): void;
  onJumpTo(from: number, to: number): void;
  /** Classifies a term; returns the reason when the language refuses. */
  onClassify(termId: TermId, classification: Classification | null): string | null;
  /** Records a proposed term in the VocabularyFile; returns the reason when the language refuses. */
  onRecord(termId: TermId): string | null;
  onRemoveRule(termId: TermId, rule: PlacedRule, trigger: HTMLElement): void;
  onClose(): void;
}

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

const kindOfTerm = (term: DomainTerm): MarkedKind => term.classification?.kind ?? UNCLASSIFIED;

/**
 * The badge of a term's kind, drawn left of the term's name wherever the panel lists it.
 * Hidden from assistive technology here: the name beside it is the term, and the kind is
 * said in words by the chip, the heading's badge, or the Classification below.
 */
function TermBadge({ term }: { term: DomainTerm }) {
  return (
    <span className="bw-term-badge" aria-hidden="true">
      <KindBadge kind={kindOfTerm(term)} proposed={term.status === "proposed"} />
    </span>
  );
}

const HOLDS_RULES: readonly TermKind[] = ["aggregate", "value_object", "domain_service"];

export function VocabularyPanel(props: VocabularyPanelProps) {
  const { open, tab, selection, language } = props;
  const detailHeadingRef = useRef<HTMLHeadingElement>(null);
  const lastListItem = useRef<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const accepted = language.acceptedTerms();
  const proposed = language.proposedTerms();
  const term = selection === null ? undefined : language.term(selection);

  useEffect(() => {
    if (!open || props.focusRequest === 0) return;
    if (term) detailHeadingRef.current?.focus();
    else document.getElementById(`${props.id}-tab-${tab}`)?.focus();
    // Focus follows explicit requests only, never ordinary re-renders.
  }, [props.focusRequest]);

  useEffect(() => {
    if (term || !lastListItem.current) return;
    listRef.current?.querySelector<HTMLElement>(`[data-item-id="${lastListItem.current}"]`)?.focus();
    lastListItem.current = null;
  }, [Boolean(term)]);

  if (!open) return null;

  const select = (termId: TermId) => {
    lastListItem.current = termId;
    props.onSelect(termId);
  };

  const onTabKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const index = TABS.findIndex((t) => t.tab === tab);
    const next = TABS[(index + (event.key === "ArrowRight" ? 1 : TABS.length - 1)) % TABS.length].tab;
    props.onTabChange(next);
    document.getElementById(`${props.id}-tab-${next}`)?.focus();
  };

  return (
    <aside
      id={props.id}
      className={`bw-panel${props.overlay ? " is-overlay" : ""}`}
      aria-label="Ubiquitous Language"
      onKeyDown={(event) => {
        if (event.key === "Escape" && !event.defaultPrevented) {
          event.preventDefault();
          props.onClose();
        }
      }}
    >
      <header className="bw-panel__header">
        <div>
          <div className="bw-panel__eyebrow">Ubiquitous Language</div>
          <div className="bw-panel__title">{props.projectName}</div>
          {props.fileLabel && (
            <div className="bw-panel__file" data-testid="vocabulary-file">
              {props.fileLabel}
            </div>
          )}
        </div>
        <button
          type="button"
          className="bw-icon-button"
          aria-label="Close Ubiquitous Language panel"
          title="Close"
          onClick={props.onClose}
        >
          <CloseIcon />
        </button>
      </header>

      {term ? (
        <TermDetail
          key={props.detailKey ?? term.id}
          headingRef={detailHeadingRef}
          term={term}
          language={language}
          projectName={props.projectName}
          featureTitle={term.proposal ? props.featureTitleById(term.proposal.featureId) : null}
          occurrences={props.occurrencesOf(term.id)}
          statementsOf={(key) => props.statementsOf(term.id, key)}
          onClassify={(c) => props.onClassify(term.id, c)}
          onRecord={() => props.onRecord(term.id)}
          onRemoveRule={(rule, trigger) => props.onRemoveRule(term.id, rule, trigger)}
          onBack={() => props.onSelect(null)}
          onJumpTo={props.onJumpTo}
        />
      ) : (
        <>
          <VocabularyStatusNote status={props.status} />
          <div className="bw-tabs" role="tablist" aria-label="Ubiquitous Language views">
            {TABS.map(({ tab: t, label }) => (
              <button
                key={t}
                id={`${props.id}-tab-${t}`}
                type="button"
                role="tab"
                className="bw-tabs__tab"
                aria-selected={tab === t}
                aria-controls={`${props.id}-tabpanel`}
                tabIndex={tab === t ? 0 : -1}
                onClick={() => props.onTabChange(t)}
                onKeyDown={onTabKey}
              >
                {label}
                {(t === "accepted" || t === "proposed") && (
                  <span className="bw-tabs__count">{t === "accepted" ? accepted.length : proposed.length}</span>
                )}
              </button>
            ))}
          </div>
          <div ref={listRef} id={`${props.id}-tabpanel`} role="tabpanel" aria-labelledby={`${props.id}-tab-${tab}`}>
            {tab === "rules" ? (
              <RulesList view={props.rules} />
            ) : tab === "model" ? (
              <>
                <ModelView language={language} onSelect={(t) => select(t.id)} />
                <OpenQuestions questions={props.questions} />
              </>
            ) : tab === "accepted" && accepted.length === 0 ? (
              <p className="bw-panel__empty">No accepted terms in this project yet. Proposed terms stay proposed until they are accepted.</p>
            ) : tab === "accepted" ? (
              <ul className="bw-term-list">
                {accepted.map((t) => (
                  <li key={t.id}>
                    <TermListItem term={t} language={language} recent={false} onSelect={() => select(t.id)} />
                  </li>
                ))}
              </ul>
            ) : proposed.length === 0 ? (
              <p className="bw-panel__empty">No proposed terms. Select text in the feature and choose “Propose selected term”.</p>
            ) : (
              <ul className="bw-term-list">
                {[...proposed].reverse().map((t) => (
                  <li key={t.id}>
                    <TermListItem term={t} language={language} recent={t.id === props.recentTermId} onSelect={() => select(t.id)} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </aside>
  );
}

function VocabularyStatusNote({ status }: { status: VocabularyStatus }) {
  if (status.kind === "ready") return null;
  if (status.kind === "loading") {
    return (
      <p className="bw-panel__status" role="status" data-testid="vocabulary-status">
        Reading the project's vocabulary file…
      </p>
    );
  }
  if (status.kind === "problem") {
    return (
      <div className="bw-panel__status is-error" role="alert" data-testid="vocabulary-status">
        <p>{status.message}</p>
      </div>
    );
  }
  return (
    <div className="bw-panel__status" data-testid="vocabulary-status">
      <p>
        This folder has no vocabulary file yet. BWrite keeps this project's Ubiquitous Language in{" "}
        <code>{status.file}</code> ({status.format}).
      </p>
      <button type="button" className="bw-button bw-button--primary" onClick={status.onCreate}>
        Create {status.file}
      </button>
    </div>
  );
}

function RulesList({ view }: { view: RulesView }) {
  if (view.kind === "loading") return <p className="bw-panel__empty">Reading arclint's rules…</p>;
  if (view.kind === "problem") return <p className="bw-panel__empty" role="alert">{view.message}</p>;
  if (view.format === "bwrite") {
    return (
      <p className="bw-panel__empty">
        This folder is not set up for arclint, so no architecture rules apply. Rules appear here once the folder has a
        rules.arclint.yaml.
      </p>
    );
  }
  if (view.rules.length === 0) return <p className="bw-panel__empty">arclint enforces no rules in this folder.</p>;
  return (
    <ul className="bw-rule-list" aria-label="arclint rules">
      {view.rules.map((rule) => (
        <li key={rule.id} className="bw-rule-list__item" data-testid="arclint-rule">
          <div className="bw-rule-list__head">
            <code className="bw-rule-list__id">{rule.id}</code>
            <span className={`bw-badge bw-badge--${rule.severity === "error" ? "error" : "quiet"}`}>{rule.severity}</span>
          </div>
          <p className="bw-rule-list__proposition">{rule.proposition}</p>
        </li>
      ))}
    </ul>
  );
}

function OpenQuestions({ questions }: { questions: readonly VocabularyQuestion[] }) {
  if (questions.length === 0) return null;
  return (
    <section aria-label="Open questions" className="bw-model__questions">
      <h3 className="bw-detail__subheading">Open questions</h3>
      <ul className="bw-question-list">
        {questions.map((q) => (
          <li key={`${q.context ?? ""}/${q.key}`} className="bw-question-list__item">
            <p>{q.text}</p>
            <span className="bw-question-list__meta">
              {q.context ? `${q.context} · ` : ""}
              <code>{q.key}</code>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function TermListItem(props: { term: DomainTerm; language: UbiquitousLanguage; recent: boolean; onSelect(): void }) {
  const { term } = props;
  return (
    <button
      type="button"
      className={`bw-term-list__item${props.recent ? " is-recent" : ""}`}
      data-item-id={term.id}
      onClick={props.onSelect}
    >
      <span className="bw-term-list__name">
        <TermBadge term={term} />
        {term.name}
        {term.status === "proposed" && <span className="bw-badge bw-badge--proposed">Proposed</span>}
        <KindChips term={term} language={props.language} />
      </span>
      <span className="bw-term-list__definition">{term.definition}</span>
    </button>
  );
}

/** The kind of a term and the names it sits under. */
function KindChips({ term, language }: { term: DomainTerm; language: UbiquitousLanguage }) {
  if (!term.classification) return null;
  const containers = language.qualifiedName(term.id).containers;
  return (
    <>
      <span className="bw-chip">{kindTitle(term.classification.kind)}</span>
      {containers.length > 0 && <span className="bw-chip bw-chip--context">{containers.join(" › ")}</span>}
    </>
  );
}

function Modeling(props: { term: DomainTerm; language: UbiquitousLanguage; onClassify(c: Classification | null): string | null }) {
  const { term, language } = props;
  const [refusal, setRefusal] = useState<string | null>(null);
  const path = language.qualifiedName(term.id).path;
  return (
    <div className="bw-detail__modeling">
      {path.length > 1 && (
        <nav className="bw-path" aria-label="Place in the model">
          <ol>
            {path.map((name, i) => (
              <li key={`${i}-${name}`} aria-current={i === path.length - 1 ? "true" : undefined}>
                {name}
              </li>
            ))}
          </ol>
        </nav>
      )}
      {refusal && (
        <p className="bw-detail__refusal" role="alert">
          Not changed. {refusal}
        </p>
      )}
      <ClassificationFields
        termId={term.id}
        value={term.classification}
        language={language}
        onChange={(next) => setRefusal(props.onClassify(next))}
      />
    </div>
  );
}

function Rules(props: {
  term: DomainTerm;
  statementsOf(ruleKey: string): RuleStatement[];
  onRemoveRule(rule: PlacedRule, trigger: HTMLElement): void;
  onJumpTo(from: number, to: number): void;
}) {
  const { term } = props;
  const holdsRules = term.classification !== null && HOLDS_RULES.includes(term.classification.kind);
  if (!holdsRules && term.rules.length === 0) return null;
  return (
    <section aria-labelledby={`rules-${term.id}`}>
      <h3 id={`rules-${term.id}`} className="bw-detail__subheading">
        Invariants and assertions
      </h3>
      {term.rules.length === 0 ? (
        <p className="bw-panel__empty">
          None placed yet. Put the cursor on a line that starts with “Rule:” and choose Place rule.
        </p>
      ) : (
        <ul className="bw-rules" aria-label={`Rules of ${term.name}`}>
          {term.rules.map((rule) => {
            const statements = props.statementsOf(rule.key);
            return (
              <li key={rule.key} className="bw-rules__item">
                <div className="bw-rules__head">
                  <span className="bw-chip">{rule.kind === "invariant" ? "Invariant" : `Assertion on ${rule.operation}`}</span>
                  <code className="bw-rules__key">{rule.key}</code>
                </div>
                <p className="bw-rules__statement">{rule.statement}</p>
                <ul className="bw-rules__where" aria-label="Where it is stated">
                  {statements.length === 0 ? (
                    <li>Not stated in any feature now.</li>
                  ) : (
                    statements.map((s) => (
                      <li key={`${s.featureId}-${s.from}`}>
                        {s.inOpenFeature ? (
                          <button type="button" className="bw-link-button" onClick={() => props.onJumpTo(s.from, s.to)}>
                            Line {s.line} of this feature
                          </button>
                        ) : (
                          `Line ${s.line} of “${s.featureTitle}”`
                        )}
                      </li>
                    ))
                  )}
                </ul>
                <button
                  type="button"
                  className="bw-link-button bw-rules__remove"
                  aria-label={`Remove ${ruleLabel(rule)} ${rule.key}`}
                  onClick={(event) => props.onRemoveRule(rule, event.currentTarget)}
                >
                  Remove
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function ModelView({ language, onSelect }: { language: UbiquitousLanguage; onSelect(term: DomainTerm): void }) {
  const item = (term: DomainTerm, children?: ReactNode) => (
    <li key={term.id}>
      <button type="button" className="bw-model__item" data-item-id={term.id} onClick={() => onSelect(term)}>
        <TermBadge term={term} />
        <span className="bw-model__name">{termLabel(term)}</span>
        {term.classification && <span className="bw-chip">{kindTitle(term.classification.kind)}</span>}
      </button>
      {children}
    </li>
  );

  /** What one bounded context, or the unplaced language, holds: aggregates with their entities, then the rest. */
  const holdings = (contextId: TermId | null) => {
    const inContext = language.terms.filter(
      (t) =>
        t.classification &&
        t.classification.kind !== "bounded_context" &&
        t.classification.kind !== "entity" &&
        (language.contextOf(t.classification)?.id ?? null) === contextId,
    );
    const ofKind = (kind: TermKind) => inContext.filter((t) => t.classification?.kind === kind);
    const entitiesOf = (aggregate: DomainTerm | null) =>
      language.terms.filter(
        (t) => t.classification?.kind === "entity" && (language.related(t.classification, "aggregate")?.id ?? null) === (aggregate?.id ?? null),
      );
    const group = (label: string, members: readonly DomainTerm[]) =>
      members.length > 0 && (
        <li className="bw-model__group">
          <span className="bw-model__group-label">{label}</span>
          <ul>{members.map((m) => item(m))}</ul>
        </li>
      );
    const aggregates = ofKind("aggregate");
    return (
      <>
        {aggregates.length > 0 && (
          <li className="bw-model__group">
            <span className="bw-model__group-label">Aggregates</span>
            <ul>
              {aggregates.map((a) => {
                const entities = entitiesOf(a);
                return item(a, entities.length > 0 ? <ul>{entities.map((e) => item(e))}</ul> : undefined);
              })}
            </ul>
          </li>
        )}
        {contextId === null && group("Entities without an Aggregate", entitiesOf(null))}
        {group("Value Objects", ofKind("value_object"))}
        {group("Domain Events", ofKind("domain_event"))}
        {group("Domain Services", ofKind("domain_service"))}
        {group("Specifications", ofKind("specification"))}
      </>
    );
  };

  if (language.terms.length === 0) return <p className="bw-panel__empty">No terms yet.</p>;
  const contexts = language.terms.filter((t) => t.classification?.kind === "bounded_context");
  const unplaced = language.terms.filter(
    (t) => t.classification && t.classification.kind !== "bounded_context" && language.contextOf(t.classification) === undefined,
  );
  const unclassified = language.terms.filter((t) => !t.classification);
  return (
    <div className="bw-model">
      {contexts.length > 0 && (
        <ul className="bw-model__tree" aria-label="Bounded contexts">
          {contexts.map((context) => item(context, <ul>{holdings(context.id)}</ul>))}
        </ul>
      )}
      {unplaced.length > 0 && (
        <section aria-label="Not in a bounded context">
          <h3 className="bw-detail__subheading">Not in a bounded context</h3>
          <ul className="bw-model__tree">{holdings(null)}</ul>
        </section>
      )}
      {unclassified.length > 0 && (
        <section aria-label="Not classified">
          <h3 className="bw-detail__subheading">Not classified</h3>
          <ul className="bw-model__tree">{unclassified.map((t) => item(t))}</ul>
        </section>
      )}
    </div>
  );
}

function Occurrences({
  term,
  occurrences,
  onJumpTo,
}: {
  term: DomainTerm;
  occurrences: Occurrence[];
  onJumpTo(from: number, to: number): void;
}) {
  return (
    <>
      <h3 className="bw-detail__subheading">In this feature</h3>
      {occurrences.length === 0 ? (
        <p className="bw-panel__empty">Not used in this feature.</p>
      ) : (
        <ul className="bw-occurrences">
          {occurrences.map((o) => (
            <li key={o.from}>
              <button type="button" className="bw-occurrences__item" onClick={() => onJumpTo(o.from, o.to)}>
                <span className="bw-occurrences__line">Line {o.line}</span>
                <span className="bw-occurrences__snippet">
                  {o.before}
                  <TermBadge term={term} />
                  <mark className={kindTermClassName(kindOfTerm(term))}>{o.text}</mark>
                  {o.after}
                </span>
                {o.association && <span className="bw-occurrences__association">{o.association}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

interface TermDetailProps {
  headingRef: RefObject<HTMLHeadingElement | null>;
  term: DomainTerm;
  language: UbiquitousLanguage;
  projectName: string;
  /** The title of the feature a proposed term came from; null when that feature is gone. */
  featureTitle: string | null;
  occurrences: Occurrence[];
  statementsOf(ruleKey: string): RuleStatement[];
  onClassify(c: Classification | null): string | null;
  onRecord(): string | null;
  onRemoveRule(rule: PlacedRule, trigger: HTMLElement): void;
  onBack(): void;
  onJumpTo(from: number, to: number): void;
}

function TermDetail(props: TermDetailProps) {
  const { headingRef, term, onBack } = props;
  const proposal = term.proposal;
  return (
    <section className="bw-detail" aria-labelledby={`detail-${term.id}`}>
      <BackButton onBack={onBack} />
      <div className="bw-detail__status">
        {term.status === "accepted" ? (
          <span className="bw-badge bw-badge--accepted">Accepted</span>
        ) : (
          <span className="bw-badge bw-badge--proposed">Proposed</span>
        )}
      </div>
      <div className="bw-detail__title">
        <KindBadge kind={kindOfTerm(term)} proposed={term.status === "proposed"} />
        <h2 id={`detail-${term.id}`} ref={headingRef} tabIndex={-1} className="bw-detail__name">
          {term.name}
        </h2>
      </div>
      <p className="bw-detail__definition">{term.definition}</p>
      <dl className="bw-detail__meta">
        <div>
          <dt>Project</dt>
          <dd>{props.projectName}</dd>
        </div>
        {proposal && (
          <>
            <div>
              <dt>Source feature</dt>
              <dd>{props.featureTitle === null ? "Feature no longer available" : props.featureTitle.trim() || "Untitled feature"}</dd>
            </div>
            <div>
              <dt>Selected text</dt>
              <dd>
                <q className="bw-detail__source">{proposal.text}</q>
              </dd>
            </div>
            <div>
              <dt>Proposed</dt>
              <dd>
                <time dateTime={proposal.proposedAt}>{dateFormat.format(new Date(proposal.proposedAt))}</time>
              </dd>
            </div>
          </>
        )}
      </dl>
      {term.status === "proposed" && <RecordTerm language={props.language} onRecord={props.onRecord} />}
      <Modeling term={term} language={props.language} onClassify={props.onClassify} />
      <Rules term={term} statementsOf={props.statementsOf} onRemoveRule={props.onRemoveRule} onJumpTo={props.onJumpTo} />
      <Occurrences term={term} occurrences={props.occurrences} onJumpTo={props.onJumpTo} />
    </section>
  );
}

function RecordTerm(props: { language: UbiquitousLanguage; onRecord(): string | null }) {
  const [refusal, setRefusal] = useState<string | null>(null);
  const file = props.language.file;
  return (
    <div className="bw-detail__record">
      <p className="bw-detail__note">
        Proposed terms are not highlighted by name in features, but an occurrence can be associated with one
        explicitly. Classify it, then record it to make it an accepted term
        {file ? (
          <>
            {" "}
            in <code>{file.file}</code>
          </>
        ) : null}
        .
      </p>
      <button type="button" className="bw-button bw-button--primary" onClick={() => setRefusal(props.onRecord())}>
        Record in vocabulary
      </button>
      {refusal && (
        <p className="bw-field__error" role="alert">
          {refusal}
        </p>
      )}
    </div>
  );
}

function BackButton({ onBack }: { onBack(): void }) {
  return (
    <button type="button" className="bw-link-button bw-detail__back" onClick={onBack}>
      <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
        <path d="M10 3L5 8l5 5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
      All terms
    </button>
  );
}

