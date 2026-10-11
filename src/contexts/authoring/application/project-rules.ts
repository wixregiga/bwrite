import type { ProjectPath } from "../domain/project-path";
import type { RepositoryOutcome } from "../domain/ubiquitous-language-repository";
import type { ArcLintRule } from "./vocabulary-document";

/** Reads the architecture rules that bind the Project at `path`; a folder arclint is not set up for has none. */
export type ProjectRulesSource = (path: ProjectPath) => Promise<RepositoryOutcome<readonly ArcLintRule[]>>;
