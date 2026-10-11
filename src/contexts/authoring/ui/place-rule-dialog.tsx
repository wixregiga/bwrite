import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { kindTitle, type TermKind } from "../domain/term-kind";
import type { TermId } from "../domain/term-id";
import {
  placedRuleOf,
  placedRuleProblems,
  ruleKeyFrom,
  type PlacedRule,
  type PlacedRuleDraft,
  type PlacedRuleKind,
} from "../domain/placed-rule";
import type { UbiquitousLanguage } from "../domain/ubiquitous-language";
import { termLabel } from "./classification-fields";

const HOLDERS: Record<PlacedRuleKind, readonly TermKind[]> = {
  invariant: ["aggregate", "value_object"],
  assertion: ["aggregate", "domain_service"],
};

const HOLDERS_TEXT: Record<PlacedRuleKind, string> = {
  invariant: "an Aggregate or a Value Object",
  assertion: "an Aggregate or a Domain Service",
};

/** What placing said: null when the rule was placed, otherwise the refusal and the field it is about. */
export interface PlacementOutcome {
  reason: string;
  concerns: string | null;
}

interface PlaceRuleDialogProps {
  /** The rule's text as written after "Rule:". */
  ruleText: string;
  line: number;
  language: UbiquitousLanguage;
  /** Text of associations on the Rule's text, which placing replaces. */
  replaced: readonly string[];
  undoShortcut: string;
  onPlace(termId: TermId, rule: PlacedRule): PlacementOutcome | null;
  /** Called after the dialog closes, whether placed or cancelled. */
  onClosed(): void;
}

/**
 * Places a Gherkin Rule on the term it belongs to: as an invariant of an Aggregate or
 * Value Object, or as an assertion on an operation of an Aggregate or Domain Service.
 */
export function PlaceRuleDialog(props: PlaceRuleDialogProps) {
  const { ruleText, language, onPlace, onClosed } = props;
  const dialogRef = useRef<HTMLDialogElement>(null);
  const firstRef = useRef<HTMLInputElement>(null);
  const ids = useId();

  const [kind, setKind] = useState<PlacedRuleKind>("invariant");
  const [termId, setTermId] = useState<string>("");
  const [operation, setOperation] = useState("");
  const [key, setKey] = useState(() => ruleKeyFrom(ruleText));
  const [statement, setStatement] = useState(ruleText);
  const [submitted, setSubmitted] = useState(false);
  const [refusal, setRefusal] = useState<PlacementOutcome | null>(null);

  useEffect(() => {
    // No close() on cleanup: it would fire "close" and report a dismissal the user never made.
    const dialog = dialogRef.current!;
    if (!dialog.open) dialog.showModal();
    firstRef.current!.focus();
  }, []);

  const holders = language.terms.filter((t) => HOLDERS[kind].some((k) => k === t.classification?.kind));
  const term = holders.find((t) => t.id === termId);
  const draft: PlacedRuleDraft = { kind, key, statement, operation };
  const problems = submitted ? placedRuleProblems(draft) : {};
  const termProblem = submitted && !term ? `Choose the term this ${kind} belongs to.` : undefined;
  const keyProblem = problems.key ?? (refusal?.concerns === "key" ? refusal.reason : undefined);
  const formRefusal = refusal && refusal.concerns !== "key" ? refusal.reason : null;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    setRefusal(null);
    const found = placedRuleProblems(draft);
    if (!term || found.key || found.statement || found.operation) return;
    const outcome = onPlace(term.id, placedRuleOf(draft));
    if (outcome) setRefusal(outcome);
    else dialogRef.current!.close();
  };

  const kindLabel = kind === "invariant" ? "invariant" : "assertion";

  return (
    <dialog ref={dialogRef} className="bw-dialog bw-dialog--wide" aria-labelledby={`${ids}-title`} onClose={onClosed}>
      <form className="bw-proposal" onSubmit={submit} noValidate>
        <header className="bw-proposal__header">
          <h2 id={`${ids}-title`} className="bw-proposal__title">
            Place rule
          </h2>
          <p className="bw-proposal__lede">
            Line {props.line}: <q className="bw-proposal__source">{ruleText}</q>
          </p>
        </header>

        <fieldset className="bw-choice">
          <legend>This rule is</legend>
          <label className="bw-choice__option">
            <input
              ref={firstRef}
              type="radio"
              name={`${ids}-kind`}
              checked={kind === "invariant"}
              onChange={() => setKind("invariant")}
            />
            an invariant: it holds at all times
          </label>
          <label className="bw-choice__option">
            <input type="radio" name={`${ids}-kind`} checked={kind === "assertion"} onChange={() => setKind("assertion")} />
            an assertion: it is checked when an operation completes
          </label>
        </fieldset>

        <div className="bw-field">
          <label htmlFor={`${ids}-term`}>Term</label>
          <select
            id={`${ids}-term`}
            className="bw-select"
            value={term ? term.id : ""}
            aria-invalid={termProblem ? true : undefined}
            aria-describedby={`${ids}-term-note`}
            onChange={(event) => setTermId(event.target.value)}
          >
            <option value="">Choose…</option>
            {holders.map((t) => (
              <option key={t.id} value={t.id}>
                {`${termLabel(t)} · ${kindTitle(t.classification!.kind)}`}
              </option>
            ))}
          </select>
          <p id={`${ids}-term-note`} className={termProblem ? "bw-field__error" : "bw-field__note"}>
            {termProblem ??
              (holders.length === 0
                ? `No term is classified as ${HOLDERS_TEXT[kind]} yet. Classify one in the Ubiquitous Language panel first.`
                : `Only a term classified as ${HOLDERS_TEXT[kind]} holds ${kindLabel}s.`)}
          </p>
        </div>

        {kind === "assertion" && (
          <div className="bw-field">
            <label htmlFor={`${ids}-operation`}>Operation</label>
            <input
              id={`${ids}-operation`}
              type="text"
              autoComplete="off"
              value={operation}
              aria-invalid={problems.operation ? true : undefined}
              aria-describedby={`${ids}-operation-note`}
              onChange={(event) => setOperation(event.target.value)}
            />
            <p id={`${ids}-operation-note`} className={problems.operation ? "bw-field__error" : "bw-field__note"}>
              {problems.operation ?? "The operation this assertion is checked on, such as Classify."}
            </p>
          </div>
        )}

        <div className="bw-field">
          <label htmlFor={`${ids}-key`}>Key</label>
          <input
            id={`${ids}-key`}
            type="text"
            autoComplete="off"
            value={key}
            aria-invalid={keyProblem ? true : undefined}
            aria-describedby={`${ids}-key-note`}
            onChange={(event) => setKey(event.target.value)}
          />
          <p id={`${ids}-key-note`} className={keyProblem ? "bw-field__error" : "bw-field__note"}>
            {keyProblem ?? "A short name for the rule, unique within its term: lowercase words joined by hyphens."}
          </p>
        </div>

        <div className="bw-field">
          <label htmlFor={`${ids}-statement`}>Statement</label>
          <textarea
            id={`${ids}-statement`}
            rows={2}
            value={statement}
            aria-invalid={problems.statement ? true : undefined}
            aria-describedby={problems.statement ? `${ids}-statement-error` : undefined}
            onChange={(event) => setStatement(event.target.value)}
          />
          {problems.statement && (
            <p id={`${ids}-statement-error`} className="bw-field__error">
              {problems.statement}
            </p>
          )}
        </div>

        {formRefusal && (
          <p className="bw-field__error" role="alert">
            {formRefusal}
          </p>
        )}

        <section className="bw-preview" aria-label="Preview">
          <h3 className="bw-preview__title">Preview</h3>
          <p className="bw-field__note">
            {term
              ? `Saving adds this ${kindLabel} to ${term.name} and ties the Rule's text to it. ${props.undoShortcut} in the editor undoes both.`
              : `Saving adds this ${kindLabel} to the term you choose and ties the Rule's text to it.`}
          </p>
          {props.replaced.length > 0 && (
            <p className="bw-field__note">
              Saving replaces the association on {props.replaced.map((text) => `“${text}”`).join(", ")}.
            </p>
          )}
        </section>

        <div className="bw-proposal__actions">
          <button type="button" className="bw-button" onClick={() => dialogRef.current!.close()}>
            Cancel
          </button>
          <button type="submit" className="bw-button bw-button--primary">
            Place rule
          </button>
        </div>
      </form>
    </dialog>
  );
}
