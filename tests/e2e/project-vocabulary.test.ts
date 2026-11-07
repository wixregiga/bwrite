import fs from "node:fs";
import path from "node:path";
import { expect, type Page } from "@playwright/test";
import { SEED_GHERKIN } from "../support/seed-feature";
import { STORAGE_KEY } from "../support/vocabulary-files";
import {
  activeProjectName,
  choose,
  createFeature,
  createProject,
  highlightedTerms,
  panel,
  pickedLabel,
  proposeButton,
  proposeSelection,
  selectInEditor,
  waitForSaved,
  toasts,
} from "../support/page";
import {
  ARCLINT_FILE,
  BWRITE_FILE,
  acceptedTermsOf,
  applyPlannedWrite,
  arclint,
  arclintRuleIds,
  arclintTerms,
  backUpFiles,
  confirmDialog,
  expectedRecognitions,
  launchProjectName,
  listedTerms,
  listingOf,
  openProjectIn,
  plannedCommands,
  readBwriteDocument,
  recognizedInEditor,
  recordedTerm,
  sortedListing,
  termIdOfRecorded,
  test,
  type FileBackup,
} from "../support/vocabulary-files";

const tab = (page: Page, name: string) => panel(page).getByRole("tab", { name: new RegExp(`^${name}`) });
const tabCount = (page: Page, name: string) => tab(page, name).locator(".bw-tabs__count");
const listing = (page: Page) => async () => sortedListing(await listedTerms(panel(page)));
const proposalDialog = (page: Page) => page.getByRole("dialog", { name: "Propose domain term" });
const vocabularyFile = (page: Page) => panel(page).getByTestId("vocabulary-file");
const vocabularyStatus = (page: Page) => panel(page).getByTestId("vocabulary-status");
const toast = toasts;

async function openSeed(page: Page) {
  await page.goto("/");
  await expect(highlightedTerms(page).first()).toBeVisible();
}

test.describe("the launch folder's recorded domain", () => {
  test.beforeEach(async ({ page }) => openSeed(page));

  test("the Accepted tab and the editor show the terms arclint records, each with its kind's badge", async ({ page, roots }) => {
    const recorded = arclintTerms(roots.arclintProject);
    await expect(activeProjectName(page)).toHaveText(launchProjectName(roots));
    await expect(vocabularyFile(page)).toHaveText("Vocabulary: domain.arclint.yaml (arclint)");
    await expect(vocabularyStatus(page)).toHaveCount(0);

    // The accepted list is arclint's record, name for name and kind for kind.
    await expect(tab(page, "Accepted")).toHaveAttribute("aria-selected", "true");
    await expect.poll(listing(page)).toEqual(listingOf(recorded));
    await expect(tabCount(page, "Accepted")).toHaveText(String(recorded.length));
    await expect(tabCount(page, "Proposed")).toHaveText("0");

    // The seed feature's words are recognized as arclint's terms say, by name and by alias.
    await expect.poll(() => recognizedInEditor(page)).toEqual(expectedRecognitions(SEED_GHERKIN, recorded));
    const feature = recordedTerm(recorded, "Feature");
    const domainTerm = recordedTerm(recorded, "DomainTerm");
    expect(feature.kind).toBe("aggregate");
    expect(domainTerm).toMatchObject({ kind: "entity", aggregate: "UbiquitousLanguage" });
    expect(domainTerm.aliases).toContain("Domain Term");
    const recognized = await recognizedInEditor(page);
    expect(recognized.filter((r) => r.text === "Feature")).toEqual([
      { text: "Feature", termId: termIdOfRecorded(feature), kind: "aggregate" },
    ]);
    expect(recognized.filter((r) => r.text === "Domain Term")).toEqual(
      Array.from({ length: 3 }, () => ({ text: "Domain Term", termId: termIdOfRecorded(domainTerm), kind: "entity" })),
    );
  });

  test("the Rules tab lists the rules arclint enforces in the folder, read only", async ({ page, roots }) => {
    const ids = arclintRuleIds(roots.arclintProject);
    expect(ids.length).toBeGreaterThan(0);
    await tab(page, "Rules").click();
    const rules = panel(page).getByTestId("arclint-rule");
    await expect(rules.locator(".bw-rule-list__id")).toHaveText(ids);
    await expect(rules.getByRole("button")).toHaveCount(0);
    await expect(rules.getByRole("textbox")).toHaveCount(0);
  });

  test("“Domain Term” in the seed text is the entity DomainTerm, inspected in place and in its details", async ({ page, roots }) => {
    const recorded = arclintTerms(roots.arclintProject);
    const domainTerm = recordedTerm(recorded, "DomainTerm");

    await selectInEditor(page, "Domain Term");
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ControlOrMeta+i");
    const popover = page.getByRole("dialog", { name: "Domain term: DomainTerm" });
    await expect(popover).toContainText(`Ubiquitous Language · ${launchProjectName(roots)}`);
    await expect(popover).toContainText(domainTerm.definition);
    await expect(popover.locator(".bw-term-popover__kind .bw-kind-badge")).toHaveAttribute("data-kind", "entity");
    await expect(popover.locator(".bw-term-popover__kind")).toContainText("Entity");
    const open = popover.getByRole("button", { name: "Open term" });
    await expect(open).toBeFocused();
    await page.keyboard.press("Enter");

    await expect(panel(page).getByRole("heading", { name: "DomainTerm", level: 2 })).toBeFocused();
    await expect(panel(page).locator(".bw-badge--accepted")).toHaveText("Accepted");
    await expect(panel(page).locator(".bw-detail__definition")).toHaveText(domainTerm.definition);
    await expect(panel(page).locator(".bw-detail__title .bw-kind-badge")).toHaveAttribute("data-kind", "entity");
    await expect(pickedLabel(panel(page), "Kind")).toHaveText("Entity");
    await expect(pickedLabel(panel(page), "Aggregate")).toHaveText(domainTerm.aggregate!);
    await expect(panel(page).getByTestId("derived-context")).toHaveText(
      `${domainTerm.context}, from its Aggregate ${domainTerm.aggregate}.`,
    );
    await expect(panel(page).getByRole("navigation", { name: "Place in the model" })).toHaveText(
      new RegExp(`${domainTerm.context}.*${domainTerm.aggregate}.*DomainTerm`),
    );
    // Every word that names it, by name or alias, is one of its occurrences.
    const occurrences = expectedRecognitions(SEED_GHERKIN, recorded).filter((r) => r.termId === termIdOfRecorded(domainTerm));
    await expect(panel(page).locator(".bw-occurrences__item")).toHaveCount(occurrences.length);
  });
});

test.describe("recording a proposed term in an arclint folder", () => {
  const definition = "A recorded explanation of one vocabulary term.";
  const body = "Given each Glossary Entry links back to its source";

  test("keeps the proposal in this browser, then defines the term through arclint once confirmed", async ({ page, arclintFolder }) => {
    const domainFile = path.join(arclintFolder, ARCLINT_FILE);
    const before = arclintTerms(arclintFolder);
    const bytesBefore = fs.readFileSync(domainFile);
    const context = recordedTerm(before, "Feature").context!;
    await openProjectIn(page, arclintFolder, { title: "Keep a glossary", body });
    await expect(vocabularyFile(page)).toHaveText("Vocabulary: domain.arclint.yaml (arclint)");
    await expect.poll(listing(page)).toEqual(listingOf(before));

    // arclint's file keeps no proposed terms: the proposal stays in this browser, and the file is not touched.
    await proposeSelection(page, "Glossary Entry", definition);
    await expect(toast(page)).toContainText("Proposed “Glossary Entry”, kept in this browser");
    await expect(confirmDialog(page)).toHaveCount(0);
    await expect(tab(page, "Proposed")).toHaveAttribute("aria-selected", "true");
    await expect
      .poll(() =>
        page.evaluate(
          (key) => (JSON.parse(localStorage.getItem(key) ?? "null")?.workspace.localProposals["project-e2e"] ?? []).map((t: { name: string }) => t.name),
          STORAGE_KEY,
        ),
      )
      .toEqual(["Glossary Entry"]);
    expect(fs.readFileSync(domainFile).equals(bytesBefore)).toBe(true);

    // Classifying a proposed term changes nothing on disk either.
    await panel(page).locator(".bw-term-list__item", { hasText: "Glossary Entry" }).click();
    await choose(panel(page), "Kind", "Value Object");
    await choose(panel(page), "Bounded context", context);
    await expect(confirmDialog(page)).toHaveCount(0);
    expect(fs.readFileSync(domainFile).equals(bytesBefore)).toBe(true);

    // Recording plans the exact arclint command and runs nothing until the author applies it.
    await panel(page).getByRole("button", { name: "Record in vocabulary" }).click();
    const title = "Record “Glossary Entry” in domain.arclint.yaml?";
    await expect(confirmDialog(page).getByRole("heading", { name: title })).toBeVisible();
    await expect(confirmDialog(page)).toContainText(arclintFolder);
    await expect(plannedCommands(page)).toHaveCount(1);
    await expect(plannedCommands(page)).toContainText("arclint domain define value_object 'Glossary Entry'");
    await expect(plannedCommands(page)).toContainText(`--definition '${definition}'`);
    expect(fs.readFileSync(domainFile).equals(bytesBefore)).toBe(true);
    await applyPlannedWrite(page, title);
    await expect(toast(page)).toContainText("Recorded “Glossary Entry” in domain.arclint.yaml.");

    // arclint now records it, and nothing else changed.
    const after = arclintTerms(arclintFolder);
    expect(recordedTerm(after, "Glossary Entry")).toMatchObject({ kind: "value_object", context, definition });
    expect(after.filter((t) => t.name !== "Glossary Entry")).toEqual(before);

    // The language read back is arclint's: the open term is now accepted, listed under Accepted, and recognized.
    await expect(panel(page).getByRole("heading", { level: 2, name: "Glossary Entry" })).toBeVisible();
    await expect(panel(page).locator(".bw-badge--accepted")).toHaveText("Accepted");
    await panel(page).getByRole("button", { name: "All terms" }).click();
    await expect(tab(page, "Accepted")).toHaveAttribute("aria-selected", "true");
    await expect.poll(listing(page)).toEqual(listingOf(after));
    await expect(tabCount(page, "Proposed")).toHaveText("0");
    await expect.poll(() => recognizedInEditor(page)).toEqual(expectedRecognitions(body, after));
    expect((await recognizedInEditor(page)).find((r) => r.text === "Glossary Entry")?.kind).toBe("value_object");

    // The browser no longer keeps it; the file does.
    await waitForSaved(page);
    await page.reload();
    await expect.poll(listing(page)).toEqual(listingOf(after));
    await expect(tabCount(page, "Proposed")).toHaveText("0");
  });
});

test.describe("recording a proposed term in BWrite's format", () => {
  test.describe.configure({ mode: "serial" });
  let backup: FileBackup;
  test.beforeEach(async ({ roots }) => {
    backup = backUpFiles(roots.bwriteProject, [BWRITE_FILE]);
  });
  test.afterEach(() => backup.restore());

  test("writes the proposal to the file, then records it as accepted, each after confirmation", async ({ page, roots }) => {
    const folder = roots.bwriteProject;
    const before = readBwriteDocument(folder)!;
    const accepted = acceptedTermsOf(before);
    const listingTerm = recordedTerm(accepted, "Listing");
    const context = listingTerm.context!;
    const definition = "The label on the shelf where a listed book stands.";
    const body = "Given a Listing shows its Shelf Label";

    await openSeed(page);
    await createProject(page, "Bookshop", folder);
    await expect(vocabularyFile(page)).toHaveText("Vocabulary: ubiquitous-language.bwrite.yaml (bwrite)");
    await expect(vocabularyStatus(page)).toHaveCount(0);
    await expect.poll(listing(page)).toEqual(listingOf(accepted));
    await tab(page, "Rules").click();
    await expect(panel(page).getByRole("tabpanel")).toContainText("This folder is not set up for arclint");
    await expect(panel(page).getByTestId("arclint-rule")).toHaveCount(0);
    await tab(page, "Accepted").click();

    await createFeature(page, "Browse listings", body);
    await expect.poll(() => recognizedInEditor(page)).toEqual(expectedRecognitions(body, accepted));

    // BWrite's file keeps proposed terms, so proposing changes it, after the author confirms.
    await selectInEditor(page, "Shelf Label");
    await proposeButton(page).click();
    const dialog = proposalDialog(page);
    await dialog.getByLabel("Definition").fill(definition);
    await choose(dialog, "Kind", "Value Object");
    await choose(dialog, "Bounded context", context);
    await dialog.getByRole("button", { name: "Save proposal" }).click();
    await expect(dialog).toBeHidden();
    const proposeTitle = "Propose “Shelf Label” in ubiquitous-language.bwrite.yaml?";
    await expect(confirmDialog(page).getByRole("heading", { name: proposeTitle })).toBeVisible();
    await expect(confirmDialog(page)).toContainText(folder);
    await expect(plannedCommands(page)).toHaveCount(0);
    expect(readBwriteDocument(folder)).toEqual(before);
    await applyPlannedWrite(page, proposeTitle);
    await expect(toast(page)).toContainText("Proposed “Shelf Label”, kept in ubiquitous-language.bwrite.yaml.");

    const proposed = readBwriteDocument(folder)!;
    const shelf = proposed.terms.find((t) => t.name === "Shelf Label");
    expect(shelf).toMatchObject({
      name: "Shelf Label",
      kind: "value_object",
      context,
      definition,
      status: "proposed",
      proposal: { feature: "Browse listings", text: "Shelf Label" },
    });
    expect(shelf!.proposal!.featureId).toMatch(/^feature-/);
    expect(Number.isNaN(Date.parse(shelf!.proposal!.proposedAt))).toBe(false);
    expect(proposed.terms.filter((t) => t.name !== "Shelf Label")).toEqual(before.terms);
    await expect(tab(page, "Proposed")).toHaveAttribute("aria-selected", "true");
    await expect(tabCount(page, "Proposed")).toHaveText("1");
    expect((await recognizedInEditor(page)).map((r) => r.text)).not.toContain("Shelf Label");

    // Recording it rewrites the term as accepted, again only once confirmed.
    await panel(page).locator(".bw-term-list__item", { hasText: "Shelf Label" }).click();
    await panel(page).getByRole("button", { name: "Record in vocabulary" }).click();
    const recordTitle = "Record “Shelf Label” in ubiquitous-language.bwrite.yaml?";
    await expect(confirmDialog(page).getByRole("heading", { name: recordTitle })).toBeVisible();
    expect(readBwriteDocument(folder)).toEqual(proposed);
    await applyPlannedWrite(page, recordTitle);
    await expect(toast(page)).toContainText("Recorded “Shelf Label” in ubiquitous-language.bwrite.yaml.");

    const recordedDocument = readBwriteDocument(folder)!;
    expect(recordedDocument.terms.find((t) => t.name === "Shelf Label")).toEqual({
      name: "Shelf Label",
      kind: "value_object",
      context,
      definition,
    });
    expect(recordedDocument.terms.filter((t) => t.name !== "Shelf Label")).toEqual(before.terms);
    await expect(panel(page).locator(".bw-badge--accepted")).toHaveText("Accepted");
    await panel(page).getByRole("button", { name: "All terms" }).click();
    await expect(tab(page, "Accepted")).toHaveAttribute("aria-selected", "true");
    await expect.poll(listing(page)).toEqual(listingOf(acceptedTermsOf(recordedDocument)));
    await expect(tabCount(page, "Proposed")).toHaveText("0");
    await expect.poll(() => recognizedInEditor(page)).toEqual(expectedRecognitions(body, acceptedTermsOf(recordedDocument)));
  });
});

test.describe("changes made on disk", () => {
  test("a term arclint defines in the folder appears without reloading", async ({ page, arclintFolder }) => {
    const before = arclintTerms(arclintFolder);
    const context = recordedTerm(before, "Feature").context!;
    const body = "Every Glossary Note is kept beside the Feature";
    await openProjectIn(page, arclintFolder, { title: "Keep glossary notes", body });
    await expect.poll(listing(page)).toEqual(listingOf(before));
    await expect.poll(() => recognizedInEditor(page)).toEqual(expectedRecognitions(body, before));
    await page.evaluate(() => {
      (window as unknown as { sameDocument: boolean }).sameDocument = true;
    });

    arclint(arclintFolder, [
      "domain",
      "define",
      "value_object",
      "Glossary Note",
      "--context",
      context,
      "--definition",
      "A remark kept beside a glossary.",
    ]);
    const after = arclintTerms(arclintFolder);
    expect(recordedTerm(after, "Glossary Note")).toMatchObject({ kind: "value_object", context });

    await expect.poll(listing(page)).toEqual(listingOf(after));
    await expect(tabCount(page, "Accepted")).toHaveText(String(after.length));
    await expect.poll(() => recognizedInEditor(page)).toEqual(expectedRecognitions(body, after));
    expect((await recognizedInEditor(page)).find((r) => r.text === "Glossary Note")?.kind).toBe("value_object");
    expect(await page.evaluate(() => (window as unknown as { sameDocument?: boolean }).sameDocument)).toBe(true);
  });
});

test.describe("a folder without a vocabulary file", () => {
  test("offers to create ubiquitous-language.bwrite.yaml, and proposals wait for it", async ({ page, emptyFolder }) => {
    const file = path.join(emptyFolder, BWRITE_FILE);
    await openSeed(page);
    await createProject(page, "Glossary", emptyFolder);
    await expect(vocabularyFile(page)).toHaveText("Vocabulary: ubiquitous-language.bwrite.yaml (bwrite)");
    await expect(vocabularyStatus(page)).toContainText("This folder has no vocabulary file yet.");
    await expect(panel(page).getByText("No accepted terms in this project yet.")).toBeVisible();
    expect(fs.existsSync(file)).toBe(false);

    // A proposal needs the file BWrite's format keeps proposals in.
    await createFeature(page, "Keep words", "Given a Glossary keeps every word");
    await selectInEditor(page, "Glossary");
    await proposeButton(page).click();
    const dialog = proposalDialog(page);
    await dialog.getByLabel("Definition").fill("The words a team agreed on.");
    await dialog.getByRole("button", { name: "Save proposal" }).click();
    await expect(dialog.getByRole("alert")).toHaveText(
      "Create ubiquitous-language.bwrite.yaml first: this project has no vocabulary file yet.",
    );
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    expect(fs.existsSync(file)).toBe(false);

    await vocabularyStatus(page).getByRole("button", { name: "Create ubiquitous-language.bwrite.yaml" }).click();
    await expect(toast(page)).toContainText(`Created ubiquitous-language.bwrite.yaml in ${emptyFolder}.`);
    await expect(vocabularyStatus(page)).toHaveCount(0);
    expect(readBwriteDocument(emptyFolder)).toMatchObject({ version: 1, project: path.basename(emptyFolder), terms: [] });

    // Now the same proposal is written to it.
    await selectInEditor(page, "Glossary");
    await proposeButton(page).click();
    await dialog.getByLabel("Definition").fill("The words a team agreed on.");
    await dialog.getByRole("button", { name: "Save proposal" }).click();
    await applyPlannedWrite(page, "Propose “Glossary” in ubiquitous-language.bwrite.yaml?");
    await expect.poll(() => readBwriteDocument(emptyFolder)?.terms.map((t) => [t.name, t.status])).toEqual([["Glossary", "proposed"]]);
    await expect(tabCount(page, "Proposed")).toHaveText("1");
  });
});
