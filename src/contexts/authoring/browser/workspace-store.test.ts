import { afterAll, describe, expect, it } from "vitest";
import { classificationOf } from "../domain/classification";
import { termIdFor } from "../domain/term-id";
import { termProposalOf } from "../domain/term-proposal";
import { featureIdOf } from "../domain/feature-id";
import { projectIdOf } from "../domain/project-id";
import { projectPathOf, type ProjectPath } from "../domain/project-path";
import { termReferenceOf } from "../domain/term-reference";
import {
  SCHEMA_VERSION,
  STORAGE_KEY,
  loadWorkspace,
  saveWorkspace,
  snapshotOf,
  workspaceProblem,
  type KeyValueStorage,
} from "./workspace-store";
import { SEED_IDS, createSeedWorkspace } from "../application/seed";
import { builtLanguageOf, type Workspace } from "../application/workspace";
import { workspaceReducer } from "../application/workspace-reducer";
import { languageEdit } from "../application/language-document";
import { REPO_ROOT, arclintDocument } from "../../../../tests/support/unit/arclint-listing";
import { unwrap } from "../../../../tests/support/unit/command-results";
import { ARCLINT_FILE, invariant } from "../../../../tests/support/unit/language-builders";
import { removeTemporaryFolders } from "../../../../tests/support/unit/temporary-folders";
import { withVocabulary } from "../../../../tests/support/unit/workspace-builders";

afterAll(removeTemporaryFolders);

class MemoryStorage implements KeyValueStorage {
  readonly items = new Map<string, string>();
  getItem(key: string) {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.items.set(key, value);
  }
}

const throwing: KeyValueStorage = {
  getItem() {
    throw new Error("SecurityError: storage is blocked");
  },
  setItem() {
    throw new Error("QuotaExceededError");
  },
};

const ROOT = projectPathOf(REPO_ROOT);
const NOW = new Date("2026-10-09T10:00:00.000Z");
const AUTHORING = termIdFor(undefined, "authoring");
const AUTHOR = termIdFor("authoring", "Author");
const FEATURE_TERM = termIdFor("authoring", "Feature");
const BILLING = projectIdOf("project-billing");
const BODY = "Notes first\nGiven an accepted Feature\nRule: A Feature never ties one piece of text to two terms";
const RULE_KEY = "references-never-overlap";
const AUTHOR_RULE = invariant("has-a-name", "An Author has a name.");

/** What a loaded workspace is: the stored one, with no VocabularyFile read yet. */
const unread = (ws: Workspace): Workspace => ({ ...ws, vocabularies: {} });

/**
 * The seed after reading this repository's domain, proposing a classified term with a rule
 * (kept by BWrite, since arclint's file holds no proposals), associating text in every
 * reading, and adding a second project: every stored shape.
 */
function editedWorkspace(): Workspace {
  let ws = withVocabulary(createSeedWorkspace(ROOT), SEED_IDS.project, ARCLINT_FILE, arclintDocument());
  const act = (action: Parameters<typeof workspaceReducer>[1]) => (ws = workspaceReducer(ws, action));
  act({ type: "feature/retitled", featureId: SEED_IDS.feature, title: "Edited title" });

  const built = builtLanguageOf(ws, SEED_IDS.project)!;
  const draft = { name: "Author", definition: "A person writing features.", classification: classificationOf("value_object", { context: AUTHORING }) };
  let after = unwrap(built.language.propose(draft, AUTHOR, termProposalOf(SEED_IDS.feature, "author", NOW)));
  after = unwrap(after.placeRule(AUTHOR, AUTHOR_RULE));
  const edit = languageEdit(built, after, (id) => ws.features.find((f) => f.id === id)?.title ?? null);
  expect(edit.changes).toEqual([]);
  act({ type: "vocabulary/local", projectId: SEED_IDS.project, localProposals: edit.localProposals, retargets: edit.retargets });

  const ruleFrom = BODY.indexOf("A Feature never");
  act({
    type: "feature/edited",
    featureId: SEED_IDS.feature,
    body: BODY,
    references: [
      termReferenceOf(BODY, 21, 29, AUTHOR, { kind: "value", value: "Accepted" }),
      termReferenceOf(BODY, 30, 37, FEATURE_TERM, { kind: "names" }),
      termReferenceOf(BODY, ruleFrom, BODY.length, FEATURE_TERM, { kind: "rule", ruleKey: RULE_KEY }),
    ],
  });
  act({ type: "project/created", projectId: BILLING, name: "Billing", path: projectPathOf("/srv/billing") });
  act({ type: "feature/created", projectId: BILLING, featureId: featureIdOf("feature-invoice") });
  act({ type: "project/selected", projectId: SEED_IDS.project });
  return ws;
}

/** The stored form of the edited workspace, as plain JSON data a test can break. */
function stored(): ReturnType<typeof snapshotOf> {
  return JSON.parse(JSON.stringify(snapshotOf(editedWorkspace())));
}

function store(storage: KeyValueStorage, workspace: unknown, schemaVersion: unknown = SCHEMA_VERSION) {
  storage.setItem(STORAGE_KEY, JSON.stringify({ schemaVersion, savedAt: NOW.toISOString(), workspace }));
}

describe("workspace persistence", () => {
  it("seeds a project in the folder BWrite was started in when nothing is stored", () => {
    const result = loadWorkspace(new MemoryStorage(), ROOT);
    expect(result.kind).toBe("seeded");
    expect(result.workspace).toEqual(createSeedWorkspace(ROOT));
    expect(result.workspace.projects[0]!.path).toBe(REPO_ROOT);
    expect(workspaceProblem(snapshotOf(result.workspace))).toBeNull();
  });

  it("seeds with the launch folder spelled as a ProjectPath", () => {
    const result = loadWorkspace(new MemoryStorage(), `${REPO_ROOT}/` as ProjectPath);
    expect(result.workspace.projects[0]!.path).toBe(REPO_ROOT);
  });

  it("round-trips projects, features, every reading, and BWrite's own proposed terms, never the language", () => {
    const storage = new MemoryStorage();
    const ws = editedWorkspace();
    expect(ws.features[0]!.references.map((r) => r.reading.kind)).toEqual(["value", "names", "rule"]);
    expect(ws.localProposals[SEED_IDS.project]).toHaveLength(1);
    expect(saveWorkspace(storage, ws, NOW)).toEqual({ ok: true, savedAt: NOW.toISOString() });
    expect(loadWorkspace(storage, ROOT)).toEqual({ kind: "restored", workspace: unread(ws), savedAt: NOW.toISOString() });
  });

  it("stores projects with their paths and only the proposed terms the file cannot hold", () => {
    const storage = new MemoryStorage();
    saveWorkspace(storage, editedWorkspace(), NOW);
    const saved = JSON.parse(storage.getItem(STORAGE_KEY)!);
    expect(saved.schemaVersion).toBe(2);
    expect(Object.keys(saved.workspace).sort()).toEqual(["activeProjectId", "features", "localProposals", "openFeatureIds", "projects"]);
    expect(saved.workspace.projects.map((p: { path: string }) => p.path)).toEqual([REPO_ROOT, "/srv/billing"]);
    expect(saved.workspace.localProposals).toEqual({
      [SEED_IDS.project]: [
        {
          name: "Author",
          definition: "A person writing features.",
          kind: "value_object",
          context: "authoring",
          status: "proposed",
          invariants: [{ key: "has-a-name", statement: "An Author has a name." }],
          proposal: { feature: "Edited title", featureId: SEED_IDS.feature, text: "author", proposedAt: NOW.toISOString() },
        },
      ],
    });
  });

  it("restores an empty workspace with no active project", () => {
    const storage = new MemoryStorage();
    const empty = workspaceReducer(createSeedWorkspace(ROOT), { type: "project/deleted", projectId: SEED_IDS.project });
    expect(empty.activeProjectId).toBeNull();
    saveWorkspace(storage, empty, NOW);
    expect(loadWorkspace(storage, ROOT)).toEqual({ kind: "restored", workspace: empty, savedAt: NOW.toISOString() });
  });

  it("restores a proposed term's aliases and assertions in their stored form", () => {
    const s = stored();
    const author = s.localProposals[SEED_IDS.project]![0]!;
    Object.assign(author, { kind: "domain_service", invariants: undefined, aliases: ["Writer"], assertions: [{ key: "is-known", statement: "Known.", on: "Write" }] });
    delete author.invariants;
    expect(workspaceProblem(s)).toBeNull();
    const storage = new MemoryStorage();
    store(storage, s);
    const result = loadWorkspace(storage, ROOT);
    expect(result.kind === "restored" && result.workspace.localProposals[SEED_IDS.project]).toEqual([author]);
  });

  it("keeps unreadable data under a backup key and starts from the seed", () => {
    const storage = new MemoryStorage();
    storage.setItem(STORAGE_KEY, "{not json");
    const result = loadWorkspace(storage, ROOT, () => NOW);
    expect(result.kind).toBe("unreadable");
    if (result.kind !== "unreadable") return;
    expect(result.workspace).toEqual(createSeedWorkspace(ROOT));
    expect(result.backupKey).toBe(`${STORAGE_KEY}.unreadable.${NOW.toISOString()}`);
    expect(storage.getItem(result.backupKey!)).toBe("{not json");
  });

  describe("data of another shape", () => {
    it("is refused for its shape even under this schema's version", () => {
      const storage = new MemoryStorage();
      store(storage, { projects: [], features: [], languages: [], activeProjectId: null, openFeatureIds: {} });
      const result = loadWorkspace(storage, ROOT, () => NOW);
      expect(result.kind === "unreadable" && result.reason).toBe("workspace does not have the fields of this version");
    });
  });

  it("does not read data of any other schema version, and keeps it", () => {
    for (const version of [SCHEMA_VERSION + 1, 1, 0, "2", null]) {
      const storage = new MemoryStorage();
      store(storage, stored(), version);
      const raw = storage.getItem(STORAGE_KEY);
      const result = loadWorkspace(storage, ROOT, () => NOW);
      expect(result.kind === "unreadable" && result.reason).toBe(`unsupported schema version ${String(version)}`);
      expect(result.kind === "unreadable" && storage.getItem(result.backupKey!)).toBe(raw);
    }
  });

  it("reports storage failures instead of throwing", () => {
    expect(loadWorkspace(throwing, ROOT)).toMatchObject({ kind: "unreadable", reason: "SecurityError: storage is blocked", backupKey: null });
    expect(saveWorkspace(throwing, createSeedWorkspace(ROOT), NOW)).toEqual({ ok: false, reason: "QuotaExceededError" });
  });
});

type Stored = ReturnType<typeof stored>;

/** The stored workspace with one change applied to a copy. */
function breaking(change: (s: Stored) => void): Stored {
  const s = stored();
  change(s);
  return s;
}
/** The stored proposed term Author, as a plain record a test may break in any way. */
const author = (s: Stored) => s.localProposals[SEED_IDS.project]![0]! as unknown as Record<string, unknown> & { proposal?: Record<string, unknown> };

describe("loading refuses data that breaks a recorded invariant", () => {
  const cases: [string, Stored, string][] = [
    ["has-a-name", breaking((s) => (s.projects[0]!.name = "   ")), `project ${SEED_IDS.project}: Enter a project name.`],
    ["has-a-path, empty", breaking((s) => (s.projects[0]!.path = " ")), `project ${SEED_IDS.project}: Enter the folder that holds the project.`],
    [
      "has-a-path, not spelled as a ProjectPath",
      breaking((s) => (s.projects[0]!.path = `${REPO_ROOT}/`)),
      `project ${SEED_IDS.project}: “${REPO_ROOT}/” is not spelled as a ProjectPath.`,
    ],
    [
      "references-never-overlap",
      breaking((s) => s.features[0]!.references.push({ ...s.features[0]!.references[1]!, from: 32, to: 37 })),
      `feature ${SEED_IDS.feature}: Two references in this feature cover the same text.`,
    ],
    [
      "has-a-statement",
      breaking((s) => ((author(s).invariants as { statement: string }[])[0]!.statement = "  ")),
      "proposed term Author: Enter the rule's statement.",
    ],
    [
      "assertion-names-its-operation",
      breaking((s) => (author(s).assertions = [{ key: "is-known", statement: "Known.", on: " " }])),
      "proposed term Author: Name the operation this assertion is on.",
    ],
  ];

  it.each(cases)("refuses data breaking %s", (_name, workspace, reason) => {
    expect(workspaceProblem(workspace)).toBe(reason);
    const storage = new MemoryStorage();
    store(storage, workspace);
    const result = loadWorkspace(storage, ROOT, () => NOW);
    expect(result.kind === "unreadable" && result.reason).toBe(reason);
    expect(result.kind === "unreadable" && result.workspace).toEqual(createSeedWorkspace(ROOT));
  });
});

describe("loading refuses data in any other shape", () => {
  const cases: [string, Stored | Record<string, unknown>, string][] = [
    ["a workspace that is not an object", [] as unknown as Stored, "workspace is not an object"],
    ["a workspace with its languages stored inline", breaking((s) => Object.assign(s, { languages: [] })), "workspace does not have the fields of this version"],
    ["a workspace without BWrite's own proposed terms", breaking((s) => delete (s as Partial<Stored>).localProposals), "workspace does not have the fields of this version"],
    ["a project without a path", breaking((s) => delete (s.projects[0] as Partial<Stored["projects"][number]>).path), "a project is malformed"],
    ["a project path that is not text", breaking((s) => ((s.projects[0] as unknown as Record<string, unknown>).path = 7)), "a project is malformed"],
    ["an empty project ID", breaking((s) => (s.projects[0]!.id = "")), "a project is malformed"],
    ["proposed terms that are not lists", breaking((s) => ((s.localProposals as Record<string, unknown>)[SEED_IDS.project] = {})), "proposed terms are malformed"],
    ["proposed terms of a missing project", breaking((s) => (s.localProposals["project-gone"] = [])), "proposed terms belong to a missing project"],
    ["a proposed term with a field the contract does not name", breaking((s) => (author(s).id = "term-author")), "a proposed term is malformed"],
    ["a proposed term without its proposal", breaking((s) => delete author(s).proposal), "a proposed term is malformed"],
    ["a proposed term without a name", breaking((s) => (author(s).name = "")), "a proposed term has no name"],
    ["an accepted term kept as a proposal", breaking((s) => (author(s).status = "accepted")), "proposed term Author is malformed"],
    ["a definition that is not text", breaking((s) => (author(s).definition = null)), "proposed term Author is malformed"],
    ["a proposal without its time", breaking((s) => (author(s).proposal!.proposedAt = "yesterday")), "proposed term Author has a malformed proposal"],
    ["a proposal with an empty feature ID", breaking((s) => (author(s).proposal!.featureId = "")), "proposed term Author has a malformed proposal"],
    ["a proposal with more than it says", breaking((s) => (author(s).proposal!.extra = 1)), "proposed term Author has a malformed proposal"],
    ["a kind arclint does not define", breaking((s) => (author(s).kind = "repository")), "proposed term Author has an unknown kind"],
    ["an empty bounded context", breaking((s) => (author(s).context = "")), "proposed term Author has a malformed context"],
    ["aliases that are not text", breaking((s) => (author(s).aliases = [1])), "proposed term Author has malformed aliases"],
    ["invariants that are not a list", breaking((s) => (author(s).invariants = {})), "proposed term Author has malformed invariants"],
    [
      "an invariant that names an operation",
      breaking((s) => ((author(s).invariants as Record<string, unknown>[])[0]!.on = "Write")),
      "proposed term Author has a malformed rule",
    ],
    [
      "a rule key that is not kebab-case",
      breaking((s) => ((author(s).invariants as { key: string }[])[0]!.key = "Has A Name")),
      "proposed term Author: Write the key in lowercase words joined by hyphens, such as order-has-lines.",
    ],
    [
      "a rule not in its stored form",
      breaking((s) => ((author(s).invariants as { statement: string }[])[0]!.statement = " An Author has a name. ")),
      "proposed term Author has a rule has-a-name that is not in its stored form",
    ],
    ["a reference with the subject of an earlier shape", breaking((s) => ((s.features[0]!.references[1] as Record<string, unknown>).subjectId = null)), `feature ${SEED_IDS.feature} has a malformed reference`],
    ["a reference whose reading carries more than it says", breaking((s) => (s.features[0]!.references[1]!.reading = { kind: "names", value: "x" } as never)), `feature ${SEED_IDS.feature} has a malformed reference`],
    ["a reference beyond the text", breaking((s) => (s.features[0]!.references[1]!.to = 9999)), `feature ${SEED_IDS.feature}: A reference covers a word or phrase on one line of the feature.`],
    ["a reference across lines", breaking((s) => Object.assign(s.features[0]!.references[1]!, { from: 5, to: 20 })), `feature ${SEED_IDS.feature}: A reference covers a word or phrase on one line of the feature.`],
    ["an empty value", breaking((s) => (s.features[0]!.references[0]!.reading = { kind: "value", value: " " })), `feature ${SEED_IDS.feature}: Enter the value this text stands for.`],
    ["duplicate feature IDs", breaking((s) => s.features.push(s.features[0]!)), "features have duplicate IDs"],
    ["duplicate project IDs", breaking((s) => s.projects.push(s.projects[0]!)), "projects have duplicate IDs"],
    ["a feature in a missing project", breaking((s) => s.features.push({ ...s.features[0]!, id: "feature-2", projectId: "project-gone", references: [] })), "feature feature-2 belongs to a missing project"],
    ["a missing active project", breaking((s) => (s.activeProjectId = "project-gone")), "active project is missing"],
    ["no active project while projects exist", breaking((s) => (s.activeProjectId = null)), "active project is missing"],
    ["an open feature from another project", breaking((s) => (s.openFeatureIds = { [BILLING]: SEED_IDS.feature })), "an open feature is missing"],
    ["a dangling open feature", breaking((s) => (s.openFeatureIds = { [SEED_IDS.project]: "feature-gone" })), "an open feature is missing"],
  ];

  it.each(cases)("refuses %s", (_name, workspace, reason) => {
    expect(workspaceProblem(workspace)).toBe(reason);
    const storage = new MemoryStorage();
    store(storage, workspace);
    const result = loadWorkspace(storage, ROOT, () => NOW);
    expect(result.kind === "unreadable" && result.reason).toBe(reason);
  });

  it("does not check references against a language it does not store", () => {
    const s = breaking((s) => (s.features[0]!.references[1]!.termId = termIdFor("authoring", "Gone")));
    expect(workspaceProblem(s)).toBeNull();
  });
});
