import { expect, type Page } from "@playwright/test";
import { SEED_GHERKIN } from "../support/seed-feature";
import {
  activeProjectName,
  choose,
  createFeature,
  createProject,
  editor,
  editorLines,
  featureId,
  highlightedTerms,
  newProjectDialog,
  panel,
  panelToggle,
  picker,
  pickedLabel,
  proposeSelection,
  replaceBody,
  sidebar,
  sidebarToggle,
  titleField,
  waitForSaved,
  toasts,
} from "../support/page";
import { arclintTerms, expectedRecognitions, launchProjectName, test } from "../support/vocabulary-files";

const SEED_FEATURE = "Inspect domain vocabulary while authoring";

const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const projectRow = (page: Page, name: string) =>
  sidebar(page).locator("[data-kind=project] .bw-nav-row__main", { hasText: new RegExp(`^${escaped(name)}$`) });
const featureRow = (page: Page, name: string) =>
  sidebar(page).locator("[data-kind=feature] .bw-nav-row__main", { hasText: new RegExp(`^${escaped(name)}$`) });
const projectNames = (page: Page) => sidebar(page).locator("[data-kind=project] .bw-nav-row__main");
const featureNames = (page: Page) => sidebar(page).locator("[data-kind=feature] .bw-nav-row__main");
const confirmDialog = (page: Page) => page.getByRole("alertdialog");
const acceptedCount = (page: Page) => panel(page).getByRole("tab", { name: /Accepted/ }).locator(".bw-tabs__count");
const proposedCount = (page: Page) => panel(page).getByRole("tab", { name: /Proposed/ }).locator(".bw-tabs__count");

/** The seeded title fits on one line at these widths, so the field must be exactly one line tall. */
async function expectTitleOnOneLine(page: Page) {
  await expect
    .poll(() =>
      titleField(page).evaluate((el) => {
        const style = getComputedStyle(el);
        const content = el.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
        return Math.round(content / parseFloat(style.lineHeight));
      }),
    )
    .toBe(1);
}

async function reload(page: Page) {
  await waitForSaved(page);
  await page.reload();
  await expect(activeProjectName(page)).toBeVisible();
}

test.describe("with the seeded workspace", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await expect(highlightedTerms(page).first()).toBeVisible();
  });

  test("projects can be created, renamed, selected and deleted, and survive reload", async ({ page, roots }) => {
    const launch = launchProjectName(roots);
    await expect(sidebar(page)).toBeVisible();
    await expect(projectNames(page)).toHaveText([launch]);

    // A new project needs a name and a folder; the folder starts as the one BWrite was started in.
    await sidebar(page).getByRole("button", { name: "New project" }).click();
    const dialog = newProjectDialog(page);
    await expect(dialog.getByLabel("Name", { exact: true })).toHaveValue("Untitled project");
    await expect(dialog.getByLabel("Folder", { exact: true })).toHaveValue(roots.arclintProject);
    await dialog.getByLabel("Name", { exact: true }).fill("   ");
    await dialog.getByLabel("Folder", { exact: true }).fill("  ");
    await dialog.getByRole("button", { name: "Create project" }).click();
    await expect(dialog).toContainText("Enter a project name.");
    await expect(dialog).toContainText("Enter the folder that holds the project.");
    await expect(dialog.getByLabel("Name", { exact: true })).toHaveAttribute("aria-invalid", "true");
    await expect(dialog.getByLabel("Folder", { exact: true })).toHaveAttribute("aria-invalid", "true");
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(projectNames(page)).toHaveText([launch]);

    await createProject(page, "Billing");
    await expect(projectRow(page, "Billing")).toHaveAttribute("aria-current", "true");
    await expect(page).toHaveTitle("Billing · BWrite");
    await expect(page.getByRole("heading", { name: "No features in Billing" })).toBeVisible();

    // An invalid name is refused with a message; Escape keeps the old name.
    await sidebar(page).getByRole("button", { name: "Rename project Billing" }).click();
    const input = sidebar(page).getByRole("textbox", { name: "Rename project" });
    await input.fill("   ");
    await input.press("Enter");
    await expect(sidebar(page).getByRole("alert")).toHaveText("Enter a project name.");
    await input.press("Escape");
    await expect(projectRow(page, "Billing")).toBeFocused();

    await projectRow(page, "Billing").dblclick();
    await input.fill("Payments");
    await input.press("Enter");
    await expect(activeProjectName(page)).toHaveText("Payments");

    await projectRow(page, launch).click();
    await expect(activeProjectName(page)).toHaveText(launch);
    await expect(titleField(page)).toHaveValue(SEED_FEATURE);

    await reload(page);
    await expect(projectNames(page)).toHaveText([launch, "Payments"]);
    await expect(activeProjectName(page)).toHaveText(launch);

    // Cancelling a delete keeps the project and returns focus to the trigger.
    const deleteButton = sidebar(page).getByRole("button", { name: "Delete project Payments" });
    await deleteButton.click();
    await expect(confirmDialog(page)).toContainText("Delete project “Payments”?");
    await expect(confirmDialog(page).getByRole("button", { name: "Cancel" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(confirmDialog(page)).toHaveCount(0);
    await expect(deleteButton).toBeFocused();
    await expect(projectNames(page)).toHaveText([launch, "Payments"]);

    await deleteButton.click();
    await confirmDialog(page).getByRole("button", { name: "Delete project" }).click();
    await expect(projectNames(page)).toHaveText([launch]);
    await reload(page);
    await expect(projectNames(page)).toHaveText([launch]);
  });

  test("deleting the active project states what it removes and activates a neighbor", async ({ page, roots }) => {
    await createProject(page, "Billing");
    await createFeature(page, "Issue invoice", "Feature: Issue invoice\n  Scenario: Issue a draft invoice");
    await proposeSelection(page, "draft invoice", "An invoice not yet sent.");
    await sidebar(page).getByRole("button", { name: "Delete project Billing" }).click();
    // The project's vocabulary file is in its folder, not in this browser, so deleting leaves it.
    await expect(confirmDialog(page)).toContainText(
      `This removes 1 feature and 1 proposed term kept in this browser from this browser. Its vocabulary file in ${roots.arclintProject} stays as it is.`,
    );
    await confirmDialog(page).getByRole("button", { name: "Delete project" }).click();
    await expect(activeProjectName(page)).toHaveText(launchProjectName(roots));
    await expect(titleField(page)).toHaveValue(SEED_FEATURE);
  });

  test("features can be created, renamed, switched and deleted with stable IDs, and survive reload", async ({ page }) => {
    const seededId = "feature-inspect-domain-vocabulary";
    await expect(featureId(page)).toHaveText(seededId);

    await createFeature(page, "Issue invoice", "Feature: Issue invoice\n  Scenario: Issue a draft");
    await expect(featureRow(page, "Issue invoice")).toHaveAttribute("aria-current", "true");
    const invoiceId = (await featureId(page).textContent())!;
    expect(invoiceId).toMatch(/^feature-/);
    expect(invoiceId).not.toBe(seededId);

    // Renaming from the title field and from the sidebar both keep the ID.
    await titleField(page).fill("Issue an invoice");
    await expect(featureRow(page, "Issue an invoice")).toBeVisible();
    await expect(featureId(page)).toHaveText(invoiceId);
    await sidebar(page).getByRole("button", { name: "Rename feature Issue an invoice" }).click();
    const input = sidebar(page).getByRole("textbox", { name: "Rename feature" });
    await input.fill("Issue invoice to customer");
    await input.press("Enter");
    await expect(titleField(page)).toHaveValue("Issue invoice to customer");
    await expect(featureId(page)).toHaveText(invoiceId);

    // Switching preserves unsaved-looking edits in both features.
    await featureRow(page, SEED_FEATURE).click();
    await expect(featureId(page)).toHaveText(seededId);
    await replaceBody(page, "Feature: Edited seed");
    await featureRow(page, "Issue invoice to customer").click();
    expect(await editorLines(page)).toEqual(["Feature: Issue invoice", "  Scenario: Issue a draft"]);
    await featureRow(page, SEED_FEATURE).click();
    expect(await editorLines(page)).toEqual(["Feature: Edited seed"]);

    await reload(page);
    await expect(featureNames(page)).toHaveText([SEED_FEATURE, "Issue invoice to customer"]);
    await expect(featureId(page)).toHaveText(seededId);
    await featureRow(page, "Issue invoice to customer").click();
    await expect(featureId(page)).toHaveText(invoiceId);

    await sidebar(page).getByRole("button", { name: "Delete feature Issue invoice to customer" }).click();
    await expect(confirmDialog(page)).toContainText("Delete feature “Issue invoice to customer”?");
    await confirmDialog(page).getByRole("button", { name: "Delete feature" }).click();
    await expect(featureNames(page)).toHaveText([SEED_FEATURE]);
    await expect(featureId(page)).toHaveText(seededId);
    await reload(page);
    await expect(featureNames(page)).toHaveText([SEED_FEATURE]);
  });

  test("an untitled feature is listed as untitled and can be named later", async ({ page }) => {
    await sidebar(page).getByRole("button", { name: "New feature" }).click();
    await expect(featureRow(page, "Untitled feature")).toHaveAttribute("aria-current", "true");
    await expect(titleField(page)).toHaveValue("");
    await page.keyboard.type("Refund payment");
    await expect(featureRow(page, "Refund payment")).toBeVisible();
  });

  test("features and the Ubiquitous Language do not leak between projects", async ({ page, roots, emptyFolder }) => {
    const recorded = arclintTerms(roots.arclintProject);
    const launch = launchProjectName(roots);
    await createProject(page, "Billing", emptyFolder);
    await createFeature(page, "Issue invoice", "Feature: Issue invoice\n  Scenario: A Domain Term in a Feature");
    // The launch folder's terms belong to its project; Billing's folder has no vocabulary file yet.
    await expect(editor(page)).toContainText("A Domain Term in a Feature");
    await expect(highlightedTerms(page)).toHaveCount(0);
    await expect(featureNames(page)).toHaveText(["Issue invoice"]);

    await expect(panel(page)).toBeVisible();
    await expect(panel(page)).toContainText("Billing");
    await expect(panel(page).getByTestId("vocabulary-file")).toHaveText("Vocabulary: ubiquitous-language.bwrite.yaml (bwrite)");
    await expect(panel(page).getByText("No accepted terms in this project yet.")).toBeVisible();

    await projectRow(page, launch).click();
    await expect(featureNames(page)).toHaveText([SEED_FEATURE]);
    await expect(highlightedTerms(page)).toHaveText(expectedRecognitions(SEED_GHERKIN, recorded).map((r) => r.text));
    await expect(acceptedCount(page)).toHaveText(String(recorded.length));

    await reload(page);
    await projectRow(page, "Billing").click();
    await expect(featureNames(page)).toHaveText(["Issue invoice"]);
    await expect(highlightedTerms(page)).toHaveCount(0);
  });

  test("both side panels toggle and the editor stays usable either way", async ({ page }) => {
    await expect(sidebar(page)).toBeVisible();
    await expect(panel(page)).toBeVisible();
    await expect(sidebarToggle(page)).toHaveAttribute("aria-expanded", "true");
    await expect(panelToggle(page)).toHaveAttribute("aria-expanded", "true");

    for (const [sidebarOpen, panelOpen] of [
      [false, true],
      [false, false],
      [true, false],
      [true, true],
    ] as const) {
      if ((await sidebar(page).count()) > 0 !== sidebarOpen) await sidebarToggle(page).click();
      if ((await panel(page).count()) > 0 !== panelOpen) await panelToggle(page).click();
      await expect(sidebar(page)).toHaveCount(sidebarOpen ? 1 : 0);
      await expect(panel(page)).toHaveCount(panelOpen ? 1 : 0);
      await expect(sidebarToggle(page)).toHaveAttribute("aria-expanded", String(sidebarOpen));
      await expect(panelToggle(page)).toHaveAttribute("aria-expanded", String(panelOpen));

      const card = (await page.locator(".bw-editor-card").boundingBox())!;
      expect(card.width).toBeGreaterThan(560);
      await editor(page).click();
      await page.keyboard.press("ControlOrMeta+End");
      await page.keyboard.type(" ok");
      expect((await editorLines(page)).at(-1)).toMatch(/ ok$/);
      await expectTitleOnOneLine(page);
    }

    // Narrowing the window undocks and closes the panel; the title refits to the wider card.
    await page.setViewportSize({ width: 1024, height: 800 });
    await expect(panel(page)).toHaveCount(0);
    await expectTitleOnOneLine(page);
  });

  test("Open term opens the closed Ubiquitous Language panel on the term", async ({ page }) => {
    await panelToggle(page).click();
    await expect(panel(page)).toHaveCount(0);
    await highlightedTerms(page).filter({ hasText: /^Domain Term$/ }).first().hover();
    await page.getByRole("button", { name: "Open term" }).click();
    await expect(panel(page)).toBeVisible();
    await expect(panel(page).getByRole("heading", { name: "DomainTerm", level: 2 })).toBeFocused();
  });

  test("classification is saved separately from acceptance", async ({ page, roots }) => {
    const recorded = arclintTerms(roots.arclintProject);
    await proposeSelection(page, "definition", "What a term means in this project.");
    const term = () => panel(page).getByRole("button", { name: /^definition/ });
    await term().click();
    await expect(pickedLabel(panel(page), "Kind")).toHaveText("Not classified");
    await choose(panel(page), "Kind", "Domain Event");
    await expect(panel(page).locator(".bw-badge--proposed")).toHaveText("Proposed");
    // A bounded context is never required of a proposal: both relations are optional, and nothing is flagged.
    await expect(pickedLabel(panel(page), "Bounded context (optional)")).toHaveText("Not chosen");
    await expect(picker(panel(page), "Raised by (optional)")).toBeVisible();
    await expect(panel(page).getByRole("list", { name: "What arclint needs later" })).toHaveCount(0);
    await expect(panel(page).getByRole("alert")).toHaveCount(0);
    // Classifying a proposal that arclint's file cannot keep yet asks to change no file.
    await expect(confirmDialog(page)).toHaveCount(0);

    await reload(page);
    await panel(page).getByRole("tab", { name: /Proposed/ }).click();
    await term().click();
    await expect(pickedLabel(panel(page), "Kind")).toHaveText("Domain Event");
    await expect(panel(page).locator(".bw-badge--proposed")).toHaveText("Proposed");
    // The proposal is still not recognized in the feature; the accepted terms still are.
    await expect(highlightedTerms(page).filter({ hasText: "definition" })).toHaveCount(0);
    await expect(highlightedTerms(page).filter({ hasText: "Feature" })).toHaveCount(1);

    await panel(page).getByRole("button", { name: "All terms" }).click();
    await expect(term().locator(".bw-chip")).toHaveText("Domain Event");
    await expect(acceptedCount(page)).toHaveText(String(recorded.length));
    await expect(proposedCount(page)).toHaveText("1");
  });

  test("deleting every project leaves an empty workspace that survives reload", async ({ page, roots }) => {
    const launch = launchProjectName(roots);
    await sidebar(page).getByRole("button", { name: `Delete project ${launch}` }).click();
    await expect(confirmDialog(page)).toContainText(
      `This removes 1 feature from this browser. Its vocabulary file in ${roots.arclintProject} stays as it is.`,
    );
    await confirmDialog(page).getByRole("button", { name: "Delete project" }).click();

    await expect(page.getByRole("heading", { name: "No projects yet" })).toBeVisible();
    await expect(activeProjectName(page)).toHaveText("No project");
    await expect(panelToggle(page)).toBeDisabled();
    await expect(panel(page)).toHaveCount(0);
    await expect(sidebar(page).getByText("No projects yet. Create one to start writing features.")).toBeVisible();

    // The save status lives in the editor card, which is absent here, so wait on storage instead.
    await expect
      .poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("bwrite.workspace") ?? "null")?.workspace.projects))
      .toEqual([]);
    await page.reload();
    await expect(page.getByRole("heading", { name: "No projects yet" })).toBeVisible();

    await page.locator(".bw-empty").getByRole("button", { name: "New project" }).click();
    const dialog = newProjectDialog(page);
    await expect(dialog.getByLabel("Folder", { exact: true })).toHaveValue(roots.arclintProject);
    await dialog.getByLabel("Name", { exact: true }).fill("Fresh start");
    await dialog.getByRole("button", { name: "Create project" }).click();
    await expect(activeProjectName(page)).toHaveText("Fresh start");
    await page.locator(".bw-empty").getByRole("button", { name: "New feature" }).click();
    await expect(titleField(page)).toBeFocused();
  });
});

test.describe("with data saved in another shape", () => {
  // BWrite stored schema version 1 before projects had folders: each project's language was kept
  // in the browser as `languages`. It is not read, and it is kept rather than overwritten.
  const earlier = JSON.stringify({
    schemaVersion: 1,
    savedAt: "2026-10-09T10:00:00.000Z",
    workspace: {
      projects: [{ id: "project-bwrite", name: "BWrite", description: "", goals: [] }],
      features: [],
      languages: [{ projectId: "project-bwrite", terms: [] }],
      activeProjectId: "project-bwrite",
      openFeatureIds: {},
    },
  });

  test.beforeEach(async ({ page }) => {
    // Seed storage once, before the app first loads; later reloads must read what the app saved.
    await page.addInitScript((raw) => {
      if (sessionStorage.getItem("earlier-seeded")) return;
      sessionStorage.setItem("earlier-seeded", "1");
      localStorage.setItem("bwrite.workspace", raw);
    }, earlier);
    await page.goto("/");
  });

  test("starts from the seed, keeps the unreadable data under a backup key, and says so", async ({ page, roots }) => {
    const recorded = arclintTerms(roots.arclintProject);
    await expect(toasts(page)).toContainText("Saved data could not be read (unsupported schema version 1).");
    await expect(toasts(page)).toContainText("A copy was kept in browser storage as “bwrite.workspace.unreadable.");
    await expect(activeProjectName(page)).toHaveText(launchProjectName(roots));
    await expect(highlightedTerms(page)).toHaveText(expectedRecognitions(SEED_GHERKIN, recorded).map((r) => r.text));
    const backups = await page.evaluate(() =>
      Object.keys(localStorage)
        .filter((k) => k.startsWith("bwrite.workspace.unreadable."))
        .map((k) => localStorage.getItem(k)),
    );
    expect(backups).toEqual([earlier]);

    // The first save replaces the unreadable data, which stays in its backup.
    await editor(page).click();
    await page.keyboard.press("ControlOrMeta+End");
    await page.keyboard.type(" ok");
    await reload(page);
    await expect(page.getByText("Saved data could not be read")).toHaveCount(0);
    expect((await editorLines(page)).at(-1)).toMatch(/ ok$/);
    expect(
      await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("bwrite.workspace.unreadable.")).length),
    ).toBe(1);
  });
});
