import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { MAX_PROJECT_NAME_LENGTH } from "../domain/project";
import { projectPathOf, type ProjectPath } from "../domain/project-path";
import { RefusalError } from "../domain/refusal";
import { cleanTermName } from "../domain/terms";

interface NewProjectDialogProps {
  initialName: string;
  /** The folder BWrite was started in, which a new project's path starts as. */
  launchRoot: ProjectPath;
  /** The folders BWrite may read, the launch root first. */
  roots: readonly string[];
  onCreate(name: string, path: ProjectPath): void;
  onClosed(): void;
}

/** Asks for a new project's name and the folder that holds its code and its VocabularyFile. */
export function NewProjectDialog(props: NewProjectDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const ids = useId();
  const [name, setName] = useState(props.initialName);
  const [path, setPath] = useState<string>(props.launchRoot);
  const [problems, setProblems] = useState<{ name?: string; path?: string }>({});

  useEffect(() => {
    const dialog = dialogRef.current!;
    if (!dialog.open) dialog.showModal();
    nameRef.current!.select();
  }, []);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const found: { name?: string; path?: string } = {};
    const cleaned = cleanTermName(name);
    if (cleaned.length === 0) found.name = "Enter a project name.";
    else if (cleaned.length > MAX_PROJECT_NAME_LENGTH) found.name = `Keep the project name to ${MAX_PROJECT_NAME_LENGTH} characters or fewer.`;
    let folder: ProjectPath | null = null;
    try {
      folder = projectPathOf(path);
    } catch (error) {
      if (!(error instanceof RefusalError)) throw error;
      found.path = error.message;
    }
    setProblems(found);
    if (found.name || found.path || !folder) return;
    props.onCreate(cleaned, folder);
    dialogRef.current!.close();
  };

  return (
    <dialog ref={dialogRef} className="bw-dialog" aria-labelledby={`${ids}-title`} onClose={props.onClosed}>
      <form className="bw-proposal" onSubmit={submit} noValidate>
        <header className="bw-proposal__header">
          <h2 id={`${ids}-title`} className="bw-proposal__title">
            New project
          </h2>
          <p className="bw-proposal__lede">
            A project is one product, in one folder. BWrite reads and writes its Ubiquitous Language in that folder's
            vocabulary file: domain.arclint.yaml when the folder is set up for arclint, otherwise
            ubiquitous-language.bwrite.yaml.
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
            aria-invalid={problems.name ? true : undefined}
            aria-describedby={problems.name ? `${ids}-name-error` : undefined}
            onChange={(e) => setName(e.target.value)}
          />
          {problems.name && (
            <p id={`${ids}-name-error`} className="bw-field__error">
              {problems.name}
            </p>
          )}
        </div>

        <div className="bw-field">
          <label htmlFor={`${ids}-path`}>Folder</label>
          <input
            id={`${ids}-path`}
            type="text"
            autoComplete="off"
            spellCheck={false}
            list={`${ids}-roots`}
            value={path}
            aria-invalid={problems.path ? true : undefined}
            aria-describedby={`${ids}-path-hint${problems.path ? ` ${ids}-path-error` : ""}`}
            onChange={(e) => setPath(e.target.value)}
          />
          <datalist id={`${ids}-roots`}>
            {props.roots.map((root) => (
              <option key={root} value={root} />
            ))}
          </datalist>
          <p id={`${ids}-path-hint`} className="bw-hint">
            A folder BWrite was started with, or one inside it. BWrite was started in {props.launchRoot}.
          </p>
          {problems.path && (
            <p id={`${ids}-path-error`} className="bw-field__error">
              {problems.path}
            </p>
          )}
        </div>

        <div className="bw-proposal__actions">
          <button type="button" className="bw-button" onClick={() => dialogRef.current!.close()}>
            Cancel
          </button>
          <button type="submit" className="bw-button bw-button--primary">
            Create project
          </button>
        </div>
      </form>
    </dialog>
  );
}
