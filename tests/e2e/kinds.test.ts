import fs from "node:fs";
import path from "node:path";
import { expect, type Locator, type Page } from "@playwright/test";
import { stringify } from "yaml";
import type { DocumentPayload } from "../../src/contexts/authoring/contracts/vocabulary-api";
import {
  badgesOfKind,
  choose,
  copiedText,
  editor,
  editorLines,
  highlightedTerms,
  panel,
  pickedLabel,
  picker,
  proposeButton,
  proposeSelection,
  references,
  replaceBody,
  selectInEditor,
  termItem,
} from "../support/page";
import { BWRITE_FILE, arclintTerms, openProjectIn, termNamedBy, test, type RecordedTerm } from "../support/vocabulary-files";

const BODY = [
  "Thinking aloud about Reviewing",
  "Given a Feature contains an accepted Domain Term",
  "When the authoring Classification changes in the Ubiquitous Language",
  "Then the Domain Term stays with the Domain Term",
];

/** CodeMirror's default redo: Mod-Shift-z on macOS, Ctrl-y elsewhere. */
const REDO = process.platform === "darwin" ? "Meta+Shift+z" : "Control+y";

/** The badge letter of each kind: the global marks every badge in BWrite uses. */
const LETTERS: Readonly<Record<string, string>> = {
  bounded_context: "C",
  aggregate: "A",
  entity: "E",
  value_object: "V",
  domain_event: "Ev",
  domain_service: "S",
  specification: "Sp",
};

const kindPicker = (page: Page) => picker(panel(page), "Kind");
const listbox = (page: Page) => panel(page).getByRole("listbox", { name: "Kind" });
const proposalDialog = (page: Page) => page.getByRole("dialog", { name: "Propose domain term" });
const termButton = termItem;
const tab = (page: Page, name: string) => panel(page).getByRole("tab", { name: new RegExp(`^${name}`) });
const lineOf = (page: Page, text: string) => page.locator(".cm-content .cm-line", { hasText: text });

/** The option under the picker's cursor, which the combobox names with aria-activedescendant. */
async function activeOption(page: Page, combobox: Locator): Promise<Locator> {
  await expect(combobox).toHaveAttribute("aria-activedescendant", /.+/);
  const id = await combobox.getAttribute("aria-activedescendant");
  expect(id, "aria-activedescendant").toBeTruthy();
  return panel(page).locator(`[id="${id}"]`);
}

/** Opens a term from the keyboard: focus its list item and press Enter. */
async function openTerm(page: Page, name: string) {
  const item = termButton(page, name);
  await item.focus();
  await item.press("Enter");
  await expect(panel(page).getByRole("heading", { level: 2, name })).toBeVisible();
}

async function backToTerms(page: Page) {
  const back = panel(page).getByRole("button", { name: "All terms" });
  await back.focus();
  await back.press("Enter");
  await expect(panel(page).getByRole("tab", { name: /^Accepted/ })).toBeVisible();
}

/** The computed value of a kind's custom property, resolved the way a rule that uses it resolves. */
async function kindColor(page: Page, kind: string, tint = false): Promise<string> {
  return page.evaluate(
    ([id, suffix]) => {
      const probe = document.createElement("span");
      probe.style.color = `var(--kind-${id}${suffix})`;
      document.body.append(probe);
      const color = getComputedStyle(probe).color;
      probe.remove();
      return color;
    },
    [kind, tint ? "-tint" : ""] as const,
  );
}

const computed = (locator: Locator, property: string) =>
  locator.evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), property);

/** The words of BODY that name recorded terms of four different kinds, each with its kind as arclint records it. */
function expectedKinds(recorded: readonly RecordedTerm[]) {
  const expected = ["Feature", "Domain Term", "authoring", "Classification"].map((word) => {
    const term = termNamedBy(recorded, word);
    return { word, name: term.name, kind: term.kind!, letter: LETTERS[term.kind!]! };
  });
  expect(expected.map((e) => e.kind)).toEqual(["aggregate", "entity", "bounded_context", "value_object"]);
  return expected;
}

test.describe("in the launch folder", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await expect(highlightedTerms(page).first()).toBeVisible();
    await replaceBody(page, BODY.join("\n"));
  });

  test("the kind picker is a select-only combobox that works from the keyboard alone", async ({ page }) => {
    // A proposal kept in this browser, so choosing kinds changes no file.
    await proposeSelection(page, "Reviewing", "Reading a feature before it is agreed.");
    await expect(tab(page, "Proposed")).toHaveAttribute("aria-selected", "true");
    await openTerm(page, "Reviewing");
    const kind = kindPicker(page);

    // Closed: it is a labelled combobox that controls a listbox.
    await expect(kind).toHaveAttribute("aria-haspopup", "listbox");
    await expect(kind).toHaveAttribute("aria-expanded", "false");
    await expect(kind).not.toHaveAttribute("aria-activedescendant", /.+/);
    const listboxId = await kind.getAttribute("aria-controls");
    await expect(panel(page).locator(`[id="${listboxId}"]`)).toHaveAttribute("role", "listbox");
    await expect(pickedLabel(panel(page), "Kind")).toHaveText("Not classified");

    // Open: aria-activedescendant names the option under the cursor; focus stays on the combobox.
    await kind.focus();
    await kind.press("ArrowDown");
    await expect(kind).toHaveAttribute("aria-expanded", "true");
    await expect(kind).toBeFocused();
    await expect(listbox(page).getByRole("option")).toHaveCount(8);
    await expect(listbox(page).getByRole("group")).toHaveCount(3);
    await expect(listbox(page).getByRole("group", { name: "In a bounded context" }).getByRole("option")).toHaveCount(5);
    await expect(listbox(page).getByRole("option", { name: "Not classified" })).toHaveAttribute("aria-selected", "true");
    // Opening with the arrow moves one option on, from the chosen one.
    await expect(await activeOption(page, kind)).toHaveText(/Bounded Context/);

    await kind.press("End");
    await expect(await activeOption(page, kind)).toHaveText(/Entity/);
    await kind.press("ArrowDown");
    await expect(await activeOption(page, kind)).toHaveText(/Entity/);
    await kind.press("Home");
    await expect(await activeOption(page, kind)).toHaveText(/Not classified/);
    await kind.press("ArrowDown");
    await kind.press("ArrowDown");
    await expect(await activeOption(page, kind)).toHaveText(/Aggregate/);

    // Escape closes the list without choosing, and does not close the panel behind it.
    await kind.press("Escape");
    await expect(kind).toHaveAttribute("aria-expanded", "false");
    await expect(pickedLabel(panel(page), "Kind")).toHaveText("Not classified");
    await expect(panel(page)).toBeVisible();
    await expect(kind).toBeFocused();
    // With the list closed, Escape is the panel's again.
    await kind.press("Escape");
    await expect(panel(page)).toBeHidden();
    await page.getByRole("banner").getByRole("button", { name: /^Ubiquitous Language/ }).click();
    await expect(panel(page)).toBeVisible();
    await expect(kind).toBeVisible();

    // Enter chooses.
    await kind.focus();
    await kind.press("Enter");
    await kind.press("ArrowDown");
    await kind.press("ArrowDown");
    await kind.press("Enter");
    await expect(kind).toHaveAttribute("aria-expanded", "false");
    await expect(pickedLabel(panel(page), "Kind")).toHaveText("Aggregate");
    const currentListbox = await kind.getAttribute("aria-controls");
    await expect(panel(page).locator(`[id="${currentListbox}"] [role="option"][aria-selected="true"]`)).toContainText(
      "Aggregate",
    );

    // Type-ahead, repeated-letter type-ahead, and a first-letter jump choose too.
    await kind.press("Home");
    await page.keyboard.type("dom");
    await expect(await activeOption(page, kind)).toHaveText(/Domain Event/);
    await kind.press("Enter");
    await expect(pickedLabel(panel(page), "Kind")).toHaveText("Domain Event");
    // From Domain Event, "d" moves to Domain Service, "dd" wraps back to Domain Event, "ddd" on to Domain Service.
    await kind.focus();
    await page.keyboard.type("ddd");
    await expect(await activeOption(page, kind)).toHaveText(/Domain Service/);
    await kind.press("Enter");
    await expect(pickedLabel(panel(page), "Kind")).toHaveText("Domain Service");
    await kind.focus();
    await page.keyboard.type("v");
    await kind.press(" ");
    await expect(pickedLabel(panel(page), "Kind")).toHaveText("Value Object");

    // Alt+ArrowUp chooses too, and Tab chooses the option under the cursor while leaving the control.
    await kind.press("Home");
    await expect(await activeOption(page, kind)).toHaveText(/Not classified/);
    await kind.press("Alt+ArrowUp");
    await expect(pickedLabel(panel(page), "Kind")).toHaveText("Not classified");
    await kind.press("End");
    await kind.press("Tab");
    await expect(pickedLabel(panel(page), "Kind")).toHaveText("Entity");
    await expect(kind).not.toBeFocused();
    await expect(kind).toHaveAttribute("aria-expanded", "false");
    // Classifying a proposal kept in this browser asks to change no file.
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
  });

  test("each recorded kind shows its badge, letter and color in the editor, the picker, the lists and the popovers", async ({
    page,
    roots,
  }) => {
    const expected = expectedKinds(arclintTerms(roots.arclintProject));

    for (const { word, kind, letter } of expected) {
      // The term's own highlight, and the badge that is its immediate left neighbor on the same line.
      const text = page.locator(".cm-content .bw-term", { hasText: new RegExp(`^${word}$`) }).first();
      const badge = await text.evaluateHandle((el) => {
        let previous = el.previousElementSibling;
        while (previous && !previous.classList.contains("bw-term-mark")) {
          if (!previous.classList.contains("cm-widgetBuffer")) return null;
          previous = previous.previousElementSibling;
        }
        return previous?.querySelector(".bw-kind-badge") ?? null;
      });
      const badgeElement = badge.asElement();
      expect(badgeElement, `${word} has a badge before it`).not.toBeNull();

      const info = await badgeElement!.evaluate((b) => ({
        kind: b.getAttribute("data-kind"),
        text: b.textContent,
        classes: [...b.classList],
        label: b.getAttribute("aria-label"),
      }));
      expect(info.kind).toBe(kind);
      expect(info.text).toBe(letter);
      expect(info.classes).toContain(`bw-kind-badge--${kind}`);
      expect(info.classes).not.toContain("bw-kind-badge--proposed");
      expect(info.label).not.toBe(info.text);

      // It sits to the left of the term text and on its line.
      const [badgeBox, textBox] = await Promise.all([badgeElement!.boundingBox(), text.boundingBox()]);
      expect(badgeBox!.x + badgeBox!.width).toBeLessThanOrEqual(textBox!.x + 1);
      expect(textBox!.x - (badgeBox!.x + badgeBox!.width)).toBeLessThan(16);
      expect(Math.abs(badgeBox!.y + badgeBox!.height / 2 - (textBox!.y + textBox!.height / 2))).toBeLessThan(8);

      // The badge fill and the term text resolve to the kind's one global color; the highlight to its tint.
      const color = await kindColor(page, kind);
      expect(await badgeElement!.evaluate((b) => getComputedStyle(b).backgroundColor)).toBe(color);
      expect(await computed(text, "color")).toBe(color);
      expect(await computed(text, "background-color")).toBe(await kindColor(page, kind, true));
      expect(await computed(text, "text-decoration-line")).toContain("underline");
      expect(await computed(text, "text-decoration-color")).toBe(color);
    }

    // Different kinds are different colors.
    const colors = await Promise.all(expected.map(({ kind }) => kindColor(page, kind)));
    expect(new Set(colors).size).toBe(colors.length);
    const rendered = await page.locator(".cm-content .bw-kind-badge").evaluateAll((badges) =>
      Object.fromEntries(badges.map((b) => [b.getAttribute("data-kind"), getComputedStyle(b).backgroundColor])),
    );
    expect(new Set(Object.values(rendered)).size).toBe(Object.keys(rendered).length);

    // The picker draws the same badge for the same kind: same classes, same letter, same color.
    await openTerm(page, "Feature");
    await kindPicker(page).click();
    for (const { kind, letter } of expected) {
      const optionBadge = listbox(page).locator(`.bw-picker__option .bw-kind-badge[data-kind="${kind}"]`);
      await expect(optionBadge).toHaveText(letter);
      await expect(optionBadge).toHaveClass(new RegExp(`bw-kind-badge--${kind}`));
      expect(await computed(optionBadge, "background-color")).toBe(await kindColor(page, kind));
      expect(await optionBadge.evaluate((b) => b.outerHTML)).toBe(
        await page.locator(`.cm-content .bw-kind-badge[data-kind="${kind}"]`).first().evaluate((b) => b.outerHTML),
      );
    }
    // The option badge sits left of the kind's title.
    const option = listbox(page).getByRole("option", { name: "Value Object" });
    const [optionBadgeBox, optionLabelBox] = await Promise.all([
      option.locator(".bw-kind-badge").boundingBox(),
      option.locator(".bw-picker__label").boundingBox(),
    ]);
    expect(optionBadgeBox!.x + optionBadgeBox!.width).toBeLessThanOrEqual(optionLabelBox!.x);
    await expect(listbox(page).getByRole("option", { name: "Not classified" }).locator(".bw-kind-badge")).toHaveAttribute(
      "data-kind",
      "unclassified",
    );
    // Closing the list chooses nothing, so the recorded term is not changed.
    await kindPicker(page).press("Escape");
    await expect(pickedLabel(panel(page), "Kind")).toHaveText("Aggregate");
    await expect(page.getByRole("alertdialog")).toHaveCount(0);

    // The panel's term list draws the same badge left of the name.
    await backToTerms(page);
    const valueObject = expected.find((e) => e.kind === "value_object")!;
    const item = termButton(page, valueObject.name);
    const itemBadge = item.locator(".bw-kind-badge");
    await expect(itemBadge).toHaveAttribute("data-kind", "value_object");
    expect(await computed(itemBadge, "background-color")).toBe(await kindColor(page, "value_object"));
    const [itemBadgeBox, itemNameBox] = await Promise.all([
      itemBadge.boundingBox(),
      item.locator(".bw-term-list__name").boundingBox(),
    ]);
    expect(itemBadgeBox!.x).toBeLessThanOrEqual(itemNameBox!.x + 1);
    const itemText = await item.locator(".bw-term-list__name").evaluate((n) => n.textContent);
    expect(itemText).toMatch(new RegExp(`^V${valueObject.name}`));

    // The model tree draws one badge per term, and a term's occurrences draw it too.
    await tab(page, "Model").click();
    const recorded = arclintTerms(roots.arclintProject);
    await expect(panel(page).locator('.bw-model__item .bw-kind-badge[data-kind="bounded_context"]')).toHaveCount(
      recorded.filter((t) => t.kind === "bounded_context").length,
    );
    await expect(panel(page).locator(".bw-model__item .bw-kind-badge")).toHaveCount(recorded.length);
    await tab(page, "Accepted").click();
    const entity = expected.find((e) => e.kind === "entity")!;
    await openTerm(page, entity.name);
    const occurrence = panel(page).locator(".bw-occurrences__snippet").first();
    await expect(occurrence.locator(".bw-kind-badge")).toHaveAttribute("data-kind", "entity");
    expect(await computed(occurrence.locator("mark"), "color")).toBe(await kindColor(page, "entity"));
    expect(await computed(occurrence.locator("mark"), "background-color")).toBe(await kindColor(page, "entity", true));
    await expect(panel(page).locator(".bw-detail__title .bw-kind-badge")).toHaveAttribute("data-kind", "entity");
  });

  test("a proposed term's badge carries the proposed modifier in the editor, the list and the picker", async ({ page }) => {
    await selectInEditor(page, "Reviewing");
    await proposeButton(page).click();
    const dialog = proposalDialog(page);
    await dialog.getByLabel("Definition").fill("Reading a feature before it is agreed.");
    const kind = picker(dialog, "Kind");
    await kind.focus();
    await kind.press("Home");
    await kind.press("ArrowDown");
    await kind.press("Enter");
    await expect(pickedLabel(dialog, "Kind")).toHaveText("Bounded Context");
    await dialog.getByRole("button", { name: "Save proposal" }).click();
    await expect(dialog).toBeHidden();

    // A proposed term is not recognized by name, so the list and the pickers show it first.
    await tab(page, "Proposed").click();
    const listBadge = termButton(page, "Reviewing").locator(".bw-kind-badge");
    await expect(listBadge).toHaveAttribute("data-kind", "bounded_context");
    await expect(listBadge).toHaveClass(/bw-kind-badge--proposed/);
    await expect(listBadge).toHaveAttribute("data-proposed", "true");
    expect(await computed(listBadge, "outline-style")).toBe("dashed");

    // Associating the occurrence puts the proposed badge in the editor.
    await selectInEditor(page, "Reviewing");
    await page.getByRole("button", { name: "Associate selection" }).click();
    const association = page.getByRole("dialog", { name: /Associate with domain concept/ });
    await association.getByLabel("Term", { exact: true }).selectOption({ label: "Reviewing (proposed) · Bounded Context" });
    await association.getByRole("button", { name: "Save association" }).click();
    await expect(references(page)).toHaveText(["Reviewing"]);
    const editorBadge = page.locator('.cm-content .bw-kind-badge[data-proposed="true"]');
    await expect(editorBadge).toHaveCount(1);
    await expect(editorBadge).toHaveAttribute("data-kind", "bounded_context");
    await expect(editorBadge).toHaveClass(/bw-kind-badge--proposed/);
    await expect(editorBadge).toHaveAttribute("aria-label", "Proposed Bounded Context");
    expect(await computed(editorBadge, "background-color")).toBe(await kindColor(page, "bounded_context"));
    expect(await computed(page.locator(".cm-content .bw-ref"), "color")).toBe(await kindColor(page, "bounded_context"));
    expect(await computed(page.locator(".cm-content .bw-ref"), "text-decoration-style")).toBe("dashed");
    expect(await editorLines(page)).toEqual(BODY);

    // A related-term picker offers the proposed term with the same proposed badge.
    await proposeSelection(page, "Thinking", "Working a feature out before writing it down.");
    await openTerm(page, "Thinking");
    await choose(panel(page), "Kind", "Value Object");
    const context = picker(panel(page), "Bounded context");
    await context.click();
    const candidate = panel(page).getByRole("option", { name: "Reviewing (proposed)" });
    await expect(candidate.locator(".bw-kind-badge")).toHaveAttribute("data-kind", "bounded_context");
    await expect(candidate.locator(".bw-kind-badge")).toHaveClass(/bw-kind-badge--proposed/);
    expect(await computed(candidate.locator(".bw-kind-badge"), "background-color")).toBe(
      await kindColor(page, "bounded_context"),
    );
    // The recorded bounded context is offered too, without the proposed modifier.
    const recordedContext = panel(page).getByRole("option", { name: "authoring", exact: true });
    await expect(recordedContext.locator(".bw-kind-badge")).toHaveAttribute("data-kind", "bounded_context");
    await expect(recordedContext.locator(".bw-kind-badge")).not.toHaveClass(/bw-kind-badge--proposed/);
    // "Not chosen" is not a term, so it has no badge.
    await expect(panel(page).getByRole("option", { name: "Not chosen" }).locator(".bw-kind-badge")).toHaveCount(0);
    await candidate.click();
    await expect(pickedLabel(panel(page), "Bounded context")).toHaveText("Reviewing (proposed)");
    await expect(context.locator(".bw-kind-badge")).toHaveClass(/bw-kind-badge--proposed/);
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
  });

  test("the badge is not document text: copy, selection, caret movement, typing, and undo see only the term", async ({
    page,
  }) => {
    const line = BODY[1]!;
    const featureBadge = lineOf(page, "Given a").locator('.bw-kind-badge[data-kind="aggregate"]');
    await expect(featureBadge).toHaveCount(1);

    // Copying a whole line carries the line and none of the badge letters.
    await editor(page).click();
    await page.keyboard.press("ControlOrMeta+Home");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Home");
    await page.keyboard.press("Shift+End");
    expect(await copiedText(page)).toBe(line);
    expect(await editorLines(page)).toEqual(BODY);

    // Copying across every line is exactly the document.
    await page.keyboard.press("ControlOrMeta+a");
    expect(await copiedText(page)).toBe(BODY.join("\n"));

    // The caret steps over a badge in one key press, in both directions: eight characters reach "Feature".
    await page.keyboard.press("ControlOrMeta+Home");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Home");
    for (let i = 0; i < "Given a ".length; i++) await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Shift+ArrowRight");
    expect(await copiedText(page)).toBe("F");
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("Shift+ArrowRight");
    expect(await copiedText(page)).toBe(" ");

    // Typing right before a term lands in the text, never in the badge, and the term keeps its badge once whole.
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.type(" ");
    expect((await editorLines(page))[1]).toBe("Given a  Feature contains an accepted Domain Term");
    await expect(featureBadge).toHaveCount(1);
    await page.keyboard.type("x");
    expect((await editorLines(page))[1]).toBe("Given a  xFeature contains an accepted Domain Term");
    await expect(featureBadge).toHaveCount(0);

    // One undo takes the typing back, and the term and its badge return.
    await page.keyboard.press("ControlOrMeta+z");
    expect((await editorLines(page))[1]).toBe(line);
    await expect(featureBadge).toHaveCount(1);
    await page.keyboard.press(REDO);
    expect((await editorLines(page))[1]).toBe("Given a  xFeature contains an accepted Domain Term");
    await expect(featureBadge).toHaveCount(0);
    await page.keyboard.press("ControlOrMeta+z");
    await expect(featureBadge).toHaveCount(1);

    // Backspace right before a term deletes the character before it, not the badge.
    await page.keyboard.type(" ");
    expect((await editorLines(page))[1]).toBe("Given a  Feature contains an accepted Domain Term");
    await page.keyboard.press("Backspace");
    expect((await editorLines(page))[1]).toBe(line);
    await expect(featureBadge).toHaveCount(1);
    expect(await editorLines(page)).toEqual(BODY);
  });

  test("text composed with an input method before a term is inserted as text and the badge stays outside it", async ({
    page,
  }) => {
    const featureBadge = lineOf(page, "Given a").locator('.bw-kind-badge[data-kind="aggregate"]');
    await expect(featureBadge).toHaveCount(1);
    await editor(page).click();
    await page.keyboard.press("ControlOrMeta+Home");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Home");
    for (let i = 0; i < "Given a ".length; i++) await page.keyboard.press("ArrowRight");

    const client = await page.context().newCDPSession(page);
    await client.send("Input.imeSetComposition", { text: "に", selectionStart: 1, selectionEnd: 1 });
    await client.send("Input.imeSetComposition", { text: "にほ", selectionStart: 2, selectionEnd: 2 });
    await client.send("Input.imeSetComposition", { text: "日本", selectionStart: 2, selectionEnd: 2 });
    await client.send("Input.insertText", { text: "日本" });
    expect((await editorLines(page))[1]).toBe("Given a 日本Feature contains an accepted Domain Term");

    await page.keyboard.type(" ");
    expect((await editorLines(page))[1]).toBe("Given a 日本 Feature contains an accepted Domain Term");
    await expect(featureBadge).toHaveCount(1);
    expect(await editorLines(page)).toHaveLength(BODY.length);
    // The composed text and the space join one undo step only within CodeMirror's grouping delay,
    // so a slow run may need a second step; either way, undo restores exactly the text, never the badge.
    await page.keyboard.press("ControlOrMeta+z");
    if ((await editorLines(page))[1] !== BODY[1]) {
      expect((await editorLines(page))[1]).toBe("Given a 日本Feature contains an accepted Domain Term");
      await page.keyboard.press("ControlOrMeta+z");
    }
    expect((await editorLines(page))[1]).toBe(BODY[1]);
    await expect(featureBadge).toHaveCount(1);
  });

  test("the popovers show the kind's badge next to the kind name", async ({ page, roots }) => {
    const recorded = arclintTerms(roots.arclintProject);
    const valueObject = termNamedBy(recorded, "Classification");
    const aggregate = termNamedBy(recorded, "Ubiquitous Language");
    expect([valueObject.kind, aggregate.kind]).toEqual(["value_object", "aggregate"]);

    // Hover.
    await page.locator(".cm-content .bw-term", { hasText: /^Classification$/ }).hover();
    const hover = page.getByRole("dialog", { name: `Domain term: ${valueObject.name}` });
    await expect(hover).toBeVisible();
    const hoverBadge = hover.locator(".bw-term-popover__kind .bw-kind-badge");
    await expect(hoverBadge).toHaveAttribute("data-kind", "value_object");
    await expect(hoverBadge).toHaveText("V");
    await expect(hover.locator(".bw-term-popover__kind")).toContainText("Value Object");
    const [hoverBadgeBox, hoverTextBox] = await Promise.all([
      hoverBadge.boundingBox(),
      hover.locator(".bw-term-popover__kind-text").boundingBox(),
    ]);
    expect(hoverBadgeBox!.x + hoverBadgeBox!.width).toBeLessThanOrEqual(hoverTextBox!.x);
    await page.mouse.move(2, 2);
    await expect(hover).toBeHidden();

    // Ctrl+I at the caret, on an alias of the term.
    await selectInEditor(page, "Ubiquitous Language");
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ControlOrMeta+i");
    const inspected = page.getByRole("dialog", { name: `Domain term: ${aggregate.name}` });
    await expect(inspected.locator(".bw-term-popover__kind .bw-kind-badge")).toHaveAttribute("data-kind", "aggregate");
    await expect(inspected.locator(".bw-term-popover__kind")).toContainText("Aggregate");
    await page.keyboard.press("Escape");
    await expect(inspected).toBeHidden();
  });

  test("Escape in the proposal dialog's picker closes the list and leaves the dialog open", async ({ page }) => {
    await selectInEditor(page, "Reviewing");
    await proposeButton(page).click();
    const dialog = proposalDialog(page);
    const kind = picker(dialog, "Kind");
    await kind.focus();
    await kind.press("Enter");
    await expect(kind).toHaveAttribute("aria-expanded", "true");
    await expect(dialog.getByRole("listbox", { name: "Kind" })).toBeVisible();
    await kind.press("Escape");
    await expect(kind).toHaveAttribute("aria-expanded", "false");
    await expect(dialog).toBeVisible();
  });
});

test("an accepted term the file keeps without a kind is marked as unclassified, with a letter, not color alone", async ({
  page,
  emptyFolder,
}) => {
  // BWrite's own format keeps accepted terms that have no kind yet, as an author may write them by hand.
  const document: DocumentPayload = {
    version: 1,
    project: path.basename(emptyFolder),
    terms: [{ name: "Reviewer", definition: "Someone who reads a feature before it is agreed." }],
  };
  fs.writeFileSync(path.join(emptyFolder, BWRITE_FILE), stringify(document));
  await openProjectIn(page, emptyFolder, { title: "Review features", body: "Given a Reviewer reads the feature" });
  await expect(highlightedTerms(page)).toHaveText(["Reviewer"]);

  const badge = badgesOfKind(page, "unclassified").first();
  await expect(badge).toHaveText("?");
  await expect(badge).toHaveAttribute("aria-label", "Unclassified");
  await expect(badge).not.toHaveClass(/bw-kind-badge--proposed/);
  const color = await kindColor(page, "unclassified");
  expect(await computed(badge, "background-color")).toBe(color);
  expect(await computed(page.locator(".cm-content .bw-term").first(), "color")).toBe(color);
});
