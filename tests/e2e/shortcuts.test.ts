import { expect, type Locator, type Page } from "@playwright/test";
import { termIdFor } from "../support/term-recognition";
import { STORAGE_KEY } from "../support/vocabulary-files";
import { SEED_GHERKIN } from "../support/seed-feature";

/** BWrite's own shortcuts, as the dialog lists them on Linux. */
const BWRITE_SHORTCUTS: readonly (readonly [string, string])[] = [
  ["insert-term", "Insert domain term"],
  ["choose-term", "Choose domain term in dropdown"],
  ["inspect-term", "Inspect term"],
  ["search", "Search all projects"],
  ["shortcuts", "Display shortcuts"],
  ["dismiss", "Dismiss popup or simplify selection"],
];
import { editorLines } from "../support/page";
import {
  arclintTerms,
  launchProjectName,
  markedKind,
  openStoredWorkspace,
  recordedTerm,
  test,
  type E2eRoots,
  type RecordedTerm,
} from "../support/vocabulary-files";

const editor = (page: Page) => page.locator(".cm-content");
const insertion = (page: Page) => page.getByRole("listbox", { name: "Insert domain term" });
const palette = (page: Page) => page.getByRole("dialog", { name: "Search all projects" });
const termHeading = (page: Page, name: string) =>
  page.getByRole("complementary", { name: "Ubiquitous Language" }).getByRole("heading", { name, exact: true });

async function tabTo(page: Page, target: Locator) {
  for (let i = 0; i < 40; i++) {
    if (await target.evaluate((el) => el === document.activeElement)) return;
    await page.keyboard.press("Tab");
  }
  throw new Error("Keyboard focus did not reach its target");
}
async function body(page: Page, text: string) {
  await tabTo(page, editor(page));
  await page.keyboard.press("ControlOrMeta+a");
  if (text) await page.keyboard.insertText(text);
  else await page.keyboard.press("Backspace");
}
async function search(page: Page, query: string) {
  await page.keyboard.press("ControlOrMeta+k");
  await expect(palette(page)).toBeVisible();
  await expect(palette(page).getByRole("combobox")).toBeFocused();
  await page.keyboard.insertText(query);
}
async function storedReferences(page: Page) {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key)!).workspace.features[0].references, STORAGE_KEY);
}

const LAUNCH_FEATURE = "feature-launch";
/** A proposal kept in this browser, as BWrite keeps one for a folder set up for arclint. */
const STATUS = { name: "Domain Term Status", definition: "Whether a term is agreed on or proposed", kind: "value_object" } as const;

/**
 * The launch folder's recorded domain with one proposal kept in this browser, beside a Billing
 * project in a folder that has no vocabulary file, so its language is empty.
 */
async function loadWorkspace(page: Page, roots: E2eRoots, billingFolder: string): Promise<RecordedTerm[]> {
  const recorded = arclintTerms(roots.arclintProject);
  const context = recordedTerm(recorded, "DomainTerm").context!;
  await openStoredWorkspace(page, {
    projects: [
      { id: "project-launch", name: launchProjectName(roots), path: roots.arclintProject },
      { id: "project-billing", name: "Billing", path: billingFolder, description: "Invoices and account balances", goals: ["Accurate billing"] },
    ],
    features: [
      { id: LAUNCH_FEATURE, projectId: "project-launch", title: "Inspect domain vocabulary while authoring", body: SEED_GHERKIN },
      { id: "feature-charges", projectId: "project-billing", title: "Record charges", body: "Given an account\nThen outstanding   balances are reconciled" },
    ],
    localProposals: {
      "project-launch": [
        {
          ...STATUS,
          context,
          status: "proposed",
          proposal: { feature: "Inspect domain vocabulary while authoring", featureId: LAUNCH_FEATURE, text: STATUS.name, proposedAt: new Date().toISOString() },
        },
      ],
    },
    activeProjectId: "project-launch",
  });
  await expect(editor(page).locator(".bw-term").first()).toBeVisible();
  return recorded;
}

const statusId = (recorded: readonly RecordedTerm[]) => termIdFor(recordedTerm(recorded, "DomainTerm").context, STATUS.name);

let recorded: RecordedTerm[] = [];
test.beforeEach(async ({ page, roots, emptyFolder }) => {
  recorded = await loadWorkspace(page, roots, emptyFolder);
});

test("keyboard insertion lists the active language with global kind badges to the left", async ({ page }) => {
  await body(page, "");
  await page.keyboard.press("Control+Space");
  const list = insertion(page);
  await expect(list).toBeVisible();
  // Every recorded term, by name, then the proposal kept in this browser.
  const first = [...recorded].sort((a, b) => a.name.localeCompare(b.name))[0]!;
  await expect(list.getByRole("option")).toHaveCount(recorded.length + 1);
  await expect(list.getByRole("option").first()).toContainText(first.name);
  await expect(list.getByRole("option").first().locator(".bw-kind-badge")).toHaveAttribute("data-kind", markedKind(first));
  const domainTerm = list.getByRole("option").filter({ hasText: /DomainTerm\b/ });
  await expect(domainTerm.locator(".bw-kind-badge")).toHaveAttribute("data-kind", markedKind(recordedTerm(recorded, "DomainTerm")));
  await expect(list.getByRole("option").last()).toContainText(STATUS.name);
  await expect(list.getByRole("option").last()).toContainText("proposed");
  await expect(list.getByRole("option").last().locator(".bw-kind-badge")).toHaveAttribute("data-proposed", "true");
  for (const option of await list.getByRole("option").all()) {
    const positions = await option.evaluate((row) => {
      const badge = row.querySelector(".bw-kind-badge")!;
      const name = badge.nextElementSibling!;
      return { badge: badge.getBoundingClientRect().right, name: name.getBoundingClientRect().left };
    });
    expect(positions.badge).toBeLessThan(positions.name);
  }
  await page.keyboard.press("ArrowDown");
  await expect(list.getByRole("option").nth(1)).toHaveAttribute("aria-selected", "true");
  await expect(editor(page)).toHaveAttribute("aria-activedescendant", /term-insertion-\d+-1/);
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Escape");
  await expect(list).toBeHidden();
  await expect(editor(page)).toBeFocused();
  await expect(editor(page)).not.toHaveAttribute("aria-activedescendant", /.+/);
});

test("multi-word insertion creates a reference and undoes text and reference together", async ({ page }) => {
  await body(page, "Given Domain Term St");
  await page.keyboard.press("Control+Space");
  await expect(insertion(page).getByRole("option")).toHaveCount(1);
  await expect(insertion(page).getByRole("option").first()).toContainText(STATUS.name);
  await page.keyboard.press("Enter");
  await expect(insertion(page)).toBeHidden();
  await expect(editor(page).locator(".bw-ref")).toHaveText(STATUS.name);
  await expect
    .poll(() => storedReferences(page))
    .toEqual([{ from: 6, to: 6 + STATUS.name.length, termId: statusId(recorded), reading: { kind: "names" } }]);
  await page.keyboard.press("ControlOrMeta+z");
  // "Domain Term" names the recorded DomainTerm by its alias, so it keeps a badge; the text is as typed.
  await expect.poll(() => editorLines(page)).toEqual(["Given Domain Term St"]);
  await expect(editor(page).locator(".bw-ref")).toHaveCount(0);
  await expect.poll(() => storedReferences(page)).toEqual([]);
  await page.keyboard.press("ControlOrMeta+y");
  await expect(editor(page).locator(".bw-ref")).toHaveText(STATUS.name);
});

test("unmatched text has an explicit empty state and Escape keeps editor focus", async ({ page }) => {
  await body(page, "Given xyz");
  await page.keyboard.press("Control+Space");
  await expect(insertion(page)).toContainText("No domain terms match “xyz”");
  await expect(insertion(page).getByRole("option")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(editor(page)).toBeFocused();
  await expect(editor(page)).toContainText("Given xyz");
});

test("Tab chooses the option under the cursor, retaining its explicit reference", async ({ page }) => {
  const language = recordedTerm(recorded, "UbiquitousLanguage");
  await body(page, "Given Ubiq");
  await page.keyboard.press("Control+Space");
  await expect(insertion(page).getByRole("option")).toHaveCount(1);
  await page.keyboard.press("Tab");
  await expect(insertion(page)).toBeHidden();
  await expect(editor(page)).toBeFocused();
  await expect(editor(page).locator(".bw-ref")).toHaveText(language.name);
  await expect
    .poll(() => storedReferences(page))
    .toEqual([{ from: 6, to: 6 + language.name.length, termId: termIdFor(language.context, language.name), reading: { kind: "names" } }]);
});

test("shortcuts open from the editor and toolbar with every registered binding", async ({ page }) => {
  await tabTo(page, editor(page));
  await page.keyboard.press("ControlOrMeta+Shift+/");
  const dialog = page.getByRole("dialog", { name: "Keyboard shortcuts" });
  await expect(dialog).toBeVisible();
  for (const [id, description] of BWRITE_SHORTCUTS) {
    await expect(dialog.locator(`[data-shortcut-id="${id}"]`)).toContainText(description);
  }
  await expect(dialog).toContainText("Ctrl+Space");
  await expect(dialog).toContainText("Ctrl+K");
  await page.keyboard.press("Escape");
  await expect(editor(page)).toBeFocused();
  const button = page.getByRole("button", { name: "Shortcuts", exact: true });
  await tabTo(page, button);
  await page.keyboard.press("Enter");
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(button).toBeFocused();
});

test("global search opens from the editor, shows highlighted results, and navigates to term details", async ({ page, roots }) => {
  await tabTo(page, editor(page));
  await search(page, "Domain Term Status");
  const option = palette(page).getByRole("option");
  await expect(option).toHaveCount(1);
  await expect(option.locator("mark")).toHaveText(STATUS.name);
  await expect(option).toContainText(launchProjectName(roots));
  await page.keyboard.press("Enter");
  await expect(palette(page)).toBeHidden();
  await expect(termHeading(page, STATUS.name)).toBeFocused();
});

test("global search finds a feature body in another project and places the cursor at its normalized match", async ({ page }) => {
  await tabTo(page, editor(page));
  await search(page, "outstanding balances");
  await expect(palette(page).getByRole("option")).toContainText("Record charges");
  await expect(palette(page).locator("mark")).toHaveText("outstanding   balances");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("active-project")).toHaveText("Billing");
  await expect(page.getByLabel("Feature", { exact: true })).toHaveValue("Record charges");
  await expect(editor(page)).toBeFocused();
  // Typing at the search destination is a mechanical oracle for the actual editor offset.
  await page.keyboard.insertText("MATCH:");
  await expect(editor(page)).toContainText("Then MATCH:outstanding   balances are reconciled");
});

test("global search selects a project and Escape restores the originating editor", async ({ page }) => {
  await tabTo(page, editor(page));
  await search(page, "Billing");
  await expect(palette(page).getByRole("option")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(editor(page)).toBeFocused();
  await search(page, "Billing");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("active-project")).toHaveText("Billing");
  await expect(editor(page)).toBeFocused();
});

test("placed rule search opens the owning term and search toolbar restores focus", async ({ page }) => {
  const button = page.getByRole("button", { name: "Search", exact: true });
  await tabTo(page, button);
  await page.keyboard.press("Enter");
  await expect(palette(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(button).toBeFocused();
  // A rule arclint records on the launch folder's Ubiquitous Language.
  const language = recordedTerm(recorded, "UbiquitousLanguage");
  const rule = language.invariants.find((r) => r.key === "names-are-unique")!;
  await tabTo(page, editor(page));
  await search(page, rule.statement);
  await expect(palette(page).getByRole("option")).toHaveCount(1);
  await expect(palette(page).getByRole("option")).toContainText(`${language.name}: ${rule.key}`);
  await page.keyboard.press("Enter");
  await expect(termHeading(page, language.name)).toBeFocused();
});

test("empty search, arrow navigation, and unmatched searches retain the combobox contract", async ({ page }) => {
  await tabTo(page, editor(page));
  await page.keyboard.press("ControlOrMeta+k");
  await expect(palette(page)).toContainText("Type to search");
  await page.keyboard.insertText("Domain");
  const options = palette(page).getByRole("option");
  await page.keyboard.press("ArrowDown");
  await expect(options.nth(1)).toHaveAttribute("aria-selected", "true");
  await expect(palette(page).getByRole("combobox")).toHaveAttribute("aria-activedescendant", /option-1$/);
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.insertText("xyz");
  await expect(options).toHaveCount(0);
  await expect(palette(page)).toContainText("No matches for “xyz”");
  await page.keyboard.press("Escape");
  await expect(editor(page)).toBeFocused();
});

test("insertion uses an empty language after changing projects", async ({ page }) => {
  await tabTo(page, editor(page));
  await search(page, "Billing");
  await page.keyboard.press("Enter");
  await expect(editor(page)).toBeFocused();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Control+Space");
  await expect(insertion(page)).toContainText("No domain terms in this project");
  await expect(insertion(page).getByRole("option")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(editor(page)).toBeFocused();
});

test("cursor dropdown fits a small viewport and keyboard navigation scrolls active options", async ({ page }) => {
  await page.setViewportSize({ width: 700, height: 420 });
  await body(page, "Notes\n".repeat(25));
  await page.keyboard.press("Control+Space");
  await expect(insertion(page)).toBeVisible();
  const bounds = await insertion(page).boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.y).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(700);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(420);
  await page.keyboard.press("ArrowUp");
  await expect(insertion(page).getByRole("option").last()).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Escape");
  await expect(editor(page)).toBeFocused();
});

test("global search can open above another dialog and returns focus to its input", async ({ page }) => {
  await body(page, "New terminology");
  await page.keyboard.press("ControlOrMeta+a");
  const propose = page.getByRole("button", { name: "Propose selected term", exact: true });
  await tabTo(page, propose);
  await page.keyboard.press("Enter");
  const proposal = page.getByRole("dialog", { name: "Propose domain term" });
  await expect(proposal).toBeVisible();
  await expect(proposal.getByLabel("Definition", { exact: true })).toBeFocused();
  await search(page, "Domain Term");
  await page.keyboard.press("Escape");
  await expect(proposal.getByLabel("Definition", { exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(proposal).toBeHidden();
});

test("choosing a global result above a draft dialog focuses the destination", async ({ page }) => {
  await body(page, "New terminology");
  await page.keyboard.press("ControlOrMeta+a");
  await tabTo(page, page.getByRole("button", { name: "Propose selected term", exact: true }));
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "Propose domain term" })).toBeVisible();
  await search(page, "outstanding balances");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "Propose domain term" })).toBeHidden();
  await expect(page.getByTestId("active-project")).toHaveText("Billing");
  await expect(editor(page)).toBeFocused();
});
