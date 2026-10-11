import { expect, type Page } from "@playwright/test";
import {
  associateButton,
  badgesOfKind,
  choose,
  editor,
  editorLines,
  highlightedTerms,
  panel,
  picker,
  pickedLabel,
  readingWords,
  proposeButton,
  references,
  replaceBody,
  rightClickSelection,
  selectInEditor,
  termItem,
  toasts,
  waitForSaved,
} from "../support/page";
import {
  arclintTerms,
  expectedRecognitions,
  recognizedInEditor,
  termNamedBy,
  test,
  type RecordedTerm,
} from "../support/vocabulary-files";

/** Freeform thinking: a note, standalone statements, a question, then a formal scenario. */
const MIXED = [
  "Thinking aloud about Authoring",
  "Given a Feature contains an accepted Domain Term",
  "- once a proposal is accepted, who can still edit it?",
  "Then the Domain Term Status and the Domain Term ID stay with the Domain Term",
  "",
  "Feature: Inspect vocabulary",
  "  Scenario: Inspect a Domain Term",
  "    When the author inspects the Domain Term",
  "    Then its definition is displayed",
];

const proposalDialog = (page: Page) => page.getByRole("dialog", { name: "Propose domain term" });
const referenceDialog = (page: Page) => page.getByRole("dialog", { name: /Associate with domain concept|Edit association/ });
const tab = (page: Page, name: string) => panel(page).getByRole("tab", { name: new RegExp(`^${name}`) });
const listItem = termItem;
const tabCount = (page: Page, name: string) => tab(page, name).locator(".bw-tabs__count");

/** The recorded term "Domain Term" names in the launch folder: arclint's DomainTerm, by its alias. */
const domainTermOf = (terms: readonly RecordedTerm[]) => termNamedBy(terms, "Domain Term");

/** Opens the popover of an associated occurrence from the keyboard: cursor inside it, then Ctrl+I. */
async function inspectReference(page: Page, text: string) {
  await selectInEditor(page, text);
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ControlOrMeta+i");
  const popover = page.getByRole("dialog", { name: `Domain reference: ${text}` });
  await expect(popover.getByRole("button", { name: "Open term" })).toBeFocused();
  return popover;
}

async function propose(page: Page, text: string, kind: string, context?: string) {
  await selectInEditor(page, text);
  await proposeButton(page).click();
  const dialog = proposalDialog(page);
  await dialog.getByLabel("Definition").fill(`The ${text} of the authoring model.`);
  await choose(dialog, "Kind", kind);
  if (context) await choose(dialog, "Bounded context", context);
  await dialog.getByRole("button", { name: "Save proposal" }).click();
  await expect(dialog).toBeHidden();
}

/**
 * Writes the mixed text, then models it in the recorded domain: two proposed Value Objects in the
 * bounded context arclint records Domain Term in. arclint's file keeps no proposals, so they stay
 * in this browser and the launch folder's file is never written.
 */
async function modelAuthoring(page: Page, context: string) {
  await replaceBody(page, MIXED.join("\n"));
  await propose(page, "Domain Term ID", "Value Object", context);
  await propose(page, "Domain Term Status", "Value Object", context);
  await tab(page, "Accepted").click();
}

/** Associates the first "accepted" with the Accepted value of Domain Term Status. */
async function associateAcceptedState(page: Page) {
  await selectInEditor(page, "accepted", 0);
  await rightClickSelection(page);
  await page.getByRole("menuitem", { name: "Associate with domain concept" }).click();
  const dialog = referenceDialog(page);
  await expect(dialog).toContainText("Only this occurrence of accepted is associated.");
  await dialog.getByLabel("is a value of a Value Object").check();
  await dialog.getByLabel("Value Object", { exact: true }).selectOption({ label: "Domain Term Status (proposed) · Value Object" });
  await expect(dialog.getByLabel("Value", { exact: true })).toHaveValue("accepted");
  await dialog.getByLabel("Value", { exact: true }).fill("Accepted");
  await expect(dialog.getByRole("radio", { name: /Keep the text as written/ })).toBeChecked();
  await expect(dialog.getByRole("region", { name: "Preview" })).toContainText("The text stays as written.");
  await expect(dialog.getByRole("region", { name: "Preview" })).toContainText(
    "Value “Accepted” of Domain Term Status (Value Object).",
  );
  await dialog.getByRole("button", { name: "Save association" }).click();
  await expect(dialog).toBeHidden();
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(highlightedTerms(page).first()).toBeVisible();
});

test("classification follows ArcLint's hierarchy, with owners, and survives reload", async ({ page, roots }) => {
  const recorded = arclintTerms(roots.arclintProject);
  const domainTerm = domainTermOf(recorded);
  const context = domainTerm.context!;
  // The kind list is ArcLint's term concepts, grouped by where its schema nests them.
  await listItem(page, "Feature").click();
  const kind = picker(panel(page), "Kind");
  await kind.click();
  expect(
    await panel(page).getByRole("listbox", { name: "Kind" }).evaluate((list) => {
      const label = (option: Element) => option.querySelector(".bw-picker__label")?.textContent;
      return {
        ungrouped: [...list.children].filter((c) => c.getAttribute("role") === "option").map(label),
        groups: [...list.querySelectorAll('[role="group"]')].map((g) => [
          g.firstElementChild?.textContent,
          [...g.querySelectorAll('[role="option"]')].map(label),
        ]),
      };
    }),
  ).toEqual({
    ungrouped: ["Not classified"],
    groups: [
      ["Top level", ["Bounded Context"]],
      ["In a bounded context", ["Aggregate", "Value Object", "Domain Event", "Domain Service", "Specification"]],
      ["In an aggregate", ["Entity"]],
    ],
  });
  await kind.press("Escape");
  await panel(page).getByRole("button", { name: "All terms" }).click();

  await modelAuthoring(page, context);
  await expect(tabCount(page, "Accepted")).toHaveText(String(recorded.length));
  await expect(tabCount(page, "Proposed")).toHaveText("2");

  // The recorded Entity sits under its Aggregate, in that Aggregate's bounded context.
  await listItem(page, domainTerm.name).click();
  await expect(pickedLabel(panel(page), "Kind")).toHaveText("Entity");
  await expect(pickedLabel(panel(page), "Aggregate")).toHaveText(domainTerm.aggregate!);
  await expect(panel(page).getByTestId("derived-context")).toHaveText(`${context}, from its Aggregate ${domainTerm.aggregate}.`);
  await expect(panel(page).getByRole("navigation", { name: "Place in the model" })).toHaveText(
    new RegExp(`${context}.*${domainTerm.aggregate}.*${domainTerm.name}`),
  );
  // arclint records everything it needs of this Entity.
  await expect(panel(page).getByRole("list", { name: "What arclint needs later" })).toHaveCount(0);
  await expect(panel(page).locator(".bw-badge--accepted")).toHaveText("Accepted");

  // Every recognized word carries its recorded kind's badge, without hovering. "Domain Term" inside the
  // proposed "Domain Term Status" and "Domain Term ID" is still the accepted term, by its alias.
  const expected = expectedRecognitions(MIXED.join("\n"), recorded);
  await expect.poll(() => recognizedInEditor(page)).toEqual(expected);
  await expect(badgesOfKind(page, "entity")).toHaveCount(expected.filter((r) => r.kind === "entity").length);

  // The Model view shows the hierarchy, with proposals marked as proposed.
  await panel(page).getByRole("button", { name: "All terms" }).click();
  await tab(page, "Model").click();
  const contextItem = panel(page)
    .getByRole("list", { name: "Bounded contexts" })
    .locator(":scope > li")
    .filter({ has: page.locator(":scope > .bw-model__item", { hasText: context }) });
  await expect(contextItem.locator(".bw-model__group", { hasText: "Aggregates" })).toContainText(domainTerm.aggregate!);
  const values = contextItem.locator(".bw-model__group", { hasText: "Value Objects" }).locator(".bw-model__name");
  await expect(values.filter({ hasText: "(proposed)" })).toHaveText(["Domain Term ID (proposed)", "Domain Term Status (proposed)"]);

  // The proposals and their classification are kept in this browser across a reload.
  await waitForSaved(page);
  await page.reload();
  await tab(page, "Proposed").click();
  await listItem(page, "Domain Term ID").click();
  await expect(pickedLabel(panel(page), "Kind")).toHaveText("Value Object");
  await expect(pickedLabel(panel(page), "Bounded context")).toHaveText(context);
  await expect.poll(() => recognizedInEditor(page)).toEqual(expected);
});

test("an occurrence is associated with a proposed term's value without touching other uses or its status", async ({
  page,
  roots,
}) => {
  const recorded = arclintTerms(roots.arclintProject);
  const context = domainTermOf(recorded).context!;
  await modelAuthoring(page, context);
  await associateAcceptedState(page);

  // Only the selected occurrence is bound, and its meaning is visible in the text.
  await expect(references(page)).toHaveText(["accepted"]);
  await expect(page.locator(".cm-line", { has: page.locator(".bw-ref") })).toHaveCount(1);
  await expect(page.locator(".cm-line").nth(1).locator(".bw-ref")).toHaveText("accepted");
  await expect(page.locator(".cm-line").nth(2).locator(".bw-ref")).toHaveCount(0);
  await expect(readingWords(page, "value · Domain Term Status")).toHaveText(["value"]);
  const valueMark = page
    .locator(".cm-content .bw-term-mark")
    .filter({ has: page.locator('.bw-term-mark__word[title*="value · Domain Term Status"]') });
  await expect(valueMark.locator(".bw-kind-badge")).toHaveAttribute("data-kind", "value_object");
  await expect(valueMark.locator(".bw-kind-badge")).toHaveClass(/bw-kind-badge--proposed/);
  expect(await editorLines(page)).toEqual(MIXED);

  // The term stays proposed; the Accepted value this text names does not accept anything.
  await expect(tabCount(page, "Accepted")).toHaveText(String(recorded.length));
  await expect(tabCount(page, "Proposed")).toHaveText("2");
  await tab(page, "Proposed").click();
  await listItem(page, "Domain Term Status").click();
  await expect(panel(page).locator(".bw-badge--proposed")).toHaveText("Proposed");
  await expect(panel(page).locator(".bw-occurrences__item")).toHaveCount(1);
  await expect(panel(page).locator(".bw-occurrences__association")).toHaveText(
    "Value “Accepted” of Domain Term Status (Value Object).",
  );

  // The popover separates whether the term is accepted from the value this text names.
  await references(page).hover();
  const popover = page.getByRole("dialog", { name: "Domain reference: accepted" });
  await expect(popover).toContainText("Value “Accepted” of Domain Term Status");
  await expect(popover).toContainText("Proposed term");
  await expect(popover).toContainText(`Value Object in ${context}`);

  await waitForSaved(page);
  await page.reload();
  await expect(references(page)).toHaveText(["accepted"]);
  await expect(page.locator(".cm-line").nth(1).locator(".bw-ref")).toHaveText("accepted");
  await expect(page.locator(".cm-line").nth(2).locator(".bw-ref")).toHaveCount(0);
  await expect(readingWords(page, "value · Domain Term Status")).toHaveCount(1);
  await expect(tabCount(page, "Proposed")).toHaveText("2");
});

test("rewording is explicit, previewed, undoable, and never caused by metadata changes", async ({ page, roots }) => {
  const context = domainTermOf(arclintTerms(roots.arclintProject)).context!;
  await modelAuthoring(page, context);
  await associateAcceptedState(page);

  // Changing metadata leaves the authored text alone.
  await tab(page, "Proposed").click();
  await listItem(page, "Domain Term Status").click();
  await choose(panel(page), "Kind", "Specification");
  expect(await editorLines(page)).toEqual(MIXED);
  await choose(panel(page), "Kind", "Value Object");
  await choose(panel(page), "Bounded context", context);
  expect(await editorLines(page)).toEqual(MIXED);

  // Edit the association from the editor and choose the value as the wording.
  await (await inspectReference(page, "accepted")).getByRole("button", { name: "Edit association" }).click();
  const dialog = referenceDialog(page);
  await expect(dialog.getByRole("heading", { name: "Edit association" })).toBeVisible();
  await expect(dialog.getByLabel("Value", { exact: true })).toHaveValue("Accepted");
  await expect(dialog.getByRole("radio", { name: new RegExp(`Qualified name: \\W?${context}\\.Domain Term Status\\.Accepted\\W?$`) })).toBeVisible();
  await dialog.getByRole("radio", { name: /The value: \W?Accepted\W?$/ }).check();
  const preview = dialog.getByTestId("wording-preview");
  await expect(preview.locator("del")).toHaveText("accepted");
  await expect(preview.locator("ins")).toHaveText("Accepted");
  await expect(preview).toHaveText("Given a Feature contains an acceptedAccepted Domain Term");
  // Nothing changes until the author saves.
  expect(await editorLines(page)).toEqual(MIXED);
  await dialog.getByRole("button", { name: "Save and replace text" }).click();
  await expect(dialog).toBeHidden();

  const reworded = [...MIXED];
  reworded[1] = "Given a Feature contains an Accepted Domain Term";
  expect(await editorLines(page)).toEqual(reworded);
  await expect(references(page)).toHaveText(["Accepted"]);
  await expect(editor(page)).toBeFocused();

  // One undo restores the original wording and keeps the association on it; redo reapplies.
  await page.keyboard.press("ControlOrMeta+z");
  expect(await editorLines(page)).toEqual(MIXED);
  await expect(references(page)).toHaveText(["accepted"]);
  await page.keyboard.press("ControlOrMeta+Shift+Z");
  await expect.poll(() => editorLines(page)).toEqual(reworded);
  await expect(references(page)).toHaveText(["Accepted"]);

  // Removing the association leaves the text as it is.
  await (await inspectReference(page, "Accepted")).getByRole("button", { name: "Edit association" }).click();
  await referenceDialog(page).getByRole("button", { name: "Remove association" }).click();
  await expect(references(page)).toHaveCount(0);
  expect(await editorLines(page)).toEqual(reworded);
});

test("freeform notes, standalone statements, and formal scenarios coexist without being rewritten", async ({ page, roots }) => {
  const recorded = arclintTerms(roots.arclintProject);
  await replaceBody(page, MIXED.join("\n"));

  const kinds = await page.locator(".cm-content .cm-line").evaluateAll((lines) => lines.map((l) => l.getAttribute("data-line-kind")));
  expect(kinds).toEqual(["note", "statement", "note", "statement", null, "section", "section", "statement", "statement"]);
  // Standalone statements get the same Gherkin styling as scenario steps.
  await expect(page.locator(".bw-tok-step")).toHaveText(["Given", "Then", "When", "Then"]);
  await expect(page.locator(".bw-tok-section")).toHaveText(["Feature:", "Scenario:"]);
  // Terms are recognized in notes, standalone statements, and scenarios alike.
  const lineTerms = (line: number) => expectedRecognitions(MIXED[line]!, recorded).map((r) => r.text);
  expect(lineTerms(1)).toEqual(["Feature", "Domain Term"]);
  for (const line of [0, 1, 3, 7]) {
    await expect(page.locator(".cm-line").nth(line).locator(".bw-term")).toHaveText(lineTerms(line));
  }

  // Inspection works in a standalone statement.
  await selectInEditor(page, "Feature", 0);
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ControlOrMeta+i");
  await expect(page.getByRole("dialog", { name: "Domain term: Feature" })).toBeVisible();
  await page.keyboard.press("Escape");

  // Proposing and associating work from a note.
  await selectInEditor(page, "proposal");
  await expect(associateButton(page)).toHaveAttribute("aria-disabled", "false");
  await proposeButton(page).click();
  await proposalDialog(page).getByLabel("Definition").fill("A suggested term awaiting acceptance.");
  await proposalDialog(page).getByRole("button", { name: "Save proposal" }).click();
  await expect(proposalDialog(page)).toBeHidden();
  await selectInEditor(page, "Thinking");
  await associateButton(page).click();
  const dialog = referenceDialog(page);
  await dialog.getByLabel("Term", { exact: true }).selectOption({ label: "proposal (proposed) · unclassified" });
  await dialog.getByRole("button", { name: "Save association" }).click();
  await expect(references(page)).toHaveText(["Thinking"]);
  await expect(badgesOfKind(page, "unclassified").and(page.locator(".bw-kind-badge--proposed"))).toHaveCount(1);

  // Nothing was wrapped in a Scenario or otherwise rewritten, before or after reload.
  expect(await editorLines(page)).toEqual(MIXED);
  await waitForSaved(page);
  await page.reload();
  expect(await editorLines(page)).toEqual(MIXED);
  await expect(references(page)).toHaveText(["Thinking"]);
});

test("a selection across lines cannot be associated", async ({ page }) => {
  await editor(page).click();
  await page.keyboard.press("ControlOrMeta+a");
  await expect(associateButton(page)).toHaveAttribute("aria-disabled", "true");
  // aria-disabled keeps the button reachable, so activating it explains what to select.
  await associateButton(page).focus();
  await page.keyboard.press("Enter");
  await expect(toasts(page)).toContainText("Select a word or phrase on one line");
  await expect(referenceDialog(page)).toHaveCount(0);
});
