import type { ProjectId } from "./project-id";
import { RefusalError, failure, success, type Result } from "./refusal";
import { cleanTermName } from "./terms";
import { projectPathOf, type ProjectPath } from "./project-path";

// [ASSUMPTION] Prototype limit, matching the term name limit: a project name is a short label.
export const MAX_PROJECT_NAME_LENGTH = 80;

export const UNTITLED_PROJECT = "Untitled project";

/** "Untitled project", then "Untitled project 2", and so on, skipping names already in use. */
export function nextAvailableName(base: string, existing: readonly string[]): string {
  const taken = new Set(existing.map((n) => n.toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base} ${n}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

export interface ProjectParts {
  id: ProjectId;
  name: string;
  description: string;
  goals: readonly string[];
  path: ProjectPath;
}

/**
 * One software product the team is describing: its name, description, goals, and the
 * ProjectPath where its code and recorded domain live on disk. Its Features and its
 * UbiquitousLanguage refer to it by its ProjectId.
 */
export class Project {
  readonly id: ProjectId;
  readonly name: string;
  readonly description: string;
  readonly goals: readonly string[];
  readonly path: ProjectPath;

  /** Creates a project from its parts; throws a RefusalError when it has no name or no path. */
  constructor(parts: ProjectParts) {
    this.id = parts.id;
    this.name = parts.name;
    this.description = parts.description;
    this.goals = [...parts.goals];
    this.path = parts.path;
    const refusal = this.ensureHasAName() ?? this.ensureHasAPath();
    if (refusal) throw refusal;
  }

  /** Renames the project. Whitespace is collapsed; an empty or overlong name is refused. */
  rename(rawName: string): Result<Project, RefusalError> {
    const name = cleanTermName(rawName);
    const refusal =
      this.ensureHasAName(name) ??
      this.ensureHasAPath() ??
      (name.length > MAX_PROJECT_NAME_LENGTH
        ? new RefusalError(`Keep the project name to ${MAX_PROJECT_NAME_LENGTH} characters or fewer.`, "name")
        : null);
    if (refusal) return failure(refusal);
    return success(new Project({ id: this.id, name, description: this.description, goals: this.goals, path: this.path }));
  }

  /** Invariant has-a-name: a Project always has a name. */
  private ensureHasAName(name: string = this.name): RefusalError | null {
    return cleanTermName(name).length === 0 ? new RefusalError("Enter a project name.", "name") : null;
  }

  /** Invariant has-a-path: a Project always has a ProjectPath, spelled as its door spells it. */
  private ensureHasAPath(path: string = this.path): RefusalError | null {
    if (typeof path !== "string" || path.trim().length === 0) {
      return new RefusalError("Enter the folder that holds the project.", "path");
    }
    return projectPathOf(path) === path ? null : new RefusalError(`“${path}” is not spelled as a ProjectPath.`, "path");
  }
}
