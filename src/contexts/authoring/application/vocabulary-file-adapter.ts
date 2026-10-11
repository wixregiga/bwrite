// One adapter per VocabularyFile format. Each reads its file into BWrite's canonical
// VocabularyDocument and turns the page's change sets into its own edits.

import type { VocabularyFile } from "../domain/vocabulary-file";
import type { ArcLintRule, PlannedStep, VocabularyChange, VocabularyDocument } from "./vocabulary-document";

export interface LoadedFile {
  source: VocabularyFile;
  /** Null when the folder has no such file yet. */
  document: VocabularyDocument | null;
}

export interface VocabularyFileAdapter {
  readonly format: VocabularyFile["format"];
  /** The folder the adapter serves, as a real path. */
  readonly folder: string;
  /** The absolute path of the file whose changes on disk the page is told about. */
  readonly watchedFile: string;
  load(): Promise<LoadedFile>;
  /** The steps `apply` would take for the changes, changing nothing. */
  plan(changes: readonly VocabularyChange[]): Promise<PlannedStep[]>;
  /** Applies the changes in order and answers the file as read back from disk. */
  apply(changes: readonly VocabularyChange[]): Promise<LoadedFile>;
  /** Creates the file when the folder has none; an existing file is left unchanged. */
  create(): Promise<LoadedFile>;
  /** The architecture rules that bind the folder; only arclint's format has any. */
  rules(): Promise<ArcLintRule[]>;
}
