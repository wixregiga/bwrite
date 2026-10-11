import { expect, type Page } from "@playwright/test";
import {
  choose,
  editor,
  editorLines,
  panel,
  pickedLabel,
  proposeSelection,
  readingWords,
  references,
  rightClickSelection,
  selectInEditor,
  termItem,
  toasts,
  waitForSaved,
} from "../support/page";
import {
  acceptedTermsOf,
  applyPlannedWrite,
  arclintTerms,
  confirmDialog,
  openProjectIn,
  plannedCommands,
  readBwriteDocument,
  recordedTerm,
  test,
  type RecordedTerm,
} from "../support/vocabulary-files";

/**
 * The recorded Aggregate the rules are placed on: arclint's UbiquitousLanguage, which the Rule
 * lines name by its alias. A Rule with a Scenario under it, a statement, and a note: free mixing stays valid.
 */
const AGGREGATE = "UbiquitousLanguage";
const INVARIANT = "A Ubiquitous Language never repeats a name";
/** The key BWrite derives from the rule's first words, without its leading article. */
const INVARIANT_KEY = "ubiquitous-language-never-repeats-a-name";
const RULES = [
  `Rule: ${INVARIANT}`,
  "  Scenario: Two terms with one name",
  "    Given a Ubiquitous Language",
  "A note about naming",
  "Rule: Proposing needs a definition",
];

const placeRuleDialog = (page: Page) => page.getByRole("dialog", { name: "Place rule" });
const placeRuleButton = (page: Page) => page.getByRole("button", { name: "Place rule", exact: true });
const listItem = termItem;
const ruleCue = (page: Page, text: string) => readingWords(page, text);
const rulesOf = (page: Page) => panel(page).getByRole("list", { name: `Rules of ${AGGREGATE}` });

/** Puts the cursor at the end of the line holding `text`. */
async function cursorAfter(page: Page, text: string) {
  await selectInEditor(page, text);
  await page.keyboard.press("ArrowRight");
}

/** Places the first Rule line as an invariant of the Aggregate, writing it to arclint's file once applied. */
async function placeInvariant(page: Page) {
  await cursorAfter(page, "repeats a name");
  await page.keyboard.press("ControlOrMeta+i");
  const dialog = placeRuleDialog(page);
  await expect(dialog).toContainText(`Line 1: ${INVARIANT}`);
  await expect(dialog.getByLabel("Key", { exact: true })).toHaveValue(INVARIANT_KEY);
  await expect(dialog.getByLabel("Statement", { exact: true })).toHaveValue(INVARIANT);
  await dialog.getByLabel("Term", { exact: true }).selectOption({ label: `${AGGREGATE} · Aggregate` });
  await dialog.getByRole("button", { name: "Place rule" }).click();
  await expect(dialog).toBeHidden();
  await applyPlannedWrite(page, `Place invariant “${INVARIANT_KEY}” on ${AGGREGATE}?`);
  await expect(ruleCue(page, `invariant of ${AGGREGATE}`)).toHaveCount(1);
}

let folder: string;
let recorded: RecordedTerm[];

test.describe("in a copy of the launch folder", () => {
  // Placing a rule writes arclint's file, so every test works in its own copy of the launch folder.
  test.beforeEach(async ({ page, arclintFolder }) => {
    folder = arclintFolder;
    recorded = arclintTerms(folder);
    await openProjectIn(page, folder, { title: "Name terms", body: RULES.join("\n") });
    await expect(page.locator(".cm-content .bw-term").first()).toBeVisible();
  });

  test("a Rule line is placed as an invariant through arclint, with a visible cue and term details, and undo unties only the line", async ({
    page,
  }) => {
    await placeInvariant(page);

    // arclint records the invariant on the Aggregate, and nothing else changed.
    const after = arclintTerms(folder);
    expect(recordedTerm(after, AGGREGATE).invariants).toEqual([
      ...recordedTerm(recorded, AGGREGATE).invariants,
      { key: INVARIANT_KEY, statement: INVARIANT },
    ]);
    expect(after.filter((t) => t.name !== AGGREGATE)).toEqual(recorded.filter((t) => t.name !== AGGREGATE));

    // The cue says what the line is without hover or color.
    await expect(references(page)).toHaveText([INVARIANT]);
    await expect(page.locator(".cm-line").first().locator(".bw-ref--rule")).toHaveCount(1);
    expect(await editorLines(page)).toEqual(RULES);

    // Lines inside and around the Rule keep working as before.
    const kinds = await page.locator(".cm-content .cm-line").evaluateAll((lines) => lines.map((l) => l.getAttribute("data-line-kind")));
    expect(kinds).toEqual(["section", "section", "statement", "note", "section"]);
    await expect(page.locator(".cm-line").nth(2).locator(".bw-term")).toHaveText(["Ubiquitous Language"]);

    // The term's details list the rule and where it is stated.
    await listItem(page, AGGREGATE).click();
    await expect(rulesOf(page)).toContainText("Invariant");
    await expect(rulesOf(page)).toContainText(INVARIANT_KEY);
    await expect(rulesOf(page)).toContainText(INVARIANT);
    await expect(rulesOf(page).getByRole("button", { name: "Line 1 of this feature" })).toBeVisible();

    // Undo unties the line and leaves the file as it is; redo ties it again to the rule the file still holds.
    await editor(page).click();
    await page.keyboard.press("ControlOrMeta+z");
    await expect(ruleCue(page, "invariant of")).toHaveCount(0);
    await expect(references(page)).toHaveCount(0);
    await expect(rulesOf(page).getByRole("button", { name: "Line 1 of this feature" })).toHaveCount(0);
    await expect(rulesOf(page)).toContainText(INVARIANT_KEY);
    expect(arclintTerms(folder)).toEqual(after);
    expect(await editorLines(page)).toEqual(RULES);
    await page.keyboard.press("ControlOrMeta+Shift+Z");
    await expect(ruleCue(page, `invariant of ${AGGREGATE}`)).toHaveCount(1);
    await expect(rulesOf(page).getByRole("button", { name: "Line 1 of this feature" })).toBeVisible();
    await expect(confirmDialog(page)).toHaveCount(0);

    await waitForSaved(page);
    await page.reload();
    await expect(ruleCue(page, `invariant of ${AGGREGATE}`)).toHaveCount(1);
    await listItem(page, AGGREGATE).click();
    await expect(rulesOf(page)).toContainText(INVARIANT_KEY);
  });

  test("an assertion is placed from the visible Place rule action, with plain validation messages", async ({ page }) => {
    // Away from a Rule line the action explains itself instead of opening.
    await cursorAfter(page, "A note about naming");
    await expect(placeRuleButton(page)).toHaveAttribute("aria-disabled", "true");
    // aria-disabled keeps the button reachable, so activating it explains what to do.
    await placeRuleButton(page).focus();
    await page.keyboard.press("Enter");
    await expect(toasts(page)).toContainText("Put the cursor on a line that starts with “Rule:”");

    await cursorAfter(page, "needs a definition");
    await expect(placeRuleButton(page)).toHaveAttribute("aria-disabled", "false");
    await placeRuleButton(page).click();
    const dialog = placeRuleDialog(page);
    await dialog.getByLabel("an assertion").check();
    await dialog.getByLabel("Key", { exact: true }).fill("");
    await dialog.getByLabel("Statement", { exact: true }).fill("  ");
    await dialog.getByRole("button", { name: "Place rule" }).click();
    await expect(dialog).toContainText("Choose the term this assertion belongs to.");
    await expect(dialog).toContainText("Name the operation this assertion is on.");
    await expect(dialog).toContainText("Enter a key.");
    await expect(dialog).toContainText("Enter the rule's statement.");

    await dialog.getByLabel("Term", { exact: true }).selectOption({ label: `${AGGREGATE} · Aggregate` });
    await dialog.getByLabel("Operation", { exact: true }).fill("Propose");
    await dialog.getByLabel("Key", { exact: true }).fill("proposing-needs-a-definition");
    await dialog.getByLabel("Statement", { exact: true }).fill("Proposing needs a definition");
    await dialog.getByRole("button", { name: "Place rule" }).click();
    await expect(dialog).toBeHidden();
    // The planned write is the arclint command that records the assertion.
    await expect(plannedCommands(page).first()).toContainText("arclint domain");
    await applyPlannedWrite(page, `Place assertion on Propose “proposing-needs-a-definition” on ${AGGREGATE}?`);
    await expect(ruleCue(page, `assertion of ${AGGREGATE} on Propose`)).toHaveCount(1);
    expect(recordedTerm(arclintTerms(folder), AGGREGATE).assertions).toContainEqual({
      key: "proposing-needs-a-definition",
      statement: "Proposing needs a definition",
      on: "Propose",
    });

    // A placed line says so instead of placing it twice.
    await cursorAfter(page, "needs a definition");
    await expect(placeRuleButton(page)).toHaveAttribute("aria-disabled", "true");
    await page.keyboard.press("Home");
    await page.keyboard.press("ControlOrMeta+i");
    await expect(toasts(page)).toContainText(
      `This Rule is already placed as assertion on Propose “proposing-needs-a-definition” of ${AGGREGATE}.`,
    );
  });

  test("the selection menu and a term's popover offer Place rule on a Rule line", async ({ page }) => {
    await selectInEditor(page, "repeats a name");
    await rightClickSelection(page);
    await page.getByRole("menuitem", { name: "Place rule" }).click();
    await expect(placeRuleDialog(page)).toContainText(`Line 1: ${INVARIANT}`);
    await page.keyboard.press("Escape");
    await expect(placeRuleDialog(page)).toBeHidden();

    // On a recognized term in the Rule, Ctrl+I inspects the term and offers to place the rule.
    await selectInEditor(page, "Ubiquitous Language");
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ControlOrMeta+i");
    const popover = page.getByRole("dialog", { name: /^Domain term: / });
    await expect(popover).toContainText(AGGREGATE);
    await popover.getByRole("button", { name: "Place rule" }).click();
    await expect(placeRuleDialog(page)).toBeVisible();

    // Off a Rule line the selection menu has no such item.
    await page.keyboard.press("Escape");
    await selectInEditor(page, "naming");
    await rightClickSelection(page);
    await expect(page.getByRole("menuitem", { name: "Propose domain term" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Place rule" })).toHaveCount(0);
  });

  test("removing a rule unties every line that states it, after a confirmation that says so", async ({ page }) => {
    await placeInvariant(page);
    await listItem(page, AGGREGATE).click();
    await panel(page).getByRole("button", { name: `Remove invariant ${INVARIANT_KEY}` }).click();
    const title = `Remove invariant “${INVARIANT_KEY}” from ${AGGREGATE}?`;
    await expect(confirmDialog(page).getByRole("heading", { name: title })).toBeVisible();
    await expect(confirmDialog(page)).toContainText("1 Rule line in 1 feature that state it stop being tied to it.");
    await expect(confirmDialog(page)).toContainText("The text of every feature stays as written.");
    await applyPlannedWrite(page, title);

    await expect(ruleCue(page, "invariant of")).toHaveCount(0);
    await expect(references(page)).toHaveCount(0);
    await expect(rulesOf(page)).not.toContainText(INVARIANT_KEY);
    expect(await editorLines(page)).toEqual(RULES);
    // arclint's file is back to what it recorded before.
    expect(arclintTerms(folder)).toEqual(recorded);

    // Undo in the editor never brings back a reference to the removed rule.
    await editor(page).click();
    await page.keyboard.press("ControlOrMeta+z");
    await expect(references(page)).toHaveCount(0);

    await waitForSaved(page);
    await page.reload();
    await expect(references(page)).toHaveCount(0);
  });

  test("an Aggregate in arclint's file becomes an Entity only inside an Aggregate, and the reason is shown", async ({ page }) => {
    await placeInvariant(page);
    await listItem(page, AGGREGATE).click();
    await choose(panel(page), "Kind", "Entity");
    await expect(panel(page).getByRole("alert")).toHaveText(
      "Not changed. domain.arclint.yaml keeps an Entity only inside its Aggregate. Choose the Aggregate.",
    );
    await expect(pickedLabel(panel(page), "Kind")).toHaveText("Aggregate");
    await expect(confirmDialog(page)).toHaveCount(0);
    await expect(ruleCue(page, `invariant of ${AGGREGATE}`)).toHaveCount(1);
  });

  test("an Entity takes its bounded context from its Aggregate, and qualified names follow containment", async ({ page }) => {
    const aggregate = recordedTerm(recorded, AGGREGATE);
    const context = aggregate.context!;
    // A proposal kept in this browser, so classifying it changes no file.
    await proposeSelection(page, "Scenario", "One concrete example of expected behavior.");
    await listItem(page, "Scenario").click();

    // An Aggregate without a bounded context is fine; arclint's later need is a gentle note.
    await choose(panel(page), "Kind", "Aggregate");
    await expect(panel(page).getByRole("list", { name: "What arclint needs later" })).toContainText(
      "arclint needs this Aggregate's identity: a Value Object term from the same bounded context.",
    );
    await expect(panel(page)).toContainText("An Aggregate term stands for the aggregate and its root entity together");

    await choose(panel(page), "Kind", "Entity");
    await expect(panel(page).getByTestId("derived-context")).toHaveText("None yet. An Entity is in the bounded context of its Aggregate.");
    await expect(panel(page).getByRole("list", { name: "What arclint needs later" })).toHaveText(
      "arclint needs the Aggregate this Entity belongs to.",
    );
    await choose(panel(page), "Aggregate (optional)", AGGREGATE);
    await expect(panel(page).getByTestId("derived-context")).toHaveText(`${context}, from its Aggregate ${AGGREGATE}.`);
    await expect(panel(page).getByRole("list", { name: "What arclint needs later" })).toHaveCount(0);
    await expect(panel(page).getByRole("navigation", { name: "Place in the model" })).toHaveText(
      new RegExp(`${context}.*${AGGREGATE}.*Scenario`),
    );
    await expect(confirmDialog(page)).toHaveCount(0);

    // The association dialog offers the qualified name, with one line saying what it is.
    await selectInEditor(page, "Scenario");
    await page.getByRole("button", { name: "Associate selection" }).click();
    const dialog = page.getByRole("dialog", { name: "Associate with domain concept" });
    await dialog.getByLabel("Term", { exact: true }).selectOption({ label: "Scenario (proposed) · Entity" });
    await expect(
      dialog.getByRole("radio", { name: new RegExp(`Qualified name: \\W?${context}\\.${AGGREGATE}\\.Scenario\\W?$`) }),
    ).toBeVisible();
    await expect(dialog).toContainText("A qualified name puts the names of the terms it sits under first, joined with dots.");
    await expect(dialog.getByText(/Describes/)).toHaveCount(0);
    await page.keyboard.press("Escape");
  });

  test("the interface never says entry, Legacy, Describes, or Pending", async ({ page }) => {
    // What the project's own domain file says is the team's text, not the interface's wording.
    const recordedText = recorded.flatMap((t) => [t.definition, ...t.invariants, ...t.assertions].map((x) => (typeof x === "string" ? x : x.statement)));
    const squeeze = (text: string) => text.replace(/\s+/gu, " ");
    const interfaceText = async (scope: ReturnType<typeof panel>) => {
      let text = squeeze((await scope.textContent()) ?? "");
      for (const said of recordedText) text = text.split(squeeze(said)).join(" ");
      return text;
    };
    await placeInvariant(page);
    await proposeSelection(page, "naming", "How things are named.");
    for (const tab of ["Accepted", "Proposed", "Model"]) {
      await panel(page).getByRole("tab", { name: new RegExp(`^${tab}`) }).click();
      expect(await interfaceText(panel(page))).not.toMatch(/\bentry\b|\bentries\b|Legacy|Describes|Pending/i);
    }
    await panel(page).getByRole("tab", { name: /^Proposed/ }).click();
    await listItem(page, "naming").click();
    expect(await interfaceText(panel(page))).not.toMatch(/\bentry\b|Legacy|Describes|Pending/i);
    await references(page).hover();
    await expect(page.getByRole("dialog", { name: /Placed rule/ })).not.toContainText(/\bentry\b|Pending/i);
  });
});

test("a term holding invariants cannot become an Entity, and the reason is shown", async ({ page, roots }) => {
  // In BWrite's own format an Entity may wait for its Aggregate, so the invariants are the reason.
  const listing = recordedTerm(acceptedTermsOf(readBwriteDocument(roots.bwriteProject)!), "Listing");
  const held = listing.invariants.length;
  expect(held).toBeGreaterThan(0);
  await openProjectIn(page, roots.bwriteProject, { title: "Sell listings", body: "Given a Listing" });
  await listItem(page, listing.name).click();
  const before = readBwriteDocument(roots.bwriteProject);
  await choose(panel(page), "Kind", "Entity");
  await expect(panel(page).getByRole("alert")).toHaveText(
    `Not changed. Remove its ${held} ${held === 1 ? "invariant" : "invariants"} first. Only an Aggregate or a Value Object holds invariants.`,
  );
  await expect(pickedLabel(panel(page), "Kind")).toHaveText("Aggregate");
  await expect(confirmDialog(page)).toHaveCount(0);
  expect(readBwriteDocument(roots.bwriteProject)).toEqual(before);
});
