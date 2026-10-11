import { describe, expect, it } from "vitest";
import { docStringDelimiter, lineKinds, matchLineKeyword, ruleLineAt } from "./gherkin";

describe("matchLineKeyword", () => {
  it("recognizes section keywords with their colon", () => {
    expect(matchLineKeyword("Feature: x")).toEqual({ from: 0, to: 8, kind: "section", keyword: "Feature" });
    expect(matchLineKeyword("  Scenario: x")).toEqual({ from: 2, to: 11, kind: "section", keyword: "Scenario" });
  });

  it("prefers the longest section keyword", () => {
    expect(matchLineKeyword("  Scenario Outline: x")).toEqual({ from: 2, to: 19, kind: "section", keyword: "Scenario Outline" });
    expect(matchLineKeyword("Examples:")).toEqual({ from: 0, to: 9, kind: "section", keyword: "Examples" });
  });

  it("recognizes step keywords followed by whitespace", () => {
    expect(matchLineKeyword("    Given a thing")).toEqual({ from: 4, to: 9, kind: "step", keyword: "Given" });
    expect(matchLineKeyword("\tAnd more")).toEqual({ from: 1, to: 4, kind: "step", keyword: "And" });
    expect(matchLineKeyword("  * bullet step")).toEqual({ from: 2, to: 3, kind: "step", keyword: "*" });
  });

  it("rejects look-alikes", () => {
    expect(matchLineKeyword("Feature x")).toBeNull();
    expect(matchLineKeyword("Givenness matters")).toBeNull();
    expect(matchLineKeyword("given lower case")).toBeNull();
    expect(matchLineKeyword("a Feature: mid-line")).toBeNull();
    expect(matchLineKeyword("")).toBeNull();
  });
});

describe("docStringDelimiter", () => {
  it("detects both delimiter styles after indentation", () => {
    expect(docStringDelimiter('    """')).toBe('"""');
    expect(docStringDelimiter("  ```json")).toBe("```");
    expect(docStringDelimiter('  "" not one')).toBeNull();
  });
});

describe("lineKinds", () => {
  it("accepts freeform notes, standalone statements, and formal scenarios in any order", () => {
    const text = [
      "Thinking about acceptance",
      "Given a Feature contains an accepted Domain Term",
      "When the author inspects it",
      "- what about rejected terms?",
      "",
      "Feature: Inspect vocabulary",
      "  @wip",
      "  Scenario: Inspect",
      "    Then its definition is displayed",
      "    | name | status |",
      '    """',
      "    Given inside a doc string",
      '    """',
      "  # a comment",
      "Then a trailing statement after the scenario",
    ].join("\n");
    expect(lineKinds(text)).toEqual([
      "note",
      "statement",
      "statement",
      "note",
      "blank",
      "section",
      "tag",
      "section",
      "statement",
      "table",
      "docString",
      "docString",
      "docString",
      "comment",
      "statement",
    ]);
  });

  it("keeps Rule sections, the Scenarios under them, and loose statements valid in any mix", () => {
    const text = ["Rule: An Order always has a line", "  Scenario: Empty order", "    Given an Order", "A note", "Then loose"].join("\n");
    expect(lineKinds(text)).toEqual(["section", "section", "statement", "note", "statement"]);
  });

  it("treats words that merely start like keywords as notes", () => {
    expect(lineKinds("Givens are cheap\nFeature flags matter\nWhen:")).toEqual(["note", "note", "note"]);
  });
});

describe("ruleLineAt", () => {
  const text = [
    "Feature: Orders",
    "  Rule:   An Order always has a line  ",
    "    Scenario: Empty",
    "      Given an Order",
    "  Rule:",
    '    """',
    "    Rule: inside a doc string",
    '    """',
    "Rules are cheap",
  ].join("\n");
  const lineStart = (n: number) => text.split("\n").slice(0, n - 1).join("\n").length + (n > 1 ? 1 : 0);

  it("finds the rule's text after the keyword, without surrounding spaces, from any position on the line", () => {
    const start = lineStart(2);
    const expected = { line: 2, from: text.indexOf("An Order"), to: text.indexOf("An Order") + "An Order always has a line".length, text: "An Order always has a line" };
    expect(ruleLineAt(text, start)).toEqual(expected);
    expect(ruleLineAt(text, start + 4)).toEqual(expected);
    expect(ruleLineAt(text, text.indexOf("a line") + 6)).toEqual(expected);
  });

  it("reports a Rule line with nothing written yet as an empty range", () => {
    const at = lineStart(5);
    expect(ruleLineAt(text, at)).toMatchObject({ line: 5, text: "" });
  });

  it("is null on Scenario lines, statements, notes, and inside doc strings", () => {
    for (const line of [1, 3, 4, 7, 9]) expect(ruleLineAt(text, lineStart(line) + 2), `line ${line}`).toBeNull();
  });
});
