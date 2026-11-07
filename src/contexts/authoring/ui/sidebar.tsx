import { useEffect, useId, useRef, useState } from "react";
import type { Feature } from "../domain/feature";
import type { FeatureId } from "../domain/feature-id";
import type { Project } from "../domain/project";
import type { ProjectId } from "../domain/project-id";
import { CloseIcon, PencilIcon, PlusIcon, TrashIcon } from "./icons";

export type ItemKind = "project" | "feature";
export type RenameTarget = { kind: ItemKind; id: string } | null;
export type SidebarFocusRequest = { seq: number; kind: ItemKind } | null;

interface SidebarProps {
  id: string;
  open: boolean;
  /** True when the sidebar covers the workspace rather than sitting beside it. */
  overlay: boolean;
  projects: readonly Project[];
  activeProjectId: ProjectId | null;
  /** Features of the active project. */
  features: readonly Feature[];
  openFeatureId: FeatureId | null;
  /** The row being renamed in place, if any. */
  renaming: RenameTarget;
  onRenamingChange(target: RenameTarget): void;
  /** Moves focus to the current row of a kind, or to its "New" button when there is none. */
  focusRequest: SidebarFocusRequest;
  onCreateProject(): void;
  onSelectProject(id: ProjectId): void;
  /** Returns an error message when the name is not acceptable. */
  onRenameProject(id: ProjectId, name: string): string | undefined;
  onDeleteProject(id: ProjectId, trigger: HTMLElement): void;
  onCreateFeature(): void;
  onSelectFeature(id: FeatureId): void;
  onRenameFeature(id: FeatureId, title: string): void;
  onDeleteFeature(id: FeatureId, trigger: HTMLElement): void;
  onClose(): void;
}

export const UNTITLED_FEATURE = "Untitled feature";

export function Sidebar(props: SidebarProps) {
  const { open, projects, features, activeProjectId, openFeatureId } = props;
  const rootRef = useRef<HTMLElement>(null);
  const { renaming, onRenamingChange: setRenaming } = props;
  const [focusRow, setFocusRow] = useState<string | null>(null);
  const ids = useId();

  useEffect(() => {
    const request = props.focusRequest;
    const root = rootRef.current;
    // A rename field that just mounted keeps its focus.
    if (!open || !request || !root || root.contains(document.activeElement)) return;
    const target =
      root.querySelector<HTMLElement>(`[data-kind="${request.kind}"] [aria-current="true"]`) ??
      root.querySelector<HTMLElement>(`[data-new="${request.kind}"]`);
    target?.focus();
    // Focus follows explicit requests only, never ordinary re-renders.
  }, [props.focusRequest]);

  useEffect(() => {
    if (!focusRow) return;
    rootRef.current?.querySelector<HTMLElement>(`[data-row="${focusRow}"] .bw-nav-row__main`)?.focus();
    setFocusRow(null);
  }, [focusRow]);

  if (!open) return null;

  const activeProject = projects.find((p) => p.id === activeProjectId) ?? null;

  const endRename = (key: string, viaKeyboard: boolean) => {
    setRenaming(null);
    if (viaKeyboard) setFocusRow(key);
  };

  return (
    <nav
      ref={rootRef}
      id={props.id}
      className={`bw-sidebar${props.overlay ? " is-overlay" : ""}`}
      aria-label="Projects and features"
      onKeyDown={(event) => {
        if (props.overlay && event.key === "Escape" && !event.defaultPrevented) {
          event.preventDefault();
          props.onClose();
        }
      }}
    >
      <section className="bw-sidebar__section" aria-labelledby={`${ids}-projects`}>
        <div className="bw-sidebar__head">
          <h2 id={`${ids}-projects`} className="bw-sidebar__heading">
            Projects
          </h2>
          <button
            type="button"
            className="bw-icon-button"
            data-new="project"
            aria-label="New project"
            title="New project"
            onClick={props.onCreateProject}
          >
            <PlusIcon />
          </button>
          <button
            type="button"
            className="bw-icon-button bw-sidebar__close"
            aria-label="Close projects and features"
            title="Close"
            onClick={props.onClose}
          >
            <CloseIcon />
          </button>
        </div>
        {projects.length === 0 ? (
          <p className="bw-sidebar__empty">No projects yet. Create one to start writing features.</p>
        ) : (
          <ul className="bw-nav-list" data-kind="project">
            {projects.map((project) => (
              <NavRow
                key={project.id}
                kind="project"
                rowKey={project.id}
                label={project.name}
                untitled={false}
                current={project.id === activeProjectId}
                renaming={renaming?.kind === "project" && renaming.id === project.id}
                onSelect={() => props.onSelectProject(project.id)}
                onStartRename={() => setRenaming({ kind: "project", id: project.id })}
                onRename={(name) => props.onRenameProject(project.id, name)}
                onEndRename={(viaKeyboard) => endRename(project.id, viaKeyboard)}
                onDelete={(trigger) => props.onDeleteProject(project.id, trigger)}
              />
            ))}
          </ul>
        )}
      </section>

      {activeProject && (
        <section className="bw-sidebar__section" aria-labelledby={`${ids}-features`}>
          <div className="bw-sidebar__head">
            <h2 id={`${ids}-features`} className="bw-sidebar__heading">
              Features
            </h2>
            <button
              type="button"
              className="bw-icon-button"
              data-new="feature"
              aria-label="New feature"
              title="New feature"
              onClick={props.onCreateFeature}
            >
              <PlusIcon />
            </button>
          </div>
          {features.length === 0 ? (
            <p className="bw-sidebar__empty">No features in {activeProject.name} yet.</p>
          ) : (
            <ul className="bw-nav-list" data-kind="feature">
              {features.map((feature) => (
                <NavRow
                  key={feature.id}
                  kind="feature"
                  rowKey={feature.id}
                  label={feature.title.trim() || UNTITLED_FEATURE}
                  untitled={!feature.title.trim()}
                  current={feature.id === openFeatureId}
                  renaming={renaming?.kind === "feature" && renaming.id === feature.id}
                  onSelect={() => props.onSelectFeature(feature.id)}
                  onStartRename={() => setRenaming({ kind: "feature", id: feature.id })}
                  onRename={(title) => {
                    props.onRenameFeature(feature.id, title);
                    return undefined;
                  }}
                  onEndRename={(viaKeyboard) => endRename(feature.id, viaKeyboard)}
                  onDelete={(trigger) => props.onDeleteFeature(feature.id, trigger)}
                />
              ))}
            </ul>
          )}
        </section>
      )}
    </nav>
  );
}

interface NavRowProps {
  kind: ItemKind;
  rowKey: string;
  label: string;
  untitled: boolean;
  current: boolean;
  renaming: boolean;
  onSelect(): void;
  onStartRename(): void;
  onRename(value: string): string | undefined;
  onEndRename(viaKeyboard: boolean): void;
  onDelete(trigger: HTMLElement): void;
}

function NavRow(props: NavRowProps) {
  const { kind, label } = props;
  return (
    <li className={`bw-nav-row${props.current ? " is-current" : ""}`} data-row={props.rowKey}>
      {props.renaming ? (
        <RenameInput
          label={`Rename ${kind}`}
          initial={props.untitled ? "" : label}
          placeholder={props.untitled ? UNTITLED_FEATURE : undefined}
          onCommit={props.onRename}
          onEnd={props.onEndRename}
        />
      ) : (
        <>
          <button
            type="button"
            className={`bw-nav-row__main${props.untitled ? " is-untitled" : ""}`}
            aria-current={props.current ? "true" : undefined}
            title={label}
            onClick={props.onSelect}
            onDoubleClick={props.onStartRename}
          >
            {label}
          </button>
          <span className="bw-nav-row__actions">
            <button
              type="button"
              className="bw-icon-button bw-icon-button--small"
              aria-label={`Rename ${kind} ${label}`}
              title="Rename"
              onClick={props.onStartRename}
            >
              <PencilIcon />
            </button>
            <button
              type="button"
              className="bw-icon-button bw-icon-button--small bw-icon-button--danger"
              aria-label={`Delete ${kind} ${label}`}
              title="Delete"
              onClick={(event) => props.onDelete(event.currentTarget)}
            >
              <TrashIcon />
            </button>
          </span>
        </>
      )}
    </li>
  );
}

interface RenameInputProps {
  label: string;
  initial: string;
  placeholder?: string;
  onCommit(value: string): string | undefined;
  onEnd(viaKeyboard: boolean): void;
}

/** Inline rename: Enter saves, Escape cancels, and leaving the field saves when the value is acceptable. */
function RenameInput({ label, initial, placeholder, onCommit, onEnd }: RenameInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const finished = useRef(false);
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<string>();
  const errorId = useId();

  useEffect(() => {
    inputRef.current!.focus();
    inputRef.current!.select();
  }, []);

  const finish = (viaKeyboard: boolean) => {
    finished.current = true;
    onEnd(viaKeyboard);
  };

  return (
    <div className="bw-rename">
      <input
        ref={inputRef}
        className="bw-rename__input"
        aria-label={label}
        placeholder={placeholder}
        value={value}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        onChange={(event) => {
          setValue(event.target.value);
          setError(undefined);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            const problem = onCommit(value);
            if (problem) setError(problem);
            else finish(true);
          } else if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            finish(true);
          }
        }}
        onBlur={() => {
          if (finished.current) return;
          // An unacceptable name is discarded rather than trapping focus in the field.
          onCommit(value);
          finish(false);
        }}
      />
      {error && (
        <p id={errorId} className="bw-field__error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
