import type { Project } from "./project";
import type { VocabularyFile } from "./vocabulary-file";

/** One step a save will take, worded for the author: an exact command and its arguments, or a file edit. */
export interface PlannedWrite {
  readonly description: string;
  /** The program's arguments, when the step runs one; absent for an edit BWrite makes itself. */
  readonly command?: readonly string[];
}

/** Why the repository could not do what was asked, worded for the author. */
export interface RepositoryProblem {
  readonly ok: false;
  /** Which kind of problem, as the repository's adapter names it. */
  readonly problem: string;
  readonly message: string;
}

export type RepositoryOutcome<T> = { readonly ok: true; readonly value: T } | RepositoryProblem;

/**
 * Where a Project's UbiquitousLanguage is kept: the VocabularyFile at the Project's
 * ProjectPath, and nowhere else. BWrite loads the language from it and saves every change
 * back to it, whichever format the file is in. Every save is planned first, so the author
 * sees the exact steps that will change a file in their repository before it happens.
 *
 * `Snapshot` is what the file holds and `Change` one edit of it, both in the form the
 * adapter for the file's formats reads and writes; the language is built from a snapshot,
 * and a changed language is stated as changes, by the adapter's pure translation.
 */
export interface UbiquitousLanguageRepository<Snapshot, Change> {
  /** Reads the Project's VocabularyFile. */
  load(project: Project): Promise<RepositoryOutcome<Snapshot>>;
  /** Creates the Project's VocabularyFile in the format its folder uses. */
  create(project: Project, format: VocabularyFile["format"]): Promise<RepositoryOutcome<Snapshot>>;
  /** The steps saving `changes` will take, changing nothing. */
  plan(project: Project, changes: readonly Change[]): Promise<RepositoryOutcome<readonly PlannedWrite[]>>;
  /** Saves `changes` to the VocabularyFile, in order, and answers with the file as read back afterwards. */
  save(project: Project, changes: readonly Change[]): Promise<RepositoryOutcome<Snapshot>>;
  /** Calls `onChange` whenever the Project's VocabularyFile changes on disk; the returned function stops watching. */
  watch(project: Project, onChange: () => void): () => void;
}
