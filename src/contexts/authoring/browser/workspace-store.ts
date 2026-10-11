import { isTermKind } from "../domain/term-kind";
import { Feature } from "../domain/feature";
import { featureIdOf } from "../domain/feature-id";
import { type Reading } from "../domain/term-reference";
import { termIdOf } from "../domain/term-id";
import { placedRuleOf } from "../domain/placed-rule";
import { Project } from "../domain/project";
import { projectIdOf } from "../domain/project-id";
import { projectPathOf, type ProjectPath } from "../domain/project-path";
import { RefusalError } from "../domain/refusal";
import { createSeedWorkspace } from "../application/seed";
import type { Workspace } from "../application/workspace";
import type { LoadResult, SaveResult, WorkspaceStorage } from "../application/workspace-storage";
import type { VocabularyAssertion, VocabularyRule, VocabularyTerm } from "../application/vocabulary-document";
import { isArrayOf, isRecord, isString, isTimestamp } from "./guards";

export const STORAGE_KEY = "bwrite.workspace";
export const SCHEMA_VERSION = 2;

/** The subset of the Web Storage API the store needs, so tests can supply their own. */
export type KeyValueStorage = Pick<Storage, "getItem" | "setItem">;


/** Stored data that cannot become a workspace, with the reason. */
class UnreadableData extends Error {}

function unreadable(reason: string): never {
  throw new UnreadableData(reason);
}

/** Runs a construction door, naming what was being built when it refuses. */
function built<T>(what: string, build: () => T): T {
  try {
    return build();
  } catch (error) {
    if (error instanceof RefusalError) unreadable(`${what}: ${error.message}`);
    throw error;
  }
}

/** True when a stored record has exactly these fields, so data of another shape is never read as this one. */
const hasExactly = (v: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(v).length === keys.length && keys.every((k) => k in v);
/** True when a stored record has every required field and no field outside `optional`. */
const hasFields = (v: Record<string, unknown>, required: readonly string[], optional: readonly string[]) =>
  required.every((k) => k in v) && Object.keys(v).every((k) => required.includes(k) || optional.includes(k));
const isNonEmptyString = (v: unknown): v is string => isString(v) && v.length > 0;

// The stored form, as JSON holds it. A project's UbiquitousLanguage is kept in its
// VocabularyFile, never here; only the proposed terms that file cannot hold are.

interface StoredProject {
  id: string;
  name: string;
  description: string;
  goals: string[];
  path: string;
}

interface StoredFeature {
  id: string;
  projectId: string;
  title: string;
  body: string;
  references: { from: number; to: number; termId: string; reading: Reading }[];
}

interface StoredWorkspace {
  projects: StoredProject[];
  features: StoredFeature[];
  localProposals: Record<string, VocabularyTerm[]>;
  activeProjectId: string | null;
  openFeatureIds: Record<string, string>;
}

export function snapshotOf(ws: Workspace): StoredWorkspace {
  return {
    projects: ws.projects.map((p) => ({ id: p.id, name: p.name, description: p.description, goals: [...p.goals], path: p.path })),
    features: ws.features.map((f) => ({
      id: f.id,
      projectId: f.projectId,
      title: f.title,
      body: f.body,
      references: f.references.map((r) => ({ from: r.from, to: r.to, termId: r.termId, reading: { ...r.reading } })),
    })),
    localProposals: Object.fromEntries(
      Object.entries(ws.localProposals).map(([projectId, terms]) => [projectId, terms.map((t) => structuredClone(t))]),
    ),
    activeProjectId: ws.activeProjectId,
    openFeatureIds: { ...ws.openFeatureIds },
  };
}

// Reading the stored form back, shape first, then through each aggregate's own doors.

function projectFrom(v: unknown): Project {
  if (
    !isRecord(v) ||
    !hasExactly(v, ["id", "name", "description", "goals", "path"]) ||
    !isNonEmptyString(v.id) ||
    !isString(v.name) ||
    !isString(v.description) ||
    !isArrayOf(v.goals, isString) ||
    !isString(v.path)
  ) {
    unreadable("a project is malformed");
  }
  return built(`project ${v.id}`, () =>
    new Project({
      id: projectIdOf(v.id as string),
      name: v.name as string,
      description: v.description as string,
      goals: v.goals as string[],
      path: v.path as ProjectPath,
    }),
  );
}

function readingFrom(v: unknown): Reading | null {
  if (!isRecord(v)) return null;
  if (v.kind === "names" && Object.keys(v).length === 1) return { kind: "names" };
  if (v.kind === "value" && isString(v.value) && Object.keys(v).length === 2) return { kind: "value", value: v.value };
  if (v.kind === "rule" && isString(v.ruleKey) && Object.keys(v).length === 2) return { kind: "rule", ruleKey: v.ruleKey };
  return null;
}

function featureFrom(v: unknown): Feature {
  if (
    !isRecord(v) ||
    !hasExactly(v, ["id", "projectId", "title", "body", "references"]) ||
    !isNonEmptyString(v.id) ||
    !isNonEmptyString(v.projectId) ||
    !isString(v.title) ||
    !isString(v.body) ||
    !Array.isArray(v.references)
  ) {
    unreadable("a feature is malformed");
  }
  const references = v.references.map((r: unknown) => {
    const reading = isRecord(r) ? readingFrom(r.reading) : null;
    if (
      !isRecord(r) ||
      !hasExactly(r, ["from", "to", "termId", "reading"]) ||
      !Number.isInteger(r.from) ||
      !Number.isInteger(r.to) ||
      !isNonEmptyString(r.termId) ||
      !reading
    ) {
      unreadable(`feature ${v.id} has a malformed reference`);
    }
    return { from: r.from as number, to: r.to as number, termId: termIdOf(r.termId), reading };
  });
  return built(`feature ${v.id}`, () =>
    new Feature({
      id: featureIdOf(v.id as string),
      projectId: projectIdOf(v.projectId as string),
      title: v.title as string,
      body: v.body as string,
      references,
    }),
  );
}

function ruleFrom(v: unknown, assertion: boolean, term: string): VocabularyRule | VocabularyAssertion {
  const fields = assertion ? ["key", "statement", "on"] : ["key", "statement"];
  if (!isRecord(v) || !hasExactly(v, fields) || !isString(v.key) || !isString(v.statement) || (assertion && !isString(v.on))) {
    unreadable(`proposed term ${term} has a malformed rule`);
  }
  const rule = built(`proposed term ${term}`, () =>
    placedRuleOf({
      kind: assertion ? "assertion" : "invariant",
      key: v.key as string,
      statement: v.statement as string,
      operation: assertion ? (v.on as string) : "",
    }),
  );
  if (rule.key !== v.key || rule.statement !== v.statement || (assertion && rule.operation !== v.on)) {
    unreadable(`proposed term ${term} has a rule ${String(v.key)} that is not in its stored form`);
  }
  return assertion ? { key: rule.key, statement: rule.statement, on: rule.operation! } : { key: rule.key, statement: rule.statement };
}

const OPTIONAL_TERM_FIELDS = ["aliases", "kind", "context", "aggregate", "identity", "raisedBy", "invariants", "assertions"];

/** One proposed term BWrite keeps itself, in the contract's term form, proposed and with its proposal. */
function localProposalFrom(v: unknown): VocabularyTerm {
  if (!isRecord(v) || !hasFields(v, ["name", "definition", "status", "proposal"], OPTIONAL_TERM_FIELDS)) {
    unreadable("a proposed term is malformed");
  }
  const name = isNonEmptyString(v.name) ? v.name : unreadable("a proposed term has no name");
  if (!isString(v.definition) || v.status !== "proposed") unreadable(`proposed term ${name} is malformed`);
  const p = v.proposal;
  if (
    !isRecord(p) ||
    !hasExactly(p, ["feature", "featureId", "text", "proposedAt"]) ||
    !isString(p.feature) ||
    !isNonEmptyString(p.featureId) ||
    !isString(p.text) ||
    !isTimestamp(p.proposedAt)
  ) {
    unreadable(`proposed term ${name} has a malformed proposal`);
  }
  const term: VocabularyTerm = {
    name,
    definition: v.definition,
    status: "proposed",
    proposal: { feature: p.feature, featureId: p.featureId, text: p.text, proposedAt: p.proposedAt },
  };
  if ("aliases" in v) term.aliases = isArrayOf(v.aliases, isString) ? [...v.aliases] : unreadable(`proposed term ${name} has malformed aliases`);
  if ("kind" in v) term.kind = isTermKind(v.kind) ? v.kind : unreadable(`proposed term ${name} has an unknown kind`);
  for (const field of ["context", "aggregate", "identity", "raisedBy"] as const) {
    if (field in v) term[field] = isNonEmptyString(v[field]) ? v[field] : unreadable(`proposed term ${name} has a malformed ${field}`);
  }
  if ("invariants" in v) {
    if (!Array.isArray(v.invariants)) unreadable(`proposed term ${name} has malformed invariants`);
    term.invariants = v.invariants.map((r) => ruleFrom(r, false, name));
  }
  if ("assertions" in v) {
    if (!Array.isArray(v.assertions)) unreadable(`proposed term ${name} has malformed assertions`);
    term.assertions = v.assertions.map((r) => ruleFrom(r, true, name) as VocabularyAssertion);
  }
  return term;
}

function uniqueIds(items: readonly { id: string }[], what: string): void {
  if (new Set(items.map((i) => i.id)).size !== items.length) unreadable(`${what} have duplicate IDs`);
}

const WORKSPACE_FIELDS = ["projects", "features", "localProposals", "activeProjectId", "openFeatureIds"];

/** Builds the workspace stored in `v`, or throws UnreadableData saying why it cannot. */
function workspaceFrom(v: unknown): Workspace {
  if (!isRecord(v)) unreadable("workspace is not an object");
  if (!hasExactly(v, WORKSPACE_FIELDS)) unreadable("workspace does not have the fields of this version");
  if (!Array.isArray(v.projects)) unreadable("projects are malformed");
  if (!Array.isArray(v.features)) unreadable("features are malformed");
  if (!isRecord(v.localProposals) || !Object.values(v.localProposals).every(Array.isArray)) {
    unreadable("proposed terms are malformed");
  }
  if (!(v.activeProjectId === null || isString(v.activeProjectId))) unreadable("active project is malformed");
  if (!isRecord(v.openFeatureIds) || !Object.values(v.openFeatureIds).every(isString)) unreadable("open features are malformed");

  const projects = v.projects.map(projectFrom);
  const features = v.features.map(featureFrom);
  uniqueIds(projects, "projects");
  uniqueIds(features, "features");

  const projectIds = new Set<string>(projects.map((p) => p.id));
  for (const feature of features) {
    if (!projectIds.has(feature.projectId)) unreadable(`feature ${feature.id} belongs to a missing project`);
  }
  const localProposals: Record<string, VocabularyTerm[]> = {};
  for (const [projectId, terms] of Object.entries(v.localProposals as Record<string, unknown[]>)) {
    if (!projectIds.has(projectId)) unreadable("proposed terms belong to a missing project");
    localProposals[projectId] = terms.map(localProposalFrom);
  }

  const activeProjectId = v.activeProjectId as string | null;
  if (projects.length === 0 ? activeProjectId !== null : !projectIds.has(activeProjectId ?? "")) {
    unreadable("active project is missing");
  }
  const openFeatureIds: Record<string, ReturnType<typeof featureIdOf>> = {};
  for (const [projectId, featureId] of Object.entries(v.openFeatureIds as Record<string, string>)) {
    if (!features.some((f) => f.id === featureId && f.projectId === projectId)) unreadable("an open feature is missing");
    openFeatureIds[projectId] = featureIdOf(featureId);
  }
  return {
    projects,
    features,
    localProposals,
    activeProjectId: activeProjectId === null ? null : projectIdOf(activeProjectId),
    openFeatureIds,
    vocabularies: {},
  };
}

/** Returns a reason the stored workspace is unusable, or null when it is consistent. */
export function workspaceProblem(v: unknown): string | null {
  try {
    workspaceFrom(v);
    return null;
  } catch (error) {
    if (error instanceof UnreadableData) return error.message;
    throw error;
  }
}

/**
 * Loads the stored workspace. A first run, or stored data that cannot be read, starts from the
 * seed workspace, whose project is the folder BWrite was started in.
 */
export function loadWorkspace(storage: KeyValueStorage, launchRoot: ProjectPath, now: () => Date = () => new Date()): LoadResult {
  const seed = () => createSeedWorkspace(projectPathOf(launchRoot));
  let raw: string | null;
  try {
    raw = storage.getItem(STORAGE_KEY);
  } catch (error) {
    return { kind: "unreadable", workspace: seed(), reason: describe(error), backupKey: null };
  }
  if (raw === null) return { kind: "seeded", workspace: seed() };

  let reason: string;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) reason = "stored value is not an object";
    else if (parsed.schemaVersion !== SCHEMA_VERSION) reason = `unsupported schema version ${String(parsed.schemaVersion)}`;
    else if (!isString(parsed.savedAt)) reason = "save time is missing";
    else return { kind: "restored", workspace: workspaceFrom(parsed.workspace), savedAt: parsed.savedAt };
  } catch (error) {
    if (error instanceof UnreadableData || error instanceof SyntaxError) reason = error.message;
    else throw error;
  }

  // Keep the unreadable data rather than letting the next save overwrite it.
  const backupKey = `${STORAGE_KEY}.unreadable.${now().toISOString()}`;
  try {
    storage.setItem(backupKey, raw);
    return { kind: "unreadable", workspace: seed(), reason, backupKey };
  } catch {
    return { kind: "unreadable", workspace: seed(), reason, backupKey: null };
  }
}

export function saveWorkspace(storage: KeyValueStorage, workspace: Workspace, now: Date = new Date()): SaveResult {
  const savedAt = now.toISOString();
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify({ schemaVersion: SCHEMA_VERSION, savedAt, workspace: snapshotOf(workspace) }));
    return { ok: true, savedAt };
  } catch (error) {
    return { ok: false, reason: describe(error) };
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function browserStorage(): KeyValueStorage {
  try {
    return window.localStorage;
  } catch (error) {
    // Accessing localStorage itself throws when storage is blocked.
    const fail = (): never => {
      throw error;
    };
    return { getItem: fail, setItem: fail };
  }
}

/** The Workspace kept in this browser's localStorage. */
export function browserWorkspaceStorage(): WorkspaceStorage {
  const storage = browserStorage();
  return {
    load: (launchRoot) => loadWorkspace(storage, launchRoot),
    save: (workspace) => saveWorkspace(storage, workspace),
  };
}
