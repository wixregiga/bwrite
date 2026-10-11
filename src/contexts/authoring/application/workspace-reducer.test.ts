import { afterAll, describe, expect, it } from "vitest";
import { classificationOf } from "../domain/classification";
import { featureIdOf, type FeatureId } from "../domain/feature-id";
import { termReferenceOf } from "../domain/term-reference";
import { termIdFor } from "../domain/term-id";
import { termProposalOf } from "../domain/term-proposal";
import { projectIdOf, type ProjectId } from "../domain/project-id";
import { projectPathOf } from "../domain/project-path";
import type { VocabularyFile } from "../domain/vocabulary-file";
import { SEED_IDS, createSeedWorkspace, folderName } from "./seed";
import {
  activeProject,
  builtLanguageOf,
  featuresOf,
  languageOf,
  openFeatureOf,
  type Workspace,
} from "./workspace";
import { workspaceReducer, type WorkspaceAction } from "./workspace-reducer";
import type { VocabularyDocument, VocabularyTerm } from "./vocabulary-document";
import { languageEdit } from "./language-document";
import { snapshotOf, workspaceProblem } from "../browser/workspace-store";
import { REPO_ROOT, arclintDocument, runArclint } from "../../../../tests/support/unit/arclint-listing";
import { unwrap } from "../../../../tests/support/unit/command-results";
import { ARCLINT_FILE, BWRITE_FILE } from "../../../../tests/support/unit/language-builders";
import { removeTemporaryFolders, temporaryFolder } from "../../../../tests/support/unit/temporary-folders";

afterAll(removeTemporaryFolders);

/**
 * Applies actions in order and checks after each one that the workspace is still storable: the
 * browser store's snapshot, after a round trip through JSON, passes the store's own load check.
 */
function run(ws: Workspace, ...actions: WorkspaceAction[]): Workspace {
  for (const action of actions) {
    ws = workspaceReducer(ws, action);
    expect(workspaceProblem(JSON.parse(JSON.stringify(snapshotOf(ws)))), `after ${action.type}`).toBeNull();
  }
  return ws;
}

const ROOT = projectPathOf(REPO_ROOT);
const REAL = arclintDocument();
const BILLING = projectIdOf("project-billing");
const BILLING_PATH = projectPathOf("/srv/billing");
const INVOICE_FEATURE = featureIdOf("feature-invoice");
const REFUND_FEATURE = featureIdOf("feature-refund");
const INVOICE = termIdFor(undefined, "Invoice");
const DOMAIN_TERM = termIdFor("authoring", "DomainTerm");
const FEATURE_TERM = termIdFor("authoring", "Feature");
const BILLING_DOCUMENT: VocabularyDocument = {
  version: 1,
  project: "billing",
  terms: [{ name: "billing", kind: "bounded_context", definition: "Getting paid." }],
};

const loaded = (
  projectId: ProjectId,
  file: VocabularyFile,
  document: VocabularyDocument | null,
  more: { localProposals?: readonly VocabularyTerm[]; retargets?: readonly (readonly [ReturnType<typeof termIdFor>, ReturnType<typeof termIdFor>])[] } = {},
): WorkspaceAction => ({ type: "vocabulary/loaded", projectId, recorded: { file, document }, ...more });

/** The first-run workspace with this repository's domain read from its arclint file. */
const seeded = () => run(createSeedWorkspace(ROOT), loaded(SEED_IDS.project, ARCLINT_FILE, REAL));

const titleIn = (ws: Workspace) => (featureId: FeatureId) => ws.features.find((f) => f.id === featureId)?.title ?? null;

/** Proposes a term in a project's language and keeps it the way the app does when nothing in the file changes. */
function propose(ws: Workspace, projectId: ProjectId, name: string, definition: string, featureId: FeatureId): Workspace {
  const built = builtLanguageOf(ws, projectId)!;
  const termId = termIdFor(undefined, name);
  const after = unwrap(
    built.language.propose({ name, definition, classification: null }, termId, termProposalOf(featureId, name.toLowerCase(), new Date("2026-10-09T10:00:00.000Z"))),
  );
  const edit = languageEdit(built, after, titleIn(ws));
  expect(edit.changes).toEqual([]);
  return run(ws, { type: "vocabulary/local", projectId, localProposals: edit.localProposals, retargets: edit.retargets });
}

function withBilling(): Workspace {
  const ws = run(
    seeded(),
    { type: "project/created", projectId: BILLING, name: "Billing", path: BILLING_PATH },
    { type: "feature/created", projectId: BILLING, featureId: INVOICE_FEATURE },
    { type: "feature/retitled", featureId: INVOICE_FEATURE, title: "Issue invoice" },
    { type: "feature/edited", featureId: INVOICE_FEATURE, body: "Feature: Issue invoice", references: [] },
    { type: "feature/created", projectId: BILLING, featureId: REFUND_FEATURE },
    loaded(BILLING, ARCLINT_FILE, BILLING_DOCUMENT),
  );
  return propose(ws, BILLING, "Invoice", "A request for payment.", INVOICE_FEATURE);
}

describe("projects", () => {
  it("creates a project in its folder, active, with a language not read yet", () => {
    const ws = run(createSeedWorkspace(ROOT), { type: "project/created", projectId: BILLING, name: "Billing", path: BILLING_PATH });
    expect(activeProject(ws)).toMatchObject({ name: "Billing", path: BILLING_PATH });
    expect(ws.vocabularies[BILLING]).toBeUndefined();
    expect(languageOf(ws, BILLING).terms).toEqual([]);
    expect(languageOf(ws, BILLING).file).toBeNull();
    expect(languageOf(ws, BILLING)).toBe(languageOf(ws, BILLING));
    expect(featuresOf(ws.features, BILLING)).toEqual([]);
    expect(openFeatureOf(ws, BILLING)).toBeNull();
  });

  it("names the seed project after the folder BWrite was started in", () => {
    expect(createSeedWorkspace(ROOT).projects[0]).toMatchObject({ name: folderName(ROOT), path: ROOT });
    expect(folderName(ROOT)).toBe(REPO_ROOT.split("/").at(-1));
    expect(folderName(projectPathOf("/"))).toBe("/");
  });

  it("renames through the project, without changing the ID or path, and ignores a refused name", () => {
    let ws = run(withBilling(), { type: "project/renamed", projectId: BILLING, name: "  Payments " });
    expect(ws.projects.map((p) => [p.id, p.name, p.path])).toEqual([
      [SEED_IDS.project, folderName(ROOT), ROOT],
      [BILLING, "Payments", BILLING_PATH],
    ]);
    const before = ws;
    ws = workspaceReducer(ws, { type: "project/renamed", projectId: BILLING, name: "   " });
    expect(ws).toBe(before);
  });

  it("keeps features, languages, and BWrite's own proposed terms with their own project", () => {
    const ws = withBilling();
    expect(featuresOf(ws.features, SEED_IDS.project).map((f) => f.id)).toEqual([SEED_IDS.feature]);
    expect(featuresOf(ws.features, BILLING).map((f) => f.id)).toEqual([INVOICE_FEATURE, REFUND_FEATURE]);
    expect(languageOf(ws, SEED_IDS.project).acceptedTerms()).toHaveLength(REAL.terms.length);
    expect(languageOf(ws, SEED_IDS.project).proposedTerms()).toEqual([]);
    expect(languageOf(ws, BILLING).proposedTerms().map((t) => t.id)).toEqual([INVOICE]);
    expect(ws.localProposals).toEqual({
      [BILLING]: [
        {
          name: "Invoice",
          definition: "A request for payment.",
          status: "proposed",
          proposal: { feature: "Issue invoice", featureId: INVOICE_FEATURE, text: "invoice", proposedAt: "2026-10-09T10:00:00.000Z" },
        },
      ],
    });
  });

  it("remembers the open feature of each project when switching", () => {
    let ws = run(withBilling(), { type: "feature/selected", featureId: INVOICE_FEATURE });
    ws = run(ws, { type: "project/selected", projectId: SEED_IDS.project });
    expect(openFeatureOf(ws, SEED_IDS.project)?.id).toBe(SEED_IDS.feature);
    ws = run(ws, { type: "project/selected", projectId: BILLING });
    expect(openFeatureOf(ws, BILLING)?.id).toBe(INVOICE_FEATURE);
  });

  it("deletes a project with everything it owns and nothing else", () => {
    const before = withBilling();
    const ws = run(before, { type: "project/deleted", projectId: BILLING });
    expect(ws.projects.map((p) => p.id)).toEqual([SEED_IDS.project]);
    expect(ws.features.map((f) => f.id)).toEqual([SEED_IDS.feature]);
    expect(ws.localProposals).toEqual({});
    expect(ws.vocabularies).toEqual({ [SEED_IDS.project]: before.vocabularies[SEED_IDS.project] });
    expect(languageOf(ws, SEED_IDS.project)).toBe(languageOf(before, SEED_IDS.project));
    expect(ws.activeProjectId).toBe(SEED_IDS.project);
    expect(ws.openFeatureIds).toEqual({ [SEED_IDS.project]: SEED_IDS.feature });
  });

  it("activates the neighboring project when the active one is deleted", () => {
    let ws = run(withBilling(), { type: "project/selected", projectId: SEED_IDS.project });
    ws = run(ws, { type: "project/deleted", projectId: SEED_IDS.project });
    expect(ws.activeProjectId).toBe(BILLING);
  });

  it("leaves no active project once the last one is deleted", () => {
    const ws = run(seeded(), { type: "project/deleted", projectId: SEED_IDS.project });
    expect(ws).toEqual({ projects: [], features: [], localProposals: {}, activeProjectId: null, openFeatureIds: {}, vocabularies: {} });
  });

  it("ignores selecting a project that does not exist", () => {
    const ws = createSeedWorkspace(ROOT);
    expect(workspaceReducer(ws, { type: "project/selected", projectId: projectIdOf("project-gone") })).toBe(ws);
  });
});

describe("features", () => {
  it("opens a new feature and keeps its ID through retitling and editing", () => {
    let ws = run(withBilling(), { type: "feature/retitled", featureId: REFUND_FEATURE, title: "Refund payment" });
    expect(ws.features.find((f) => f.id === REFUND_FEATURE)?.title).toBe("Refund payment");
    expect(openFeatureOf(ws, BILLING)?.id).toBe(REFUND_FEATURE);
    ws = run(ws, { type: "feature/edited", featureId: REFUND_FEATURE, body: "Feature: Refund", references: [] });
    expect(ws.features.map((f) => f.id)).toEqual([SEED_IDS.feature, INVOICE_FEATURE, REFUND_FEATURE]);
  });

  it("selecting a feature in another project switches to that project", () => {
    const ws = run(withBilling(), { type: "feature/selected", featureId: SEED_IDS.feature });
    expect(ws.activeProjectId).toBe(SEED_IDS.project);
  });

  it("opens the next feature, or the previous one at the end, when the open feature is deleted", () => {
    const dispute = featureIdOf("feature-dispute");
    let ws = run(
      withBilling(),
      { type: "feature/created", projectId: BILLING, featureId: dispute },
      { type: "feature/selected", featureId: REFUND_FEATURE },
      { type: "feature/deleted", featureId: REFUND_FEATURE },
    );
    expect(openFeatureOf(ws, BILLING)?.id).toBe(dispute);
    ws = run(ws, { type: "feature/deleted", featureId: dispute });
    expect(openFeatureOf(ws, BILLING)?.id).toBe(INVOICE_FEATURE);
    ws = run(ws, { type: "feature/deleted", featureId: INVOICE_FEATURE });
    expect(openFeatureOf(ws, BILLING)).toBeNull();
    expect(ws.openFeatureIds).toEqual({ [SEED_IDS.project]: SEED_IDS.feature });
  });

  it("keeps proposed terms made from a deleted feature, with their proposal", () => {
    const ws = run(withBilling(), { type: "feature/deleted", featureId: INVOICE_FEATURE });
    expect(languageOf(ws, BILLING).term(INVOICE)?.proposal?.featureId).toBe(INVOICE_FEATURE);
    expect(ws.localProposals[BILLING]?.[0]?.proposal).toMatchObject({ feature: "Issue invoice", featureId: INVOICE_FEATURE });
  });

  it("does not create a feature for a missing project", () => {
    const ws = createSeedWorkspace(ROOT);
    expect(workspaceReducer(ws, { type: "feature/created", projectId: projectIdOf("project-gone"), featureId: featureIdOf("f") })).toBe(ws);
  });

  it("stores text and its references together", () => {
    const body = "Given a Feature contains an accepted Domain Term";
    const references = [termReferenceOf(body, 28, 36, DOMAIN_TERM, { kind: "value", value: "Accepted" })];
    const ws = run(seeded(), { type: "feature/edited", featureId: SEED_IDS.feature, body, references });
    expect(ws.features[0]).toMatchObject({ body, references });
  });

  it("drops a rule reading whose rule the language no longer holds, keeping the text and every other reference", () => {
    const body = "Rule: A Feature never ties one piece of text to two terms";
    const from = body.indexOf("A Feature");
    const held = termReferenceOf(body, from, body.length, FEATURE_TERM, { kind: "rule", ruleKey: "references-never-overlap" });
    const gone = termReferenceOf(body, from, body.length, FEATURE_TERM, { kind: "rule", ruleKey: "no-such-rule" });
    const names = termReferenceOf(body, 0, 4, FEATURE_TERM, { kind: "names" });
    expect(run(seeded(), { type: "feature/edited", featureId: SEED_IDS.feature, body, references: [names, held] }).features[0]!.references).toEqual([
      names,
      held,
    ]);
    const ws = run(seeded(), { type: "feature/edited", featureId: SEED_IDS.feature, body, references: [names, gone] });
    expect(ws.features[0]).toMatchObject({ body, references: [names] });
  });

  it("keeps a reference whose term left the language, so it shows that its term is gone", () => {
    const body = "Given a Glossary";
    const orphan = termReferenceOf(body, 8, 16, termIdFor("authoring", "Glossary"), { kind: "names" });
    const ws = run(seeded(), { type: "feature/edited", featureId: SEED_IDS.feature, body, references: [orphan] });
    expect(ws.features[0]!.references).toEqual([orphan]);
    expect(languageOf(ws, SEED_IDS.project).term(orphan.termId)).toBeUndefined();
  });
});

describe("reading a project's VocabularyFile", () => {
  it("shows the file as being read only until a language is built, and keeps a built one shown while it is read again", () => {
    const seed = createSeedWorkspace(ROOT);
    const loading = run(seed, { type: "vocabulary/loading", projectId: SEED_IDS.project });
    expect(loading.vocabularies[SEED_IDS.project]).toEqual({ kind: "loading" });
    const ws = seeded();
    expect(workspaceReducer(ws, { type: "vocabulary/loading", projectId: SEED_IDS.project })).toBe(ws);
    expect(workspaceReducer(seed, { type: "vocabulary/loading", projectId: projectIdOf("project-gone") })).toBe(seed);
  });

  it("builds the language from the file as read", () => {
    const ws = seeded();
    const built = builtLanguageOf(ws, SEED_IDS.project)!;
    expect(built.source).toEqual({ file: ARCLINT_FILE, document: REAL, localProposals: [] });
    expect(languageOf(ws, SEED_IDS.project)).toBe(built.language);
    expect(built.language.file).toEqual(ARCLINT_FILE);
    expect(built.language.term(DOMAIN_TERM)?.name).toBe("DomainTerm");
  });

  it("reports a problem the server answered with, and replaces it once the file is read", () => {
    const failed = run(createSeedWorkspace(ROOT), {
      type: "vocabulary/failed",
      projectId: SEED_IDS.project,
      message: "arclint is not installed where BWrite runs.",
    });
    expect(failed.vocabularies[SEED_IDS.project]).toEqual({ kind: "problem", message: "arclint is not installed where BWrite runs." });
    expect(languageOf(failed, SEED_IDS.project).file).toBeNull();
    expect(run(failed, loaded(SEED_IDS.project, ARCLINT_FILE, REAL)).vocabularies[SEED_IDS.project]?.kind).toBe("loaded");
  });

  it("reports a file whose terms break an invariant as unbuildable, leaving the language unread", () => {
    const broken = { ...REAL, terms: [...REAL.terms, { name: " feature ", kind: "value_object" as const, context: "authoring", definition: "Again." }] };
    const ws = run(createSeedWorkspace(ROOT), loaded(SEED_IDS.project, ARCLINT_FILE, broken));
    expect(ws.vocabularies[SEED_IDS.project]).toEqual({
      kind: "problem",
      message: "domain.arclint.yaml cannot be used: “Feature” and “ feature ” differ only in letter case or spacing.",
    });
    expect(builtLanguageOf(ws, SEED_IDS.project)).toBeNull();
    expect(languageOf(ws, SEED_IDS.project).terms).toEqual([]);
  });

  it("ignores a file read for a project that is gone", () => {
    const ws = createSeedWorkspace(ROOT);
    expect(workspaceReducer(ws, loaded(projectIdOf("project-gone"), ARCLINT_FILE, REAL))).toBe(ws);
    expect(
      workspaceReducer(ws, { type: "vocabulary/failed", projectId: projectIdOf("project-gone"), message: "x" }),
    ).toBe(ws);
  });

  it("keeps BWrite's own proposed terms when the file is read again after it changed on disk", () => {
    const ws = run(withBilling(), loaded(BILLING, ARCLINT_FILE, BILLING_DOCUMENT));
    expect(languageOf(ws, BILLING).proposedTerms().map((t) => t.id)).toEqual([INVOICE]);
    expect(ws.localProposals[BILLING]).toHaveLength(1);
  });

  it("replaces BWrite's own proposed terms with the ones a saved change leaves", () => {
    const ws = run(withBilling(), loaded(BILLING, ARCLINT_FILE, BILLING_DOCUMENT, { localProposals: [] }));
    expect(languageOf(ws, BILLING).proposedTerms()).toEqual([]);
    expect(ws.localProposals).toEqual({});
  });

  it("keeps no proposed terms of its own for a file that holds proposals", () => {
    const ws = run(withBilling(), loaded(BILLING, BWRITE_FILE, { version: 1, project: "billing", terms: [] }));
    expect(ws.localProposals).toEqual({});
    expect(languageOf(ws, BILLING).terms).toEqual([]);
  });

  it("changes BWrite's own proposed terms only for a project whose language is built", () => {
    const ws = createSeedWorkspace(ROOT);
    expect(workspaceReducer(ws, { type: "vocabulary/local", projectId: SEED_IDS.project, localProposals: [], retargets: [] })).toBe(ws);
  });
});

describe("recording a proposed term that its features already name", () => {
  it("moves every reference to the term's id in the file, read back after arclint recorded it", () => {
    const READING = termIdFor(undefined, "Reading");
    const body = "Given an occurrence with a Reading";
    const from = body.indexOf("Reading");
    let ws = propose(seeded(), SEED_IDS.project, "Reading", "How one occurrence of text is read.", SEED_IDS.feature);
    ws = run(ws, {
      type: "feature/edited",
      featureId: SEED_IDS.feature,
      body,
      references: [termReferenceOf(body, from, body.length, READING, { kind: "names" })],
    });

    const built = builtLanguageOf(ws, SEED_IDS.project)!;
    const after = unwrap(built.language.record(READING, classificationOf("value_object", { context: termIdFor(undefined, "authoring") })));
    const edit = languageEdit(built, after, titleIn(ws));
    expect(edit.changes).toHaveLength(1);
    const recordedAs = termIdFor("authoring", "Reading");
    expect(edit.retargets).toEqual([[READING, recordedAs]]);

    // BWrite's server saves the change with arclint and answers with the file as read back.
    const folder = temporaryFolder({ withRepositoryDomain: true });
    runArclint(folder, "domain", "define", "value_object", "Reading", "--context", "authoring", "--definition", "How one occurrence of text is read.");
    ws = run(ws, loaded(SEED_IDS.project, ARCLINT_FILE, arclintDocument(folder), { localProposals: edit.localProposals, retargets: edit.retargets }));

    expect(ws.localProposals).toEqual({});
    expect(ws.features[0]!.references).toEqual([termReferenceOf(body, from, body.length, recordedAs, { kind: "names" })]);
    expect(languageOf(ws, SEED_IDS.project).term(recordedAs)).toMatchObject({ name: "Reading", status: "accepted" });
  });
});

describe("removing a rule the features state", () => {
  const RULE_KEY = "references-never-overlap";
  const RULE_TEXT = "Rule: A Feature never ties one piece of its text to two DomainTerms";
  const from = RULE_TEXT.indexOf("A Feature");
  const ruleReference = termReferenceOf(RULE_TEXT, from, RULE_TEXT.length, FEATURE_TERM, { kind: "rule", ruleKey: RULE_KEY });
  const second = featureIdOf("feature-second");

  /** Both features of the seed project state Feature's real invariant; Billing's feature is untouched. */
  function stated(): Workspace {
    return run(
      withBilling(),
      { type: "feature/edited", featureId: SEED_IDS.feature, body: RULE_TEXT, references: [ruleReference] },
      { type: "feature/created", projectId: SEED_IDS.project, featureId: second },
      { type: "feature/edited", featureId: second, body: RULE_TEXT, references: [ruleReference] },
    );
  }

  it("unties every occurrence that states it, in every feature of the project, once the file no longer holds it", () => {
    let ws = stated();
    const built = builtLanguageOf(ws, SEED_IDS.project)!;
    const edit = languageEdit(built, unwrap(built.language.removeRule(FEATURE_TERM, RULE_KEY)), titleIn(ws));
    expect(edit.changes).toHaveLength(1);

    const folder = temporaryFolder({ withRepositoryDomain: true });
    runArclint(folder, "domain", "remove", "invariant", RULE_KEY, "--owner", "Feature");
    ws = run(ws, loaded(SEED_IDS.project, ARCLINT_FILE, arclintDocument(folder), { localProposals: edit.localProposals, retargets: edit.retargets }));
    expect(languageOf(ws, SEED_IDS.project).rule(FEATURE_TERM, RULE_KEY)).toBeUndefined();

    const billingFeatures = featuresOf(ws.features, BILLING);
    ws = run(ws, { type: "rule/untied", projectId: SEED_IDS.project, termId: FEATURE_TERM, ruleKey: RULE_KEY });
    expect(featuresOf(ws.features, SEED_IDS.project).map((f) => [f.body, f.references])).toEqual([
      [RULE_TEXT, []],
      [RULE_TEXT, []],
    ]);
    featuresOf(ws.features, BILLING).forEach((f, i) => expect(f).toBe(billingFeatures[i]));
  });

  it("leaves every feature as it is when no feature states the rule", () => {
    const ws = stated();
    const after = run(ws, { type: "rule/untied", projectId: SEED_IDS.project, termId: FEATURE_TERM, ruleKey: "no-such-rule" });
    after.features.forEach((f, i) => expect(f).toBe(ws.features[i]));
  });

  it("unties only the project it names", () => {
    const ws = stated();
    const after = run(ws, { type: "rule/untied", projectId: BILLING, termId: FEATURE_TERM, ruleKey: RULE_KEY });
    after.features.forEach((f, i) => expect(f).toBe(ws.features[i]));
  });

  it("drops a reference the editor still reports to the removed rule, keeping the text", () => {
    const folder = temporaryFolder({ withRepositoryDomain: true });
    runArclint(folder, "domain", "remove", "invariant", RULE_KEY, "--owner", "Feature");
    let ws = run(stated(), loaded(SEED_IDS.project, ARCLINT_FILE, arclintDocument(folder)));
    ws = run(ws, { type: "feature/edited", featureId: SEED_IDS.feature, body: `${RULE_TEXT}!`, references: [ruleReference] });
    expect(ws.features[0]).toMatchObject({ body: `${RULE_TEXT}!`, references: [] });
  });
});
