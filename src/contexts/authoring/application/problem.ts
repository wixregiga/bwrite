// A refusal of work on a Project's VocabularyFile, naming what kind of problem stopped it. The
// Node process answers it on the wire as a ProjectProblem of the same kind.

export type ProblemKind =
  /** The path does not resolve inside a folder BWrite was started with. */
  | "outside-roots"
  /** The path is not an existing folder. */
  | "not-a-folder"
  /** arclint is not installed where BWrite runs, and the folder needs it. */
  | "arclint-missing"
  /** arclint ran and refused or failed; the message is arclint's own. */
  | "arclint-failed"
  /** BWrite's file exists but is not a valid VocabularyDocument; the message says where. */
  | "file-invalid"
  /** The change needs something the file's format cannot keep, such as a proposed term in arclint's. */
  | "format-cannot-hold"
  /** The request itself is malformed. */
  | "invalid-request"
  /** BWrite's server side failed while doing the work, such as a file it may not write; the message is the system's own. */
  | "server-failed";

export class ProblemError extends Error {
  readonly problem: ProblemKind;

  constructor(problem: ProblemKind, message: string) {
    super(message);
    this.name = "ProblemError";
    this.problem = problem;
  }
}

export function refuse(problem: ProblemKind, message: string): ProblemError {
  return new ProblemError(problem, message);
}
