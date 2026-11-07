import { useId } from "react";
import { CONCEPTS_NOT_TERM_KINDS, KIND_LEVELS, arclintConcept, kindTitle, type TermKind } from "../domain/term-kind";
import { RELATIONS, relationOf, withKind, withRelation, type Classification } from "../domain/classification";
import type { DomainTerm } from "../domain/domain-term";
import type { TermId } from "../domain/term-id";
import type { UbiquitousLanguage } from "../domain/ubiquitous-language";
import { UNCLASSIFIED } from "../editor/kind-marks";
import { KindPicker, type PickerOption } from "./kind-picker";

interface ClassificationFieldsProps {
  /** The term being classified; null while it is still being proposed. */
  termId: TermId | null;
  value: Classification | null;
  /** The language whose terms the classification relates to. */
  language: UbiquitousLanguage;
  onChange(next: Classification | null): void;
}

/** The opening clause of ArcLint's meaning; the full text is one click away. */
function summary(meaning: string): string {
  const end = meaning.search(/[:.](\s|$)/);
  return end < 0 ? meaning : `${meaning.slice(0, end)}.`;
}

export function termLabel(term: DomainTerm): string {
  return term.status === "proposed" ? `${term.name} (proposed)` : term.name;
}

const KIND_OPTIONS: readonly PickerOption[] = [
  { value: "", label: "Not classified", kind: UNCLASSIFIED },
  ...KIND_LEVELS.flatMap((level) =>
    level.kinds.map((k) => ({ value: k, label: kindTitle(k), kind: k, group: level.label })),
  ),
];

/** The terms a relationship can point at, each with the badge of its kind. */
function termOptions(candidates: readonly DomainTerm[]): PickerOption[] {
  return [
    { value: "", label: "Not chosen", kind: null },
    ...candidates.map((c) => ({
      value: c.id,
      label: termLabel(c),
      kind: c.classification?.kind ?? UNCLASSIFIED,
      proposed: c.status === "proposed",
    })),
  ];
}

/** Clicking a label moves focus to the combobox it names, as it does for a native control. */
function focusControl(id: string) {
  document.getElementById(id)?.focus();
}

/** Where an Entity's bounded context comes from, in one sentence. */
function derivedContext(language: UbiquitousLanguage, value: Classification): string {
  const aggregate = language.related(value, "aggregate");
  if (!aggregate) return "None yet. An Entity is in the bounded context of its Aggregate.";
  const context = language.contextOf(value);
  return context
    ? `${context.name}, from its Aggregate ${aggregate.name}.`
    : `None. Its Aggregate ${aggregate.name} is not in a bounded context.`;
}

/**
 * Classifies a term with ArcLint's DDD vocabulary: the kind, grouped by where it nests,
 * then the relationships that kind takes, all optional. Only terms that fit are offered.
 */
export function ClassificationFields({ termId, value, language, onChange }: ClassificationFieldsProps) {
  const ids = useId();
  const kind = value?.kind ?? null;
  const concept = kind ? arclintConcept(kind) : null;
  const needs = language.arclintNeeds(value);
  const change = (next: Classification | null) => onChange(next && language.fitRelations(termId, next));

  return (
    <fieldset className="bw-classification">
      <legend className="bw-classification__legend">Classification</legend>
      <div className="bw-field">
        <label id={`${ids}-kind-label`} onClick={() => focusControl(`${ids}-kind`)}>
          Kind
        </label>
        <KindPicker
          id={`${ids}-kind`}
          labelId={`${ids}-kind-label`}
          describedBy={`${ids}-kind-note`}
          options={KIND_OPTIONS}
          value={kind ?? ""}
          onChange={(next) => change(withKind(value, (next || null) as TermKind | null))}
        />
        <p id={`${ids}-kind-note`} className="bw-field__note">
          {concept
            ? summary(concept.meaning)
            : "Kinds come from ArcLint's Domain-Driven Design vocabulary. Classifying never changes whether the term is accepted or proposed."}
        </p>
        {kind === "aggregate" && <p className="bw-field__note">{CONCEPTS_NOT_TERM_KINDS.aggregate_root}</p>}
      </div>

      {value?.kind === "entity" && (
        <div className="bw-field">
          <span className="bw-field__label" id={`${ids}-derived-label`}>
            Bounded context
          </span>
          <p className="bw-field__derived" aria-labelledby={`${ids}-derived-label`} data-testid="derived-context">
            {derivedContext(language, value)}
          </p>
        </div>
      )}

      {value &&
        RELATIONS[value.kind].map((rule) => {
          const current = relationOf(value, rule.relation);
          const candidates = language.relationCandidates(termId, value, rule.relation);
          const fieldId = `${ids}-${rule.relation}`;
          return (
            <div key={rule.relation} className="bw-field">
              <label id={`${fieldId}-label`} onClick={() => focusControl(fieldId)}>
                {rule.label}
                <span className="bw-field__optional"> (optional)</span>
              </label>
              <KindPicker
                id={fieldId}
                labelId={`${fieldId}-label`}
                describedBy={`${fieldId}-note`}
                options={termOptions(candidates)}
                value={current ?? ""}
                onChange={(next) => change(withRelation(value, rule.relation, (next || null) as TermId | null))}
              />
              <p id={`${fieldId}-note`} className="bw-field__note">
                {candidates.length === 0 ? `No ${kindTitle(rule.target)} term fits yet. ${rule.help}` : rule.help}
              </p>
            </div>
          );
        })}

      {needs.length > 0 && (
        <ul className="bw-classification__needs" aria-label="What arclint needs later">
          {needs.map((need) => (
            <li key={need}>{need}</li>
          ))}
        </ul>
      )}

      {concept && (
        <details className="bw-classification__questions">
          <summary>About {concept.title} in ArcLint</summary>
          <p>{concept.meaning}</p>
          <p className="bw-classification__asks">Ask:</p>
          <ul>
            {concept.questions.map((q) => (
              <li key={q}>{q}</li>
            ))}
          </ul>
          <p className="bw-field__note">{concept.supplies}</p>
        </details>
      )}
    </fieldset>
  );
}
