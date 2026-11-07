import { expect, type Locator, type Page } from "@playwright/test";

export const editor = (page: Page) => page.locator(".cm-content");
export const highlightedTerms = (page: Page) => page.locator(".cm-content .bw-term");
export const proposeButton = (page: Page) => page.getByRole("button", { name: "Propose selected term" });
export const panel = (page: Page) => page.getByRole("complementary", { name: "Ubiquitous Language" });
/** The notices BWrite raises, apart from the panel's own vocabulary status line. */
export const toasts = (page: Page) => page.getByRole("status").and(page.locator(".bw-toast-region"));

/**
 * The panel's list item for the term named exactly `name`, read from the name's own text, so
 * "Feature" does not also find "FeatureId" and "Domain Term" not "Domain Term Status".
 */
export const termItem = (page: Page, name: string) =>
  panel(page).locator(
    `xpath=.//button[contains(concat(" ", @class, " "), " bw-term-list__item ")]` +
      `[.//*[contains(concat(" ", @class, " "), " bw-term-list__name ")]/text()[normalize-space(.)=${JSON.stringify(name)}]]`,
  );
export const panelToggle = (page: Page) => page.getByRole("banner").getByRole("button", { name: /^Ubiquitous Language/ });
export const sidebar = (page: Page) => page.getByRole("navigation", { name: "Projects and features" });
export const sidebarToggle = (page: Page) => page.getByRole("button", { name: "Projects and features", exact: true });
export const activeProjectName = (page: Page) => page.getByTestId("active-project");
export const featureId = (page: Page) => page.getByTestId("feature-id");
export const titleField = (page: Page) => page.getByLabel("Feature", { exact: true });

export const associateButton = (page: Page) => page.getByRole("button", { name: "Associate selection" });
/** The marks drawn left of recognized and associated words: a kind badge, and for values and rules a word. */
export const termMarks = (page: Page) => page.locator(".cm-content .bw-term-mark");
export const kindBadges = (page: Page) => page.locator(".cm-content .bw-term-mark .bw-kind-badge");
/** The badges drawn left of words whose term has `kind` (a TERM_KINDS id, or "unclassified"). */
export const badgesOfKind = (page: Page, kind: string) => page.locator(`.cm-content .bw-term-mark .bw-kind-badge[data-kind="${kind}"]`);
/** The words after a badge that say how a value or a rule is read; `title` is part of the sentence they abbreviate. */
export const readingWords = (page: Page, title: string) => page.locator(`.cm-content .bw-term-mark__word[title*="${title}"]`);
export const references = (page: Page) => page.locator(".cm-content .bw-ref");

/** Selector of the widgets that are drawn in the editor but are not document text. */
const NOT_DOCUMENT_TEXT = ".bw-term-mark";

/** Lines of the editor document as CodeMirror renders them, without the marks drawn left of words. */
export async function editorLines(page: Page): Promise<string[]> {
  return page.locator(".cm-content .cm-line").evaluateAll((lines) =>
    lines.map((line) => {
      const copy = line.cloneNode(true) as HTMLElement;
      copy.querySelectorAll(".bw-term-mark").forEach((mark) => mark.remove());
      return copy.textContent ?? "";
    }),
  );
}

/** Replaces the whole feature body through real keyboard input. */
export async function replaceBody(page: Page, text: string) {
  await editor(page).click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.insertText(text);
}

/**
 * What a real Ctrl+C of the current selection puts on the clipboard. The page's own copy
 * handler (CodeMirror's) writes it; a listener further up reads it as the browser would hand it on.
 */
export async function copiedText(page: Page): Promise<string> {
  await page.evaluate(() => {
    const slot = window as unknown as { copied: string | null };
    slot.copied = null;
    document.addEventListener("copy", (event) => (slot.copied = event.clipboardData?.getData("text/plain") ?? ""), {
      once: true,
    });
  });
  await page.keyboard.press("ControlOrMeta+c");
  await page.waitForFunction(() => (window as unknown as { copied: string | null }).copied !== null);
  return page.evaluate(() => (window as unknown as { copied: string }).copied);
}

/** Places the caret at the end of the document. */
export async function caretToEnd(page: Page) {
  await editor(page).click();
  await page.keyboard.press("ControlOrMeta+End");
}

/**
 * Selects an occurrence of `needle` (within one line) using a DOM range, as a mouse drag would.
 * `occurrence` counts from 0 across the whole document; the marks drawn left of words are not document text.
 */
export async function selectInEditor(page: Page, needle: string, occurrence = 0) {
  await editor(page).focus();
  await page.evaluate(([target, wanted, skipped]) => {
    const documentText = (line: Element) => {
      const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT, textFilter);
      let text = "";
      while (walker.nextNode()) text += (walker.currentNode as Text).data;
      return text;
    };
    const textFilter = {
      acceptNode: (node: Node) =>
        node.parentElement?.closest(skipped) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
    };
    let seen = 0;
    for (const line of document.querySelectorAll(".cm-content .cm-line")) {
      const text = documentText(line);
      let index = text.indexOf(target);
      while (index >= 0 && seen < wanted) {
        seen += 1;
        index = text.indexOf(target, index + 1);
      }
      if (index < 0) continue;
      const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT, textFilter);
      let offset = 0;
      let start: [Text, number] | undefined;
      let end: [Text, number] | undefined;
      while (walker.nextNode()) {
        const node = walker.currentNode as Text;
        const length = node.data.length;
        if (!start && index < offset + length) start = [node, index - offset];
        if (start && index + target.length <= offset + length) {
          end = [node, index + target.length - offset];
          break;
        }
        offset += length;
      }
      const range = document.createRange();
      range.setStart(...start!);
      range.setEnd(...end!);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      return;
    }
    throw new Error(`Text not found in editor: ${target} (occurrence ${wanted})`);
  }, [needle, occurrence, NOT_DOCUMENT_TEXT] as const);
  await expect(proposeButton(page)).toHaveAttribute("aria-disabled", "false");
}

/** Right-clicks in the middle of the current DOM selection. */
export async function rightClickSelection(page: Page) {
  const point = await page.evaluate(() => {
    const rect = window.getSelection()!.getRangeAt(0).getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  });
  await page.mouse.click(point.x, point.y, { button: "right" });
}

/** The kind and relationship pickers of the side pane and the proposal dialog. */
export const picker = (scope: Page | Locator, label: string | RegExp) => scope.getByRole("combobox", { name: label });

/** The label of the option a picker has chosen, without its badge. */
export const pickedLabel = (scope: Page | Locator, label: string | RegExp) => picker(scope, label).locator(".bw-picker__label");

/** Chooses `option` in the picker named `label` with the pointer. */
export async function choose(scope: Page | Locator, label: string | RegExp, option: string) {
  const combobox = picker(scope, label);
  await combobox.click();
  await expect(combobox).toHaveAttribute("aria-expanded", "true");
  await scope.getByRole("option", { name: option, exact: true }).click();
  await expect(combobox).toHaveAttribute("aria-expanded", "false");
}

export async function waitForSaved(page: Page) {
  await expect(page.getByTestId("save-status")).toContainText("Saved in this browser");
}

export const newProjectDialog = (page: Page) => page.getByRole("dialog", { name: "New project" });

/**
 * Creates a project from the sidebar's New project dialog. Without `folder` the project takes the
 * dialog's default, the folder BWrite was started in.
 */
export async function createProject(page: Page, name: string, folder?: string) {
  await sidebar(page).getByRole("button", { name: "New project" }).click();
  const dialog = newProjectDialog(page);
  await expect(dialog.getByLabel("Name", { exact: true })).toBeFocused();
  await dialog.getByLabel("Name", { exact: true }).fill(name);
  if (folder !== undefined) await dialog.getByLabel("Folder", { exact: true }).fill(folder);
  await dialog.getByRole("button", { name: "Create project" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(activeProjectName(page)).toHaveText(name);
}

/** Creates a feature in the active project from the sidebar, titles it and writes its body. */
export async function createFeature(page: Page, title: string, body: string) {
  await sidebar(page).getByRole("button", { name: "New feature" }).click();
  await expect(titleField(page)).toBeFocused();
  await page.keyboard.type(title);
  await replaceBody(page, body);
}

/** Proposes the selected occurrence of `text` with a definition, unclassified, from the toolbar. */
export async function proposeSelection(page: Page, text: string, definition: string, occurrence = 0) {
  await selectInEditor(page, text, occurrence);
  await proposeButton(page).click();
  const dialog = page.getByRole("dialog", { name: "Propose domain term" });
  await dialog.getByLabel("Definition").fill(definition);
  await dialog.getByRole("button", { name: "Save proposal" }).click();
  await expect(dialog).toBeHidden();
}
