import { describe, expect, it } from "vitest";
import { placedRuleOf, placedRuleProblems, ruleKeyFrom, ruleLabel } from "./placed-rule";
import { RefusalError } from "./refusal";

describe("rule keys", () => {
  it("are derived from the rule's first words in kebab case, without a leading article", () => {
    expect(ruleKeyFrom("An Order always has at least one line")).toBe("order-always-has-at-least-one-line");
    expect(ruleKeyFrom("The total is never negative!")).toBe("total-is-never-negative");
    expect(ruleKeyFrom("Names are unique, ignoring case and spacing in every language")).toBe(
      "names-are-unique-ignoring-case-and-spacing-in",
    );
    expect(ruleKeyFrom("Café prices stay in €")).toBe("cafe-prices-stay-in");
    expect(ruleKeyFrom("A")).toBe("a");
    expect(ruleKeyFrom("  ")).toBe("");
  });
});

describe("the PlacedRule door", () => {
  it("builds an invariant without an operation, and an assertion naming its operation", () => {
    expect(placedRuleOf({ kind: "invariant", key: " has-lines ", statement: " An Order has lines. ", operation: "Place" })).toEqual({
      kind: "invariant",
      key: "has-lines",
      statement: "An Order has lines.",
      operation: null,
    });
    expect(placedRuleOf({ kind: "assertion", key: "needs-lines", statement: "Placing needs lines.", operation: "  Place  Order " })).toEqual({
      kind: "assertion",
      key: "needs-lines",
      statement: "Placing needs lines.",
      operation: "Place Order",
    });
  });

  it("refuses an empty statement (has-a-statement)", () => {
    expect(() => placedRuleOf({ kind: "invariant", key: "x", statement: "  ", operation: "" })).toThrow("Enter the rule's statement.");
  });

  it("refuses an assertion without its operation (assertion-names-its-operation)", () => {
    expect(() => placedRuleOf({ kind: "assertion", key: "x", statement: "S.", operation: " " })).toThrow(
      "Name the operation this assertion is on.",
    );
    expect(() => placedRuleOf({ kind: "assertion", key: "x", statement: "S.", operation: "--" })).toThrow(RefusalError);
  });

  it("reports every problem by field, in plain words", () => {
    expect(placedRuleProblems({ kind: "assertion", key: "Has Lines", statement: "", operation: "" })).toEqual({
      key: "Write the key in lowercase words joined by hyphens, such as order-has-lines.",
      statement: "Enter the rule's statement.",
      operation: "Name the operation this assertion is on.",
    });
    expect(placedRuleProblems({ kind: "invariant", key: "", statement: "S.", operation: "" })).toEqual({ key: "Enter a key." });
    expect(placedRuleProblems({ kind: "invariant", key: "has-lines", statement: "S.", operation: "" })).toEqual({});
  });

  it("reads as invariant or assertion on its operation", () => {
    expect(ruleLabel(placedRuleOf({ kind: "invariant", key: "x", statement: "S.", operation: "" }))).toBe("invariant");
    expect(ruleLabel(placedRuleOf({ kind: "assertion", key: "x", statement: "S.", operation: "Place" }))).toBe("assertion on Place");
  });
});
