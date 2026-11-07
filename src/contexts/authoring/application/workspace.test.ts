import { describe, expect, it } from "vitest";
import { termIdFor } from "../domain/term-id";
import { projectPathOf } from "../domain/project-path";
import { SEED_GHERKIN, SEED_IDS, createSeedWorkspace } from "./seed";
import { languageOf } from "./workspace";
import { REPO_ROOT, arclintDocument } from "../../../../tests/support/unit/arclint-listing";
import { ARCLINT_FILE } from "../../../../tests/support/unit/language-builders";
import { matched } from "../../../../tests/support/unit/term-matches";
import { withVocabulary } from "../../../../tests/support/unit/workspace-builders";

describe("a project's language as last read", () => {
  it("finds this repository's recorded vocabulary in the seeded feature, by names and aliases", () => {
    const ws = withVocabulary(createSeedWorkspace(projectPathOf(REPO_ROOT)), SEED_IDS.project, ARCLINT_FILE, arclintDocument());
    const found = matched(SEED_GHERKIN, languageOf(ws, SEED_IDS.project).acceptedTerms());
    const domainTerm = termIdFor("authoring", "DomainTerm");
    expect(found.filter(([, text]) => text === "Domain Term")).toEqual([
      [domainTerm, "Domain Term"],
      [domainTerm, "Domain Term"],
      [domainTerm, "Domain Term"],
    ]);
    expect(found).toContainEqual([termIdFor("authoring", "Feature"), "Feature"]);
    // "Term" is DomainTerm's other alias, and "Vocabulary" one of UbiquitousLanguage's.
    expect(found).toContainEqual([domainTerm, "term"]);
    expect(found).toContainEqual([termIdFor("authoring", "UbiquitousLanguage"), "vocabulary"]);
  });
});
