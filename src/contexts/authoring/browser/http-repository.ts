import type { Project } from "../domain/project";
import type { ProjectPath } from "../domain/project-path";
import type {
  RepositoryOutcome,
  RepositoryProblem,
  UbiquitousLanguageRepository,
} from "../domain/ubiquitous-language-repository";
import type { RecordedVocabulary } from "../application/language-document";
import type { VocabularyFile } from "../domain/vocabulary-file";
import { ROUTES, VOCABULARY_CHANGED, type Answer, type ProjectProblem, type ProjectProblemKind, type Roots } from "../contracts/vocabulary-api";
import { type ArcLintRule, type PlannedStep, type VocabularyChange } from "../application/vocabulary-document";

/** What each problem means for the author, ahead of the server's own detail. */
const PROBLEM_LEADS: Readonly<Record<ProjectProblemKind, string>> = {
  "outside-roots": "BWrite was not started with access to this folder.",
  "not-a-folder": "This path is not a folder.",
  "arclint-missing": "arclint is not installed where BWrite runs, and this folder's vocabulary is kept by arclint.",
  "arclint-failed": "arclint refused the change.",
  "file-invalid": "The vocabulary file cannot be read.",
  "format-cannot-hold": "The vocabulary file's format cannot keep this.",
  "invalid-request": "BWrite sent a request the server could not accept.",
  "server-failed": "BWrite's server could not finish the work.",
};

/** The author-facing message for a problem: what it means, then the server's own words, verbatim. */
export function problemMessage(problem: ProjectProblemKind, detail: string): string {
  const lead = PROBLEM_LEADS[problem];
  const trimmed = detail.trim();
  return trimmed.length === 0 || trimmed === lead ? lead : `${lead} ${trimmed}`;
}

function problemOf(answer: ProjectProblem): RepositoryProblem {
  return { ok: false, problem: answer.problem, message: problemMessage(answer.problem, answer.message) };
}

function unreachable(error: unknown): RepositoryProblem {
  const detail = error instanceof Error ? error.message : String(error);
  return {
    ok: false,
    problem: "server-failed",
    message: `BWrite's server did not answer (${detail}). Start BWrite with its server, then reload.`,
  };
}

function isProblem(value: unknown): value is ProjectProblem {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { ok?: unknown }).ok === false &&
    typeof (value as { problem?: unknown }).problem === "string" &&
    Object.hasOwn(PROBLEM_LEADS, (value as { problem: string }).problem) &&
    typeof (value as { message?: unknown }).message === "string"
  );
}

/** Reads one answer of the contract; a body that is neither an answer nor a problem is reported as such. */
async function answerOf<T>(response: Response): Promise<Answer<T>> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error(`${response.status} ${response.statusText}: the answer is not JSON`);
  }
  if (isProblem(body)) return body;
  if (typeof body === "object" && body !== null && (body as { ok?: unknown }).ok === true) return body as Answer<T>;
  throw new Error(`${response.status} ${response.statusText}: the answer is not one BWrite knows`);
}

async function request<T>(url: string, init?: RequestInit): Promise<RepositoryOutcome<Answer<T> & { ok: true }>> {
  try {
    const answer = await answerOf<T>(await fetch(url, init));
    return answer.ok ? { ok: true, value: answer } : problemOf(answer);
  } catch (error) {
    return unreachable(error);
  }
}

const withPath = (route: string, path: ProjectPath) => `${route}?path=${encodeURIComponent(path)}`;

const post = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

/** The UbiquitousLanguageRepository over BWrite's own server, through the routes of the contract. */
export class HttpUbiquitousLanguageRepository implements UbiquitousLanguageRepository<RecordedVocabulary, VocabularyChange> {
  async load(project: Project): Promise<RepositoryOutcome<RecordedVocabulary>> {
    const answer = await request<{ source: VocabularyFile; document: RecordedVocabulary["document"] }>(
      withPath(ROUTES.vocabulary, project.path),
    );
    return answer.ok ? { ok: true, value: { file: answer.value.source, document: answer.value.document } } : answer;
  }

  async create(project: Project, format: VocabularyFile["format"]): Promise<RepositoryOutcome<RecordedVocabulary>> {
    const answer = await request<{ source: VocabularyFile; document: RecordedVocabulary["document"] }>(
      ROUTES.create,
      post({ path: project.path, format }),
    );
    return answer.ok ? { ok: true, value: { file: answer.value.source, document: answer.value.document } } : answer;
  }

  async plan(project: Project, changes: readonly VocabularyChange[]): Promise<RepositoryOutcome<readonly PlannedStep[]>> {
    const answer = await request<{ steps: PlannedStep[] }>(ROUTES.plan, post({ path: project.path, changes }));
    return answer.ok ? { ok: true, value: answer.value.steps } : answer;
  }

  async save(project: Project, changes: readonly VocabularyChange[]): Promise<RepositoryOutcome<RecordedVocabulary>> {
    const answer = await request<{ source: VocabularyFile; document: RecordedVocabulary["document"] }>(
      ROUTES.apply,
      post({ path: project.path, changes }),
    );
    return answer.ok ? { ok: true, value: { file: answer.value.source, document: answer.value.document } } : answer;
  }

  watch(project: Project, onChange: () => void): () => void {
    const events = new EventSource(withPath(ROUTES.events, project.path));
    events.addEventListener(VOCABULARY_CHANGED, onChange);
    return () => events.close();
  }
}

/** The folders BWrite was started with, the launch root first. */
export async function loadRoots(): Promise<RepositoryOutcome<Roots>> {
  const answer = await request<Roots>(ROUTES.roots);
  return answer.ok ? { ok: true, value: { launchRoot: answer.value.launchRoot, roots: answer.value.roots } } : answer;
}

/** The rules arclint enforces in a Project's folder; empty for a folder arclint is not set up for. */
export async function loadRules(path: ProjectPath): Promise<RepositoryOutcome<readonly ArcLintRule[]>> {
  const answer = await request<{ rules: ArcLintRule[] }>(withPath(ROUTES.rules, path));
  return answer.ok ? { ok: true, value: answer.value.rules } : answer;
}
