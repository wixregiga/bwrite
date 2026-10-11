import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { kindTitle } from "../domain/term-kind";
import { termReferenceOf, type Reading, type TermReference } from "../domain/term-reference";
import type { DomainTerm } from "../domain/domain-term";
import type { TermId } from "../domain/term-id";
import type { UbiquitousLanguage } from "../domain/ubiquitous-language";
import {
  describeReference,
  referenceDraftErrors,
  replacementPreview,
  wordingError,
  wordingOptions,
  type ReferenceDraft,
  type WordingOption,
} from "../domain/references";
import { cleanTermName } from "../domain/terms";
import { termLabel } from "./classification-fields";

interface ReferenceDialogProps {
  /** The feature text and the occurrence being associated within it. */
  body: string;
  from: number;
  to: number;
  /** The association already on exactly this occurrence, when editing one. */
  existing: TermReference | null;
  /** Other associations overlapping the occurrence, which saving replaces. */
  replaced: readonly TermReference[];
  language: UbiquitousLanguage;
  undoShortcut: string;
  /** `draft` null removes the association; `wording` null keeps the text unchanged. */
  onApply(draft: ReferenceDraft | null, wording: string | null): void;
  /** Called after the dialog closes, whether applied or cancelled. */
  onClosed(): void;
}

type WordingChoice = WordingOption["id"] | "custom";
type ReadingChoice = "names" | "value";

function groupLabel(term: DomainTerm, language: UbiquitousLanguage): string {
  if (!term.classification) return "Not classified";
  if (term.classification.kind === "bounded_context") return "Bounded contexts";
  const context = language.contextOf(term.classification);
  return context ? `In ${context.name}` : "Not in a bounded context";
}

function grouped(options: readonly DomainTerm[], language: UbiquitousLanguage): [string, DomainTerm[]][] {
  const groups = new Map<string, DomainTerm[]>();
  for (const term of options) {
    const label = groupLabel(term, language);
    groups.set(label, [...(groups.get(label) ?? []), term]);
  }
  return [...groups];
}

function optionText(term: DomainTerm): string {
  const kind = term.classification ? kindTitle(term.classification.kind) : "unclassified";
  return `${termLabel(term)} · ${kind}`;
}

/**
 * Associates one occurrence of feature text with a term, and optionally rewords it. Only
 * this occurrence is affected; the preview shows any text change first.
 */
export function ReferenceDialog(props: ReferenceDialogProps) {
  const { body, from, to, existing, replaced, language, onApply, onClosed } = props;
  const selected = body.slice(from, to);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const termRef = useRef<HTMLSelectElement>(null);
  const ids = useId();

  const [readingChoice, setReadingChoice] = useState<ReadingChoice>(existing?.reading.kind === "value" ? "value" : "names");
  const [termId, setTermId] = useState<string>(existing?.termId ?? "");
  const [value, setValue] = useState(existing?.reading.kind === "value" ? existing.reading.value : cleanTermName(selected));
  const [wordingChoice, setWordingChoice] = useState<WordingChoice>("keep");
  const [customWording, setCustomWording] = useState(selected);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    // No close() on cleanup: it would fire "close" and report a dismissal the user never made.
    const dialog = dialogRef.current!;
    if (!dialog.open) dialog.showModal();
    termRef.current!.focus();
  }, []);

  const reading: Reading = readingChoice === "value" ? { kind: "value", value } : { kind: "names" };
  const draft: ReferenceDraft = { termId: termId === "" ? null : (termId as TermId), reading };
  const errors = referenceDraftErrors(draft, language);
  const options = wordingOptions(draft, selected, language);
  const chosen = options.find((o) => o.id === wordingChoice);
  // A choice that stops being offered (say, after changing the term) falls back to keeping the text.
  const effectiveChoice: WordingChoice = wordingChoice === "custom" || chosen ? wordingChoice : "keep";
  const wording = effectiveChoice === "custom" ? customWording : (chosen?.text ?? selected);
  const wordingProblem = effectiveChoice === "custom" ? wordingError(customWording) : undefined;
  const changesText = wording !== selected;
  const preview = replacementPreview(body, from, to, wording);

  const termChoices = readingChoice === "value" ? language.terms.filter((t) => t.classification?.kind === "value_object") : language.terms;
  const term = draft.termId === null ? undefined : language.term(draft.termId);

  const shown = submitted ? errors : {};
  const close = () => dialogRef.current!.close();

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    if (errors.term || errors.value || wordingProblem) return;
    onApply(draft, changesText ? wording : null);
    close();
  };

  return (
    <dialog ref={dialogRef} className="bw-dialog bw-dialog--wide" aria-labelledby={`${ids}-title`} onClose={onClosed}>
      <form className="bw-proposal" onSubmit={submit} noValidate>
        <header className="bw-proposal__header">
          <h2 id={`${ids}-title`} className="bw-proposal__title">
            {existing ? "Edit association" : "Associate with domain concept"}
          </h2>
          <p className="bw-proposal__lede">
            Only this occurrence of <q className="bw-proposal__source">{selected}</q> is associated. Other text spelled
            the same is unaffected.
          </p>
        </header>

        <fieldset className="bw-choice">
          <legend>This text</legend>
          <label className="bw-choice__option">
            <input
              type="radio"
              name={`${ids}-reading`}
              checked={readingChoice === "names"}
              onChange={() => setReadingChoice("names")}
            />
            names a term
          </label>
          <label className="bw-choice__option">
            <input
              type="radio"
              name={`${ids}-reading`}
              checked={readingChoice === "value"}
              onChange={() => setReadingChoice("value")}
            />
            is a value of a Value Object, such as a status
          </label>
        </fieldset>

        <div className="bw-field">
          <label htmlFor={`${ids}-term`}>{readingChoice === "value" ? "Value Object" : "Term"}</label>
          <select
            ref={termRef}
            id={`${ids}-term`}
            className="bw-select"
            value={termId}
            aria-invalid={shown.term ? true : undefined}
            aria-describedby={`${ids}-term-note`}
            onChange={(event) => setTermId(event.target.value)}
          >
            <option value="">Choose…</option>
            {term && !termChoices.includes(term) && <option value={term.id}>{`${optionText(term)} (does not fit)`}</option>}
            {grouped(termChoices, language).map(([label, group]) => (
              <optgroup key={label} label={label}>
                {group.map((t) => (
                  <option key={t.id} value={t.id}>
                    {optionText(t)}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <p id={`${ids}-term-note`} className={shown.term ? "bw-field__error" : "bw-field__note"}>
            {shown.term ??
              (readingChoice === "value" && termChoices.length === 0
                ? "No term is classified as a Value Object yet. Propose the type this value belongs to (for example a status) and classify it as a Value Object."
                : term?.status === "proposed"
                  ? `“${term.name}” is a proposed term. Whether it is accepted is separate from anything this text says.`
                  : "Accepted and proposed terms can both be referenced.")}
          </p>
        </div>

        {readingChoice === "value" && (
          <div className="bw-field">
            <label htmlFor={`${ids}-value`}>Value</label>
            <input
              id={`${ids}-value`}
              type="text"
              autoComplete="off"
              value={value}
              aria-invalid={shown.value ? true : undefined}
              aria-describedby={`${ids}-value-note`}
              onChange={(event) => setValue(event.target.value)}
            />
            <p id={`${ids}-value-note`} className={shown.value ? "bw-field__error" : "bw-field__note"}>
              {shown.value ??
                "Recorded on this occurrence. ArcLint's vocabulary does not list a Value Object's values as terms."}
            </p>
          </div>
        )}

        <fieldset className="bw-choice">
          <legend>Wording</legend>
          {options.map((o) => (
            <label key={o.id} className="bw-choice__option">
              <input
                type="radio"
                name={`${ids}-wording`}
                checked={effectiveChoice === o.id}
                onChange={() => setWordingChoice(o.id)}
              />
              {o.label}: <q className="bw-choice__text">{o.text}</q>
            </label>
          ))}
          {options.some((o) => o.id === "qualified") && (
            <p className="bw-field__note">
              A qualified name puts the names of the terms it sits under first, joined with dots.
            </p>
          )}
          <label className="bw-choice__option">
            <input
              type="radio"
              name={`${ids}-wording`}
              checked={effectiveChoice === "custom"}
              onChange={() => setWordingChoice("custom")}
            />
            Other wording
          </label>
          {effectiveChoice === "custom" && (
            <input
              type="text"
              className="bw-choice__custom"
              aria-label="Wording to use"
              autoComplete="off"
              value={customWording}
              aria-invalid={wordingProblem ? true : undefined}
              onChange={(event) => setCustomWording(event.target.value)}
            />
          )}
          {wordingProblem && <p className="bw-field__error">{wordingProblem}</p>}
        </fieldset>

        <section className="bw-preview" aria-label="Preview">
          <h3 className="bw-preview__title">Preview</h3>
          {changesText ? (
            <>
              <p className="bw-preview__line" data-testid="wording-preview">
                {preview.before}
                <del>{preview.removed}</del>
                <ins>{preview.inserted}</ins>
                {preview.after}
              </p>
              <p className="bw-field__note">Saving changes the text. {props.undoShortcut} in the editor undoes it.</p>
            </>
          ) : (
            <p className="bw-field__note">The text stays as written.</p>
          )}
          {term && !errors.term && !errors.value && (
            <p className="bw-preview__meaning">
              {describeReference(termReferenceOf(body, from, to, term.id, reading), language)}
            </p>
          )}
          {replaced.length > 0 && (
            <p className="bw-field__note">
              Saving replaces the association on {replaced.map((r) => `“${body.slice(r.from, r.to)}”`).join(", ")}.
            </p>
          )}
        </section>

        <div className="bw-proposal__actions">
          {existing && (
            <button
              type="button"
              className="bw-button bw-button--danger bw-proposal__remove"
              onClick={() => {
                onApply(null, null);
                close();
              }}
            >
              Remove association
            </button>
          )}
          <button type="button" className="bw-button" onClick={close}>
            Cancel
          </button>
          <button type="submit" className="bw-button bw-button--primary">
            {changesText ? "Save and replace text" : "Save association"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
