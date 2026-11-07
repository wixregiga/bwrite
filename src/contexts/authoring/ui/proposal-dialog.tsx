import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import type { Classification } from "../domain/classification";
import type { ProposalProblems, UbiquitousLanguage } from "../domain/ubiquitous-language";
import { ClassificationFields } from "./classification-fields";

/** What saving a proposal said: nothing when it was saved, otherwise the problems by field. */
export interface ProposalOutcome {
  problems: ProposalProblems;
  /** A refusal about the proposal as a whole, such as a classification that does not fit. */
  refusal: string | null;
}

interface ProposalDialogProps {
  initialName: string;
  sourceText: string;
  featureTitle: string;
  projectName: string;
  /** The Ubiquitous Language the term is proposed to, whose terms it may be related to. */
  language: UbiquitousLanguage;
  onSubmit(name: string, definition: string, classification: Classification | null): ProposalOutcome | null;
  /** Called after the dialog closes, whether submitted or cancelled. */
  onClosed(): void;
}

export function ProposalDialog(props: ProposalDialogProps) {
  const { initialName, sourceText, featureTitle, projectName, language, onSubmit, onClosed } = props;
  const dialogRef = useRef<HTMLDialogElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const definitionRef = useRef<HTMLTextAreaElement>(null);
  const [name, setName] = useState(initialName);
  const [definition, setDefinition] = useState("");
  const [classification, setClassification] = useState<Classification | null>(null);
  const [submitted, setSubmitted] = useState<ProposalOutcome | null>(null);
  const ids = useId();

  // The name is prefilled from the selection, so its problems show immediately. A duplicate is
  // judged where the chosen classification places the term, since names are unique per bounded context.
  const shownNameError = language.proposalProblems({ name, definition, classification }).name;
  const definitionError = submitted?.problems.definition;

  useEffect(() => {
    // No close() on cleanup: it would fire "close" and report a dismissal the user never made.
    // Unmounting removes the dialog element, which ends its modal state without that event.
    const dialog = dialogRef.current!;
    if (!dialog.open) dialog.showModal();
    (shownNameError ? nameRef : definitionRef).current!.focus();
  }, []);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const outcome = onSubmit(name, definition, classification);
    setSubmitted(outcome);
    if (!outcome) {
      dialogRef.current!.close();
      return;
    }
    (outcome.problems.name ? nameRef : definitionRef).current!.focus();
  };

  const nameErrorId = `${ids}-name-error`;
  const definitionErrorId = `${ids}-definition-error`;

  return (
    <dialog ref={dialogRef} className="bw-dialog" aria-labelledby={`${ids}-title`} onClose={onClosed}>
      <form className="bw-proposal" onSubmit={submit} noValidate>
        <header className="bw-proposal__header">
          <h2 id={`${ids}-title`} className="bw-proposal__title">
            Propose domain term
          </h2>
          <p className="bw-proposal__lede">
            Saved as a proposed term in this project's Ubiquitous Language. It is not recognized in features until it is
            accepted. Classifying it now is optional and does not accept it.
          </p>
        </header>

        <div className="bw-field">
          <label htmlFor={`${ids}-name`}>Name</label>
          <input
            ref={nameRef}
            id={`${ids}-name`}
            type="text"
            autoComplete="off"
            value={name}
            aria-invalid={shownNameError ? true : undefined}
            aria-describedby={shownNameError ? nameErrorId : undefined}
            onChange={(e) => setName(e.target.value)}
          />
          {shownNameError && (
            <p id={nameErrorId} className="bw-field__error">
              {shownNameError}
            </p>
          )}
        </div>

        <div className="bw-field">
          <label htmlFor={`${ids}-definition`}>Definition</label>
          <textarea
            ref={definitionRef}
            id={`${ids}-definition`}
            rows={3}
            value={definition}
            aria-invalid={definitionError ? true : undefined}
            aria-describedby={definitionError ? definitionErrorId : undefined}
            onChange={(e) => setDefinition(e.target.value)}
          />
          {definitionError && (
            <p id={definitionErrorId} className="bw-field__error">
              {definitionError}
            </p>
          )}
        </div>

        <ClassificationFields termId={null} value={classification} language={language} onChange={setClassification} />

        {submitted?.refusal && (
          <p className="bw-field__error" role="alert">
            {submitted.refusal}
          </p>
        )}

        <dl className="bw-proposal__meta">
          <div>
            <dt>Ubiquitous Language</dt>
            <dd>{projectName}</dd>
          </div>
          <div>
            <dt>Source feature</dt>
            <dd>{featureTitle.trim() || "Untitled feature"}</dd>
          </div>
          <div>
            <dt>Selected text</dt>
            <dd>
              <q className="bw-proposal__source">{sourceText}</q>
            </dd>
          </div>
        </dl>

        <div className="bw-proposal__actions">
          <button type="button" className="bw-button" onClick={() => dialogRef.current!.close()}>
            Cancel
          </button>
          <button type="submit" className="bw-button bw-button--primary">
            Save proposal
          </button>
        </div>
      </form>
    </dialog>
  );
}
