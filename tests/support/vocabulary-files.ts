// The folders BWrite's server was started with, the vocabulary files in them as their own
// toolchains read them, and the browser state a spec starts from. The specs check what BWrite
// shows and writes against these oracles: `arclint domain list` for arclint's file, the YAML
// itself for BWrite's.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { expect, test as base, type Locator, type Page } from "@playwright/test";
import { parse } from "yaml";
import type { DocumentPayload, TermKindPayload, TermPayload } from "../../src/contexts/authoring/contracts/vocabulary-api";
import { recognize, termIdFor } from "./term-recognition";

/** Where the page keeps the author's Workspace, and the version of the stored form it reads. */
export const STORAGE_KEY = "bwrite.workspace";
export const SCHEMA_VERSION = 2;

const TERM_KINDS: readonly TermKindPayload[] = ["bounded_context", "aggregate", "entity", "value_object", "domain_event", "domain_service", "specification"];
const isTermKind = (value: unknown): value is TermKindPayload => (TERM_KINDS as readonly unknown[]).includes(value);

export const ARCLINT_FILE = "domain.arclint.yaml";
export const ARCLINT_RULES_FILE = "rules.arclint.yaml";
export const BWRITE_FILE = "ubiquitous-language.bwrite.yaml";

// Roots

export interface E2eRoots {
  /** The launch root: set up for arclint, holding copies of this repository's domain and rules. */
  readonly arclintProject: string;
  /** A folder in BWrite's own format, holding ubiquitous-language.bwrite.yaml. */
  readonly bwriteProject: string;
  readonly all: readonly string[];
}

const isDirectory = (p: string) => fs.statSync(p, { throwIfNoEntry: false })?.isDirectory() ?? false;

/** The roots the e2e global setup started BWrite's server with, checked before any spec relies on them. */
export function e2eRoots(): E2eRoots {
  const raw = process.env.BWRITE_ROOTS;
  if (raw === undefined || raw.trim().length === 0) {
    throw new Error(
      "BWRITE_ROOTS is not set. The e2e global setup must start BWrite's server and export its roots, " +
        `joined by "${path.delimiter}": the arclint launch root first, then the folder in BWrite's format.`,
    );
  }
  const all = raw
    .split(path.delimiter)
    .map((root) => root.trim())
    .filter((root) => root.length > 0);
  if (all.length < 2) {
    throw new Error(`BWRITE_ROOTS names ${all.length} folder(s) (${JSON.stringify(raw)}); the specs need the arclint root and the BWrite root.`);
  }
  for (const root of all) {
    if (!path.isAbsolute(root)) throw new Error(`BWRITE_ROOTS entry ${JSON.stringify(root)} is not an absolute path.`);
    if (!isDirectory(root)) throw new Error(`BWRITE_ROOTS entry ${root} is not an existing folder.`);
  }
  const [arclintProject, bwriteProject] = all as [string, string];
  for (const file of [ARCLINT_FILE, ARCLINT_RULES_FILE]) {
    if (!fs.existsSync(path.join(arclintProject, file))) {
      throw new Error(`The arclint root ${arclintProject} has no ${file}; the global setup copies this repository's into it.`);
    }
  }
  if (!fs.existsSync(path.join(bwriteProject, BWRITE_FILE))) {
    throw new Error(`The BWrite root ${bwriteProject} has no ${BWRITE_FILE}; the global setup writes one.`);
  }
  return { arclintProject, bwriteProject, all };
}

/** The name the first-run project takes: the launch folder's own name. */
export const launchProjectName = (roots: E2eRoots) => path.basename(roots.arclintProject);

// Scratch folders and backups

export interface ScratchFolder {
  readonly path: string;
  remove(): void;
}

/** A fresh empty folder inside `parent`, which must be one of the roots or inside one. */
export function scratchFolder(parent: string): ScratchFolder {
  const created = fs.mkdtempSync(path.join(parent, "e2e-"));
  return { path: created, remove: () => fs.rmSync(created, { recursive: true, force: true }) };
}

/**
 * A folder set up for arclint, with copies of the launch root's domain and rules, so a spec that
 * writes arclint's file never changes the one other specs read. It is its own git repository and
 * sits in the BWrite root, outside the launch root's repository: arclint reads every file of the
 * repository it runs in, so a copy inside the launch root would let one spec's writes, and the
 * temporary files arclint makes while writing, break another spec's read of the launch root.
 */
export function arclintCopy(roots: E2eRoots): ScratchFolder {
  const folder = scratchFolder(roots.bwriteProject);
  execFileSync("git", ["init", "-q"], { cwd: folder.path, stdio: "ignore" });
  for (const file of [ARCLINT_FILE, ARCLINT_RULES_FILE]) {
    fs.copyFileSync(path.join(roots.arclintProject, file), path.join(folder.path, file));
  }
  return folder;
}

export interface FileBackup {
  /** Puts every file back as it was, removing those that did not exist. */
  restore(): void;
}

/** Keeps the bytes of `files` in `folder`, or that they were absent, until restored. */
export function backUpFiles(folder: string, files: readonly string[]): FileBackup {
  const kept = files.map((file) => {
    const target = path.join(folder, file);
    return { target, bytes: fs.existsSync(target) ? fs.readFileSync(target) : null };
  });
  return {
    restore() {
      for (const { target, bytes } of kept) {
        if (bytes === null) fs.rmSync(target, { force: true });
        else fs.writeFileSync(target, bytes);
      }
    },
  };
}

/** The spec runner's fixtures: the roots, and scratch folders removed after each test. */
export const test = base.extend<{ roots: E2eRoots; arclintFolder: string; emptyFolder: string }>({
  // Playwright reads a fixture's dependencies from its first parameter's destructuring.
  // eslint-disable-next-line no-empty-pattern
  roots: async ({}, use) => {
    await use(e2eRoots());
  },
  arclintFolder: async ({ roots }, use) => {
    const folder = arclintCopy(roots);
    await use(folder.path);
    folder.remove();
  },
  emptyFolder: async ({ roots }, use) => {
    const folder = scratchFolder(roots.bwriteProject);
    await use(folder.path);
    folder.remove();
  },
});

// What a vocabulary file records

export interface RecordedRule {
  key: string;
  statement: string;
}

export interface RecordedAssertion extends RecordedRule {
  on: string;
}

/** One term as its file records it. */
export interface RecordedTerm {
  name: string;
  /** Null for a term BWrite's file keeps without a kind. */
  kind: TermKindPayload | null;
  /** The bounded context it is in: an Entity's is its Aggregate's; null for a bounded context or an unplaced term. */
  context: string | null;
  /** An Entity's Aggregate. */
  aggregate: string | null;
  definition: string;
  aliases: string[];
  invariants: RecordedRule[];
  assertions: RecordedAssertion[];
}

type Json = Record<string, unknown>;

const isRecord = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);

function stringField(entry: Json, field: string, where: string): string {
  const value = entry[field];
  if (typeof value !== "string") throw new Error(`${where}: ${field} is not a string (${JSON.stringify(value)}).`);
  return value;
}

function listField(entry: Json, field: string, where: string): Json[] {
  const value = entry[field];
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || !value.every(isRecord)) throw new Error(`${where}: ${field} is not a list of entries.`);
  return value;
}

function aliasesOf(entry: Json, where: string): string[] {
  const value = entry.aliases;
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || !value.every((a) => typeof a === "string")) throw new Error(`${where}: aliases are malformed.`);
  return value;
}

const rulesOf = (entry: Json, where: string): RecordedRule[] =>
  listField(entry, "invariants", where).map((r) => ({ key: stringField(r, "key", where), statement: stringField(r, "statement", where) }));

const assertionsOf = (entry: Json, where: string): RecordedAssertion[] =>
  listField(entry, "assertions", where).map((r) => ({
    key: stringField(r, "key", where),
    statement: stringField(r, "statement", where),
    on: stringField(r, "on", where),
  }));

/** Runs arclint in `folder` and returns what it printed; a refusal fails with arclint's own words. */
export function arclint(folder: string, args: readonly string[]): string {
  try {
    return execFileSync("arclint", [...args], { cwd: folder, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (error) {
    const failed = error as { stderr?: string; stdout?: string; message: string };
    throw new Error(`arclint ${args.join(" ")} failed in ${folder}: ${failed.stderr || failed.stdout || failed.message}`);
  }
}

/** Every term arclint records in `folder`, as `arclint domain list --format json` reports them. */
export function arclintTerms(folder: string): RecordedTerm[] {
  const listed: unknown = JSON.parse(arclint(folder, ["domain", "list", "--format", "json"]));
  if (!isRecord(listed) || listed.found !== true) throw new Error(`arclint records no domain in ${folder}.`);
  const terms: RecordedTerm[] = [];
  const add = (entry: Json, kind: TermKindPayload, context: string | null, where: string, extra: Partial<RecordedTerm> = {}) =>
    terms.push({
      name: stringField(entry, "name", where),
      kind,
      context,
      aggregate: null,
      definition: stringField(entry, "definition", where),
      aliases: aliasesOf(entry, where),
      invariants: rulesOf(entry, where),
      assertions: assertionsOf(entry, where),
      ...extra,
    });
  for (const context of listField(listed, "contexts", "arclint domain list")) {
    const name = stringField(context, "name", "a bounded context");
    add(context, "bounded_context", null, `bounded context ${name}`, { invariants: [], assertions: [] });
    for (const aggregate of listField(context, "aggregates", name)) {
      const aggregateName = stringField(aggregate, "name", `an aggregate of ${name}`);
      add(aggregate, "aggregate", name, `aggregate ${aggregateName}`);
      for (const entity of listField(aggregate, "entities", aggregateName)) {
        add(entity, "entity", name, `an entity of ${aggregateName}`, { aggregate: aggregateName });
      }
    }
    for (const [field, kind] of [
      ["valueObjects", "value_object"],
      ["events", "domain_event"],
      ["services", "domain_service"],
      ["specifications", "specification"],
    ] as const) {
      for (const entry of listField(context, field, name)) add(entry, kind, name, `${field} of ${name}`);
    }
  }
  return terms;
}

/** The ids of the rules arclint enforces in `folder`, in its order. */
export function arclintRuleIds(folder: string): string[] {
  const rules: unknown = JSON.parse(arclint(folder, ["rules", "--format", "json"]));
  if (!Array.isArray(rules) || !rules.every(isRecord)) throw new Error(`arclint rules in ${folder} is not a list of rules.`);
  return rules.map((rule) => stringField(rule, "id", "an arclint rule"));
}

/** The document BWrite's file in `folder` holds, checked to be one; null when the folder has none. */
export function readBwriteDocument(folder: string): DocumentPayload | null {
  const file = path.join(folder, BWRITE_FILE);
  if (!fs.existsSync(file)) return null;
  const document: unknown = parse(fs.readFileSync(file, "utf8"));
  if (!isRecord(document) || document.version !== 1 || typeof document.project !== "string" || !Array.isArray(document.terms)) {
    throw new Error(`${file} is not a version 1 vocabulary document.`);
  }
  for (const term of document.terms) {
    if (!isRecord(term) || typeof term.name !== "string" || typeof term.definition !== "string") {
      throw new Error(`${file} holds a term without a name and a definition: ${JSON.stringify(term)}.`);
    }
    if (term.kind !== undefined && !isTermKind(term.kind)) throw new Error(`${file} gives ${term.name} the unknown kind ${String(term.kind)}.`);
  }
  return document as unknown as DocumentPayload;
}

/** The accepted terms a BWrite document records, in the same form as arclint's. */
export function acceptedTermsOf(document: DocumentPayload): RecordedTerm[] {
  const accepted = document.terms.filter((t) => t.status !== "proposed");
  return accepted.map((t: TermPayload) => {
    const aggregate = t.kind === "entity" ? (t.aggregate ?? null) : null;
    const owner = aggregate === null ? undefined : document.terms.find((a) => a.kind === "aggregate" && a.name === aggregate);
    return {
      name: t.name,
      kind: t.kind ?? null,
      context: t.kind === "bounded_context" ? null : t.kind === "entity" ? (owner?.context ?? null) : (t.context ?? null),
      aggregate,
      definition: t.definition,
      aliases: t.aliases ?? [],
      invariants: t.invariants ?? [],
      assertions: t.assertions ?? [],
    };
  });
}

/** The TermId BWrite gives a recorded term: from its bounded context and its name. */
export const termIdOfRecorded = (term: RecordedTerm) => termIdFor(term.context ?? undefined, term.name);

/** The kind the editor marks a term with. */
export const markedKind = (term: RecordedTerm) => term.kind ?? "unclassified";

export function recordedTerm(terms: readonly RecordedTerm[], name: string): RecordedTerm {
  const found = terms.find((t) => t.name === name);
  if (!found) throw new Error(`No recorded term is named ${name}; recorded: ${terms.map((t) => t.name).join(", ")}.`);
  return found;
}

/** The recorded term a phrase in a Feature names: by its name or one of its aliases, ignoring case. */
export function termNamedBy(terms: readonly RecordedTerm[], phrase: string): RecordedTerm {
  const key = phrase.trim().replace(/\s+/gu, " ").toLowerCase();
  const found = terms.filter((t) => [t.name, ...t.aliases].some((n) => n.toLowerCase() === key));
  if (found.length !== 1) throw new Error(`“${phrase}” names ${found.length} recorded terms.`);
  return found[0]!;
}

// What the editor recognizes

export interface Recognition {
  text: string;
  termId: string;
  kind: string;
}

/**
 * What the editor should recognize in `text` given the recorded terms: every accepted name and
 * alias, case-insensitively and as whole words, keywords excluded, the longest match winning.
 */
export function expectedRecognitions(text: string, terms: readonly RecordedTerm[]): Recognition[] {
  const byId = new Map<string, RecordedTerm>(terms.map((t) => [termIdOfRecorded(t), t]));
  return recognize(
    text,
    terms.map((t) => ({ id: termIdOfRecorded(t), name: t.name, aliases: t.aliases })),
  ).map((m) => ({ text: text.slice(m.from, m.to), termId: m.termId, kind: markedKind(byId.get(m.termId)!) }));
}

/** Every recognized word in the editor with its TermId and the kind of the badge drawn left of it. */
export async function recognizedInEditor(page: Page): Promise<Recognition[]> {
  return page.locator(".cm-content .bw-term").evaluateAll((highlights) =>
    highlights.map((el) => {
      let previous = el.previousElementSibling;
      while (previous && !previous.classList.contains("bw-term-mark") && previous.classList.contains("cm-widgetBuffer")) {
        previous = previous.previousElementSibling;
      }
      const badge = previous?.classList.contains("bw-term-mark") ? previous.querySelector(".bw-kind-badge") : null;
      return {
        text: el.textContent ?? "",
        termId: el.getAttribute("data-term-id") ?? "",
        kind: badge?.getAttribute("data-kind") ?? "no badge",
      };
    }),
  );
}

// What the panel lists

export interface ListedTerm {
  name: string;
  kind: string;
}

/** The terms of the open tab's list: each name, without its chips, and the kind of its badge. */
export async function listedTerms(panel: Locator): Promise<ListedTerm[]> {
  return panel.locator(".bw-term-list__item").evaluateAll((items) =>
    items.map((item) => {
      const name = item.querySelector(".bw-term-list__name")!;
      return {
        name: [...name.childNodes]
          .filter((n) => n.nodeType === Node.TEXT_NODE)
          .map((n) => n.textContent)
          .join(""),
        kind: name.querySelector(".bw-kind-badge")?.getAttribute("data-kind") ?? "no badge",
      };
    }),
  );
}

const byName = (a: ListedTerm, b: ListedTerm) => a.name.localeCompare(b.name) || a.kind.localeCompare(b.kind);

/** Sorted, so lists compare without depending on the order the server returns terms in. */
export const sortedListing = (terms: readonly ListedTerm[]) => [...terms].sort(byName);

export const listingOf = (terms: readonly RecordedTerm[]) => sortedListing(terms.map((t) => ({ name: t.name, kind: markedKind(t) })));

// Confirming a planned write

export const confirmDialog = (page: Page) => page.getByRole("alertdialog");

/** The arclint commands a planned write shows, as the author would type them. */
export const plannedCommands = (page: Page) => confirmDialog(page).getByTestId("planned-steps").locator("li code");

/** Waits for the planned write titled `title`, checks its steps are listed, and applies it. */
export async function applyPlannedWrite(page: Page, title: string) {
  const dialog = confirmDialog(page);
  await expect(dialog.getByRole("heading", { name: title, exact: true })).toBeVisible();
  await expect(dialog.getByTestId("planned-steps").getByRole("listitem").first()).toBeVisible();
  await dialog.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(dialog).toHaveCount(0);
}

// The browser state a spec starts from

export interface StoredProjectSetup {
  id: string;
  name: string;
  path: string;
  description?: string;
  goals?: string[];
}

export interface StoredFeatureSetup {
  id: string;
  projectId: string;
  title: string;
  body: string;
}

export interface StoredWorkspaceSetup {
  projects: StoredProjectSetup[];
  features: StoredFeatureSetup[];
  /** By project id: proposed terms BWrite keeps itself, in the contract's term form. */
  localProposals?: Record<string, TermPayload[]>;
  activeProjectId: string;
}

/**
 * Opens BWrite on a workspace saved in this browser in the current stored shape. The workspace
 * is stored once, before the first load, so a later reload reads what BWrite itself saved.
 */
export async function openStoredWorkspace(page: Page, setup: StoredWorkspaceSetup) {
  const openFeatureIds: Record<string, string> = {};
  for (const feature of setup.features) openFeatureIds[feature.projectId] ??= feature.id;
  const stored = JSON.stringify({
    schemaVersion: SCHEMA_VERSION,
    savedAt: new Date().toISOString(),
    workspace: {
      projects: setup.projects.map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description ?? "",
        goals: p.goals ?? [],
        path: p.path,
      })),
      features: setup.features.map((f) => ({ ...f, references: [] })),
      localProposals: setup.localProposals ?? {},
      activeProjectId: setup.activeProjectId,
      openFeatureIds,
    },
  });
  await page.addInitScript(
    ({ key, value }) => {
      if (sessionStorage.getItem("bwrite-e2e-stored")) return;
      sessionStorage.setItem("bwrite-e2e-stored", "1");
      localStorage.setItem(key, value);
    },
    { key: STORAGE_KEY, value: stored },
  );
  await page.goto("/");
}

/** Opens BWrite on one project in `folder` with one feature. */
export async function openProjectIn(page: Page, folder: string, feature: { title: string; body: string }, name = path.basename(folder)) {
  await openStoredWorkspace(page, {
    projects: [{ id: "project-e2e", name, path: folder }],
    features: [{ id: "feature-e2e", projectId: "project-e2e", ...feature }],
    activeProjectId: "project-e2e",
  });
}
