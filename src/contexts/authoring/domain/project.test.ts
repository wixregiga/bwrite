import { describe, expect, it } from "vitest";
import { cleanFeatureTitle } from "./feature";
import { MAX_PROJECT_NAME_LENGTH, Project, UNTITLED_PROJECT, nextAvailableName } from "./project";
import { projectPathOf, type ProjectPath } from "./project-path";
import { RefusalError } from "./refusal";
import { REPO_ROOT } from "../../../../tests/support/unit/arclint-listing";
import { refusalOf, unwrap } from "../../../../tests/support/unit/command-results";
import { PROJECT } from "../../../../tests/support/unit/language-builders";

const PATH = projectPathOf(REPO_ROOT);
const billing = () => new Project({ id: PROJECT, name: "Billing", description: "Payments.", goals: ["Get paid."], path: PATH });

describe("Project", () => {
  it("is created through its constructor with a name", () => {
    expect(billing()).toMatchObject({ id: PROJECT, name: "Billing", description: "Payments.", goals: ["Get paid."], path: REPO_ROOT });
  });

  it("never exists without a name (has-a-name)", () => {
    for (const name of ["", "   ", "\n\t"]) {
      expect(() => new Project({ id: PROJECT, name, description: "", goals: [], path: PATH })).toThrow(RefusalError);
    }
  });

  it("never exists without a path spelled as its door spells it (has-a-path)", () => {
    const make = (path: string) => () => new Project({ id: PROJECT, name: "Billing", description: "", goals: [], path: path as ProjectPath });
    expect(make("")).toThrow("Enter the folder that holds the project.");
    expect(make("  ")).toThrow("Enter the folder that holds the project.");
    expect(make(`${REPO_ROOT}/`)).toThrow(`“${REPO_ROOT}/” is not spelled as a ProjectPath.`);
    expect(make(` ${REPO_ROOT}`)).toThrow(RefusalError);
    expect(make(REPO_ROOT)().path).toBe(REPO_ROOT);
  });

  it("renames with whitespace collapsed and trimmed, keeping its ID and everything else", () => {
    const renamed = unwrap(billing().rename("  Billing \n  Platform "));
    expect(renamed).toMatchObject({ id: PROJECT, name: "Billing Platform", description: "Payments.", goals: ["Get paid."], path: PATH });
  });

  it("refuses a rename that would leave it without a name (has-a-name)", () => {
    expect(refusalOf(billing().rename(" \t "))).toBe("Enter a project name.");
  });

  it("refuses a name over the length limit", () => {
    expect(billing().rename("a".repeat(MAX_PROJECT_NAME_LENGTH)).ok).toBe(true);
    expect(refusalOf(billing().rename("a".repeat(MAX_PROJECT_NAME_LENGTH + 1)))).toBe(
      `Keep the project name to ${MAX_PROJECT_NAME_LENGTH} characters or fewer.`,
    );
  });
});

describe("projectPathOf", () => {
  it("spells one folder one way: trimmed, without trailing separators", () => {
    expect(projectPathOf(REPO_ROOT)).toBe(REPO_ROOT);
    expect(projectPathOf(`  ${REPO_ROOT}//  `)).toBe(REPO_ROOT);
    expect(projectPathOf("C:\\work\\shop\\")).toBe("C:\\work\\shop");
  });

  it("keeps the filesystem root's single separator", () => {
    expect(projectPathOf("/")).toBe("/");
    expect(projectPathOf("///")).toBe("/");
  });

  it("refuses an empty folder", () => {
    expect(() => projectPathOf(" \t")).toThrow("Enter the folder that holds the project.");
  });
});

describe("nextAvailableName", () => {
  it("numbers untitled projects, skipping names in use regardless of case", () => {
    expect(nextAvailableName(UNTITLED_PROJECT, [])).toBe("Untitled project");
    expect(nextAvailableName(UNTITLED_PROJECT, ["BWrite", "untitled PROJECT"])).toBe("Untitled project 2");
    expect(nextAvailableName(UNTITLED_PROJECT, ["Untitled project", "Untitled project 2"])).toBe("Untitled project 3");
  });
});

describe("cleanFeatureTitle", () => {
  it("keeps the title on one line", () => {
    expect(cleanFeatureTitle("  Issue\r\ninvoice  ")).toBe("Issue invoice");
    expect(cleanFeatureTitle("   ")).toBe("");
  });
});
