import type { Feature } from "../domain/feature";
import type { FeatureId } from "../domain/feature-id";
import { UbiquitousLanguage } from "../domain/ubiquitous-language";
import type { Project } from "../domain/project";
import type { ProjectId } from "../domain/project-id";
import type { BuiltLanguage } from "./language-document";
import type { VocabularyTerm } from "./vocabulary-document";

/** Where one project's UbiquitousLanguage stands: being read, read and built, or not readable. */
export type VocabularyState =
  | { readonly kind: "loading" }
  | { readonly kind: "loaded"; readonly built: BuiltLanguage }
  /** The file could not be read, or its terms break an invariant of the language; the message says which. */
  | { readonly kind: "problem"; readonly message: string };

/**
 * Everything BWrite holds for its author: the projects with their paths, their features, the
 * proposed terms BWrite keeps itself while a project's VocabularyFile cannot hold them, and
 * which feature is open in each project. Each project's UbiquitousLanguage lives in its
 * VocabularyFile; `vocabularies` holds it as last read, and is never stored in the browser.
 */
export interface Workspace {
  readonly projects: readonly Project[];
  readonly features: readonly Feature[];
  /** By project: proposed terms not yet recorded, while the project's VocabularyFile cannot hold proposals. */
  readonly localProposals: Readonly<Record<string, readonly VocabularyTerm[]>>;
  /** Null only when there are no projects. */
  readonly activeProjectId: ProjectId | null;
  /** The feature open in each project, so returning to a project reopens it. */
  readonly openFeatureIds: Readonly<Record<string, FeatureId>>;
  /** By project: its language as last read from its VocabularyFile. */
  readonly vocabularies: Readonly<Record<string, VocabularyState>>;
}

export function activeProject(ws: Workspace): Project | null {
  return ws.projects.find((p) => p.id === ws.activeProjectId) ?? null;
}

export function featuresOf(features: readonly Feature[], projectId: ProjectId): Feature[] {
  return features.filter((f) => f.projectId === projectId);
}

/** The feature open in a project: its remembered one, otherwise its first, otherwise none. */
export function openFeatureOf(ws: Workspace, projectId: ProjectId): Feature | null {
  const remembered = ws.openFeatureIds[projectId];
  const own = featuresOf(ws.features, projectId);
  return own.find((f) => f.id === remembered) ?? own[0] ?? null;
}

/** The language as last read, when the project's VocabularyFile has been read and built. */
export function builtLanguageOf(ws: Workspace, projectId: ProjectId): BuiltLanguage | null {
  const state = ws.vocabularies[projectId];
  return state?.kind === "loaded" ? state.built : null;
}

const unread = new Map<ProjectId, UbiquitousLanguage>();

/**
 * A project's UbiquitousLanguage. Until its VocabularyFile is read, it is the language with no
 * terms and no file, the same one on every call, which refuses every change that needs the file.
 */
export function languageOf(ws: Workspace, projectId: ProjectId): UbiquitousLanguage {
  const built = builtLanguageOf(ws, projectId);
  if (built) return built.language;
  let empty = unread.get(projectId);
  if (!empty) {
    empty = new UbiquitousLanguage(projectId, null, []);
    unread.set(projectId, empty);
  }
  return empty;
}
