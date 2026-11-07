import { expect } from "@playwright/test";
import { launchProjectName, test } from "../support/vocabulary-files";
import {
  editor,
  highlightedTerms,
  panel,
  panelToggle,
  proposeButton,
  selectInEditor,
  sidebar,
  sidebarToggle,
} from "../support/page";

const pageOverflow = (page: import("@playwright/test").Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

test("narrow screens keep the editor usable without horizontal page scrolling", async ({ page }) => {
  await page.goto("/");
  await expect(highlightedTerms(page).first()).toBeVisible();
  await expect(panel(page)).toHaveCount(0);

  await expect(sidebar(page)).toHaveCount(0);
  expect(await pageOverflow(page)).toBeLessThanOrEqual(0);

  // The full title stays visible by wrapping.
  const title = page.getByLabel("Feature", { exact: true });
  const titleBox = await title.evaluate((el) => ({ scroll: el.scrollHeight, client: el.clientHeight }));
  expect(titleBox.scroll).toBeLessThanOrEqual(titleBox.client);

  await editor(page).click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type(" with a very long continuation that must wrap rather than scroll sideways");
  expect(await pageOverflow(page)).toBeLessThanOrEqual(0);

  await selectInEditor(page, "continuation");
  await proposeButton(page).click();
  const dialog = page.getByRole("dialog", { name: "Propose domain term" });
  const box = (await dialog.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  await page.keyboard.press("Escape");

  await panelToggle(page).click();
  await expect(panel(page)).toBeVisible();
  expect(await pageOverflow(page)).toBeLessThanOrEqual(0);
  await page.keyboard.press("Escape");
  await expect(panel(page)).toHaveCount(0);
  await expect(panelToggle(page)).toBeFocused();
});

test("narrow screens open projects and features as an overlay that closes on Escape or selection", async ({ page, roots }) => {
  await page.goto("/");
  await expect(highlightedTerms(page).first()).toBeVisible();

  await sidebarToggle(page).click();
  await expect(sidebar(page)).toBeVisible();
  await expect(sidebarToggle(page)).toHaveAttribute("aria-expanded", "true");
  // The overlay takes focus on the current project and fits the viewport.
  await expect(sidebar(page).getByRole("button", { name: launchProjectName(roots), exact: true })).toBeFocused();
  const box = (await sidebar(page).boundingBox())!;
  expect(box.x + box.width).toBeLessThan(page.viewportSize()!.width);
  expect(await pageOverflow(page)).toBeLessThanOrEqual(0);

  // Only one overlay is open at a time.
  await panelToggle(page).click();
  await expect(panel(page)).toBeVisible();
  await expect(sidebar(page)).toHaveCount(0);
  await page.keyboard.press("Escape");

  await sidebarToggle(page).click();
  await page.keyboard.press("Escape");
  await expect(sidebar(page)).toHaveCount(0);
  await expect(sidebarToggle(page)).toBeFocused();

  // Choosing a feature closes the overlay and returns to the editor.
  await sidebarToggle(page).click();
  await sidebar(page).getByRole("button", { name: "Inspect domain vocabulary while authoring", exact: true }).click();
  await expect(sidebar(page)).toHaveCount(0);
  await expect(editor(page)).toBeFocused();
});
