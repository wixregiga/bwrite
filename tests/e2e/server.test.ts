import { expect, test } from "@playwright/test";
import { ROUTES } from "../../src/contexts/authoring/contracts/vocabulary-api";

import { e2eRoots } from "../support/vocabulary-files";

const arclintProject = () => e2eRoots().arclintProject;
const bwriteProject = () => e2eRoots().bwriteProject;

test("the server serves both Project folders, the arclint one as the launch root", async ({ request }) => {
  const roots = await (await request.get(ROUTES.roots)).json();
  expect(roots).toEqual({ ok: true, launchRoot: arclintProject(), roots: [arclintProject(), bwriteProject()] });

  const arclint = await (await request.get(ROUTES.vocabulary, { params: { path: arclintProject() } })).json();
  expect(arclint.source).toMatchObject({ format: "arclint", file: "domain.arclint.yaml", found: true });
  expect(arclint.document.terms.map((t: { name: string }) => t.name)).toContain("UbiquitousLanguage");

  const bwrite = await (await request.get(ROUTES.vocabulary, { params: { path: bwriteProject() } })).json();
  expect(bwrite.source).toMatchObject({ format: "bwrite", found: true });
  expect(bwrite.document.project).toBe("bookshop");
});
