import { expect, type Page } from "@playwright/test";
import { SEED_GHERKIN } from "../support/seed-feature";
import {
  caretToEnd,
  choose,
  copiedText,
  editor,
  editorLines,
  activeProjectName,
  featureId,
  highlightedTerms,
  panel,
  proposeButton,
  replaceBody,
  rightClickSelection,
  selectInEditor,
  waitForSaved,
  toasts,
} from "../support/page";
import {
  arclintTerms,
  expectedRecognitions,
  launchProjectName,
  recognizedInEditor,
  recordedTerm,
  termIdOfRecorded,
  termNamedBy,
  test,
  type RecordedTerm,
} from "../support/vocabulary-files";

/** The words the editor should highlight now, given the document as it reads and arclint's terms. */
async function expectHighlightsFollowText(page: Page, recorded: readonly RecordedTerm[]) {
  const expected = expectedRecognitions((await editorLines(page)).join("\n"), recorded);
  await expect(highlightedTerms(page)).toHaveText(expected.map((r) => r.text));
  expect(await recognizedInEditor(page)).toEqual(expected);
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(highlightedTerms(page).first()).toBeVisible();
});

test("shows the seeded project, feature, and highlighted vocabulary", async ({ page, roots }) => {
  const recorded = arclintTerms(roots.arclintProject);
  await expect(activeProjectName(page)).toHaveText(launchProjectName(roots));
  await expect(page.getByRole("img", { name: "BWrite" })).toBeVisible();
  await expect(featureId(page)).toHaveText("feature-inspect-domain-vocabulary");
  await expect(page.getByLabel("Feature", { exact: true })).toHaveValue("Inspect domain vocabulary while authoring");
  expect(await editorLines(page)).toEqual([
    "Feature: Inspect domain vocabulary while authoring",
    "  Scenario: Inspect an accepted Domain Term",
    "    Given a Feature contains an accepted Domain Term",
    "    When the author inspects the Domain Term",
    "    Then its definition is displayed",
    "    And the author can open the term details",
  ]);
  // Gherkin keywords are styled as syntax, not highlighted as domain terms.
  await expect(page.locator(".bw-tok-section")).toHaveText(["Feature:", "Scenario:"]);
  await expect(page.locator(".bw-tok-step")).toHaveText(["Given", "When", "Then", "And"]);
  // Every name and alias arclint records is highlighted, and nothing else.
  const expected = expectedRecognitions(SEED_GHERKIN, recorded);
  expect(expected.map((r) => r.text)).toEqual(["vocabulary", "authoring", "Domain Term", "Feature", "Domain Term", "Domain Term", "term"]);
  await expect(highlightedTerms(page)).toHaveText(expected.map((r) => r.text));
  expect(await recognizedInEditor(page)).toEqual(expected);
});

test("1. the title and body are editable", async ({ page }) => {
  const title = page.getByLabel("Feature", { exact: true });
  await title.fill("Propose missing vocabulary");
  await expect(title).toHaveValue("Propose missing vocabulary");

  await caretToEnd(page);
  await page.keyboard.press("Enter");
  await page.keyboard.type("But nothing is accepted automatically");
  expect((await editorLines(page)).at(-1)).toBe("    But nothing is accepted automatically");
});

test("2-3. highlights update while typing, with whole-term and multiword matching", async ({ page, roots }) => {
  const recorded = arclintTerms(roots.arclintProject);
  await replaceBody(page, "Feature: Glossary\n  Scenario: Matching\n    Given ");
  await expect(highlightedTerms(page)).toHaveCount(0);

  // "Features" and "featured" are not the term Feature; an alias of several words matches across extra spaces.
  await page.keyboard.type("Features, a featured Project and the ubiquitous   language");
  await expect(highlightedTerms(page)).toHaveText(["Project", "ubiquitous   language"]);
  await expect(highlightedTerms(page).nth(1)).toHaveAttribute(
    "data-term-id",
    termIdOfRecorded(termNamedBy(recorded, "Ubiquitous Language")),
  );
  await expectHighlightsFollowText(page, recorded);

  // Longest match wins: "domain term" is one highlight, not the alias "term" alone.
  await page.keyboard.type(" for each domain term");
  await expect(highlightedTerms(page)).toHaveText(["Project", "ubiquitous   language", "domain term"]);
  await expect(highlightedTerms(page).nth(2)).toHaveAttribute("data-term-id", termIdOfRecorded(recordedTerm(recorded, "DomainTerm")));

  // Turning a term into a longer word removes its highlight.
  await page.keyboard.type("s");
  await expect(highlightedTerms(page)).toHaveText(["Project", "ubiquitous   language"]);
  await expectHighlightsFollowText(page, recorded);
});

test("4-5. hovering a term shows its definition; Open term opens the detail view", async ({ page, roots }) => {
  const feature = recordedTerm(arclintTerms(roots.arclintProject), "Feature");
  await page.locator(".bw-term", { hasText: "Feature" }).hover();
  const popover = page.getByRole("dialog", { name: "Domain term: Feature" });
  await expect(popover).toBeVisible();
  await expect(popover).toContainText(`Ubiquitous Language · ${launchProjectName(roots)}`);
  await expect(popover).toContainText(feature.definition);

  // The popover stays open while the pointer moves into it.
  await popover.hover();
  await page.waitForTimeout(400);
  await expect(popover).toBeVisible();

  await popover.getByRole("button", { name: "Open term" }).click();
  await expect(popover).toBeHidden();
  const heading = panel(page).getByRole("heading", { name: "Feature", level: 2 });
  await expect(heading).toBeFocused();
  await expect(panel(page)).toContainText("Accepted");
  await expect(panel(page)).toContainText(feature.definition);
  await expect(panel(page).locator(".bw-occurrences__item")).toHaveCount(1);

  // An occurrence jumps back to that text in the editor.
  await panel(page).locator(".bw-occurrences__item").click();
  await expect(editor(page)).toBeFocused();
  expect(await page.evaluate(() => window.getSelection()!.toString())).toBe("Feature");
});

test("4. terms can be inspected from the keyboard and dismissed with Escape", async ({ page, roots }) => {
  const domainTerm = recordedTerm(arclintTerms(roots.arclintProject), "DomainTerm");
  await selectInEditor(page, "Domain Term");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ControlOrMeta+i");

  // "Domain Term" is an alias: the popover names the recorded term it stands for.
  const popover = page.getByRole("dialog", { name: "Domain term: DomainTerm" });
  await expect(popover).toContainText(domainTerm.definition);
  const open = popover.getByRole("button", { name: "Open term" });
  await expect(open).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(popover).toBeHidden();
  await expect(editor(page)).toBeFocused();

  // Enter on the focused link opens the detail view.
  await page.keyboard.press("ControlOrMeta+i");
  await expect(open).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(panel(page).getByRole("heading", { name: "DomainTerm", level: 2 })).toBeFocused();

  // With the cursor outside any term, the shortcut explains instead of failing silently.
  await caretToEnd(page);
  await page.keyboard.press("ControlOrMeta+i");
  await expect(toasts(page)).toContainText("Place the cursor inside a highlighted term");
});

test("6-8. proposing selected text saves a proposed term that is not highlighted", async ({ page, roots }) => {
  const recorded = arclintTerms(roots.arclintProject);
  await caretToEnd(page);
  await page.keyboard.press("Enter");
  await page.keyboard.type("And each Glossary Entry links back to its source");

  await expect(proposeButton(page)).toHaveAttribute("aria-disabled", "true");
  await selectInEditor(page, "Glossary Entry");
  await rightClickSelection(page);

  const menuItem = page.getByRole("menuitem", { name: "Propose domain term" });
  await expect(menuItem).toBeFocused();
  await menuItem.click();

  const dialog = page.getByRole("dialog", { name: "Propose domain term" });
  await expect(dialog.getByLabel("Name")).toHaveValue("Glossary Entry");
  await expect(dialog.getByLabel("Definition")).toBeFocused();
  await expect(dialog.locator("dt", { hasText: "Ubiquitous Language" }).locator("+ dd")).toHaveText(launchProjectName(roots));
  await expect(dialog).toContainText("Inspect domain vocabulary while authoring");

  await dialog.getByLabel("Definition").fill("A recorded explanation of one vocabulary term.");
  await dialog.getByRole("button", { name: "Save proposal" }).click();
  await expect(dialog).toBeHidden();

  // arclint's file keeps no proposed terms, so the proposal is kept in this browser without asking.
  await expect(toasts(page)).toContainText("Proposed “Glossary Entry”, kept in this browser");
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await expect(panel(page).getByRole("tab", { name: /Proposed/ })).toHaveAttribute("aria-selected", "true");
  await expect(panel(page).locator(".bw-term-list__item.is-recent")).toContainText("Glossary Entry");

  // Focus and selection come back to the editor, and the text is untouched.
  await expect(editor(page)).toBeFocused();
  expect(await page.evaluate(() => window.getSelection()!.toString())).toBe("Glossary Entry");
  expect((await editorLines(page)).at(-1)).toBe("    And each Glossary Entry links back to its source");

  // Proposed terms never become accepted highlights, and the accepted terms stay arclint's.
  await expect(highlightedTerms(page).filter({ hasText: "Glossary" })).toHaveCount(0);
  await expect(panel(page).getByRole("tab", { name: /Accepted/ }).locator(".bw-tabs__count")).toHaveText(String(recorded.length));

  await panel(page).locator(".bw-term-list__item", { hasText: "Glossary Entry" }).click();
  await expect(panel(page).locator(".bw-badge--proposed")).toHaveText("Proposed");
  await expect(panel(page)).toContainText("A recorded explanation of one vocabulary term.");
  await expect(panel(page).locator(".bw-detail__source")).toHaveText("Glossary Entry");
  await expect(panel(page)).toContainText("Inspect domain vocabulary while authoring");
});

test("6. the keyboard alternative opens the same proposal form", async ({ page }) => {
  await selectInEditor(page, "definition");
  await proposeButton(page).click();
  const dialog = page.getByRole("dialog", { name: "Propose domain term" });
  await expect(dialog.getByLabel("Name")).toHaveValue("definition");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(editor(page)).toBeFocused();
  await expect(panel(page).getByRole("tab", { name: /Proposed/ })).toContainText("0");
});

test("9. empty and duplicate submissions are rejected with clear messages", async ({ page, roots }) => {
  const feature = recordedTerm(arclintTerms(roots.arclintProject), "Feature");
  await selectInEditor(page, "Feature", 1);
  await proposeButton(page).click();
  const dialog = page.getByRole("dialog", { name: "Propose domain term" });
  const name = dialog.getByLabel("Name");
  const definition = dialog.getByLabel("Definition");
  const save = dialog.getByRole("button", { name: "Save proposal" });

  // Names are unique within a bounded context: placed where the accepted Feature is, the name is taken.
  await choose(dialog, "Kind", "Aggregate");
  await choose(dialog, "Bounded context", feature.context!);
  await expect(dialog).toContainText("“Feature” is already an accepted term in this project's Ubiquitous Language.");
  await expect(name).toHaveAttribute("aria-invalid", "true");
  await choose(dialog, "Kind", "Not classified");

  await name.fill("   ");
  await save.click();
  await expect(dialog).toContainText("Enter a term name.");
  await expect(dialog).toContainText("Enter a definition.");
  await expect(dialog).toBeVisible();

  await name.fill("  term   DETAILS ");
  await definition.fill("Everything recorded about one term.");
  await save.click();
  await expect(dialog).toBeHidden();
  await expect(panel(page).locator(".bw-term-list__item")).toHaveText([/term DETAILS/]);

  // A normalized duplicate of a proposed term is rejected too.
  await selectInEditor(page, "term details");
  await proposeButton(page).click();
  await expect(dialog).toContainText("“term DETAILS” has already been proposed.");
  await dialog.getByLabel("Definition").fill("Duplicate attempt.");
  await dialog.getByRole("button", { name: "Save proposal" }).click();
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(panel(page).locator(".bw-term-list__item")).toHaveCount(1);
});

test("10. reload restores the title, body, and proposals", async ({ page }) => {
  await page.getByLabel("Feature", { exact: true }).fill("Restored title");
  await caretToEnd(page);
  await page.keyboard.press("Enter");
  await page.keyboard.type("And the Project survives a reload");
  await selectInEditor(page, "reload");
  await proposeButton(page).click();
  const dialog = page.getByRole("dialog", { name: "Propose domain term" });
  await dialog.getByLabel("Definition").fill("Loading the page again.");
  await dialog.getByRole("button", { name: "Save proposal" }).click();
  await waitForSaved(page);

  await page.reload();
  await expect(page.getByLabel("Feature", { exact: true })).toHaveValue("Restored title");
  expect((await editorLines(page)).at(-1)).toBe("    And the Project survives a reload");
  await expect(highlightedTerms(page).filter({ hasText: "Project" })).toHaveCount(1);
  await expect(page.getByTestId("save-status")).toContainText("Restored");
  await panel(page).getByRole("tab", { name: /Proposed/ }).click();
  await expect(panel(page).locator(".bw-term-list__item")).toHaveText([/reload/]);
  await expect(highlightedTerms(page).filter({ hasText: "reload" })).toHaveCount(0);
});

test("11. typing inside a highlighted term, undo, redo, and paste behave normally", async ({ page, roots }) => {
  const recorded = arclintTerms(roots.arclintProject);
  const seedHighlights = expectedRecognitions(SEED_GHERKIN, recorded).map((r) => r.text);

  // Put the caret inside the first "Domain Term" (after "Dom") and type.
  await selectInEditor(page, "Domain Term");
  await page.keyboard.press("ArrowLeft");
  for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowRight");
  await page.keyboard.type("X");
  expect((await editorLines(page))[1]).toBe("  Scenario: Inspect an accepted DomXain Term");
  // "DomXain" is no word of the language, so only the alias "Term" after it is left.
  await expect(highlightedTerms(page)).toHaveText(["vocabulary", "authoring", "Term", "Feature", "Domain Term", "Domain Term", "term"]);
  await expectHighlightsFollowText(page, recorded);

  // One keystroke is one undo step; keystrokes further apart than CodeMirror's grouping delay are not grouped,
  // so the undo and redo checks use a single insertion to stay independent of timing.
  await page.keyboard.press("ControlOrMeta+z");
  expect((await editorLines(page))[1]).toBe("  Scenario: Inspect an accepted Domain Term");
  await expect(highlightedTerms(page)).toHaveText(seedHighlights);
  await page.keyboard.press("ControlOrMeta+Shift+Z");
  expect((await editorLines(page))[1]).toBe("  Scenario: Inspect an accepted DomXain Term");
  await page.keyboard.type("Y");
  expect((await editorLines(page))[1]).toBe("  Scenario: Inspect an accepted DomXYain Term");

  // Paste plain text containing markup-like characters at the end of a line.
  await selectInEditor(page, "displayed");
  await page.keyboard.press("ArrowRight");
  await page.evaluate(() => {
    const data = new DataTransfer();
    data.setData("text/plain", " <b>as a Project</b>");
    document.querySelector(".cm-content")!.dispatchEvent(
      new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }),
    );
  });
  await page.keyboard.type("!");
  expect((await editorLines(page))[4]).toBe("    Then its definition is displayed <b>as a Project</b>!");
  await expect(page.locator(".cm-content b")).toHaveCount(0);
  await expect(highlightedTerms(page).filter({ hasText: "Project" })).toHaveCount(1);

  // Shift-selection still works across highlighted text.
  await page.keyboard.press("Home");
  await page.keyboard.press("Shift+End");
  expect(await copiedText(page)).toBe("Then its definition is displayed <b>as a Project</b>!");
});

test("new-match shimmer is suppressed when reduced motion is requested", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(highlightedTerms(page).first()).toBeVisible();
  await editor(page).click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type(" Project");
  const fresh = page.locator(".bw-term-fresh");
  await expect(fresh).toHaveCount(1);
  expect(await fresh.evaluate((el) => getComputedStyle(el).animationName)).toBe("none");
});
