import { describe, expect, it } from "vitest";
import { ARCLINT_CONCEPTS } from "./arclint-concepts";
import { CONCEPTS_NOT_TERM_KINDS, KIND_LEVELS, TERM_KINDS, kindTitle, type TermKind } from "./term-kind";
import { RELATIONS, classificationOf, sameClassification, withKind, withRelation } from "./classification";
import { RefusalError } from "./refusal";
import { readFileSync } from "node:fs";
import { id } from "../../../../tests/support/unit/language-builders";

/** `arclint domain schema` as recorded beside the acceptance suites. */
const schema = JSON.parse(readFileSync(new URL("../../../../tests/fixtures/arclint/domainSchema.json", import.meta.url), "utf8"));

type SchemaDef = { required?: string[]; properties: Record<string, { $ref?: string; additionalProperties?: { $ref?: string } }> };
const defs = schema.$defs as unknown as Record<string, SchemaDef>;

/** The $def ArcLint's schema records each kind with. */
const DEF_OF: Record<TermKind, string> = {
  bounded_context: "context",
  aggregate: "aggregate",
  entity: "entity",
  value_object: "value_object",
  domain_event: "event",
  domain_service: "service",
  specification: "specification",
};
const KIND_OF_DEF = Object.fromEntries(Object.entries(DEF_OF).map(([k, d]) => [d, k as TermKind]));

/** The kinds a $def holds as named members, read from the schema's `additionalProperties.$ref`s. */
function nestedKinds(def: string): TermKind[] {
  return Object.values(defs[def].properties)
    .map((p) => p.additionalProperties?.$ref?.replace("#/$defs/", ""))
    .filter((d): d is string => d !== undefined && d in KIND_OF_DEF)
    .map((d) => KIND_OF_DEF[d]);
}

describe("term kinds follow ArcLint's vocabulary", () => {
  it("are ArcLint concept types, and every other concept is excluded with a reason", () => {
    const types = ARCLINT_CONCEPTS.map((c) => c.type).sort();
    expect([...TERM_KINDS, ...Object.keys(CONCEPTS_NOT_TERM_KINDS)].sort()).toEqual(types);
    expect(TERM_KINDS.filter((k) => k in CONCEPTS_NOT_TERM_KINDS)).toEqual([]);
  });

  it("use ArcLint's titles", () => {
    for (const kind of TERM_KINDS) {
      expect(kindTitle(kind)).toBe(ARCLINT_CONCEPTS.find((c) => c.type === kind)!.title);
    }
  });

  it("are each recorded somewhere in ArcLint's domain schema", () => {
    expect(schema.properties.contexts.additionalProperties.$ref).toBe(`#/$defs/${DEF_OF.bounded_context}`);
    for (const kind of TERM_KINDS) expect(defs[DEF_OF[kind]], kind).toBeDefined();
  });

  it("are grouped by the level the schema nests them at", () => {
    expect(KIND_LEVELS.flatMap((l) => l.kinds).sort()).toEqual([...TERM_KINDS].sort());
    expect(KIND_LEVELS[1].kinds).toEqual(nestedKinds("context"));
    expect(KIND_LEVELS[2].kinds).toEqual(nestedKinds("aggregate"));
  });

  it("explain the Aggregate as the aggregate and its root entity together", () => {
    expect(CONCEPTS_NOT_TERM_KINDS.aggregate_root).toMatch(/stands for the aggregate and its root entity together/);
  });
});

describe("relations follow ArcLint's schema, all optional", () => {
  const relationsOf = (kind: TermKind) => Object.fromEntries(RELATIONS[kind].map((r) => [r.relation, r]));

  it("places what a bounded context holds in an optional bounded context, and an Entity under its Aggregate", () => {
    for (const kind of nestedKinds("context")) {
      expect(relationsOf(kind).context, kind).toMatchObject({ target: "bounded_context" });
    }
    for (const kind of nestedKinds("aggregate")) {
      expect(relationsOf(kind).aggregate, kind).toMatchObject({ target: "aggregate" });
      // An Entity is in its Aggregate's bounded context, never one chosen on its own.
      expect(relationsOf(kind).context, kind).toBeUndefined();
    }
    expect(RELATIONS.bounded_context).toEqual([]);
  });

  it("records the term references the schema defines, and no others", () => {
    // Properties naming another term of the context. `repository` and `factory` name code types, not terms.
    const references: [TermKind, string, string, TermKind][] = [
      ["aggregate", "identity", "identity", "value_object"],
      ["entity", "identity", "identity", "value_object"],
      ["domain_event", "raised_by", "raisedBy", "aggregate"],
    ];
    for (const [kind, property, relation, target] of references) {
      expect(defs[DEF_OF[kind]].properties[property], `${kind}.${property}`).toBeDefined();
      expect(relationsOf(kind)[relation]).toMatchObject({ target });
    }
    const declared = TERM_KINDS.flatMap((k) =>
      RELATIONS[k].filter((r) => r.relation !== "context" && r.relation !== "aggregate").map((r) => `${k}.${r.relation}`),
    );
    expect(declared.sort()).toEqual(references.map(([k, , r]) => `${k}.${r}`).sort());
  });
});

describe("the Classification door (placement-fits-the-kind)", () => {
  it("holds exactly the relations its kind takes, each null until chosen", () => {
    expect(classificationOf("aggregate")).toEqual({ kind: "aggregate", context: null, identity: null });
    expect(classificationOf("entity", { aggregate: id("order") })).toEqual({ kind: "entity", aggregate: "order", identity: null });
    expect(classificationOf("bounded_context")).toEqual({ kind: "bounded_context" });
  });

  it("refuses a relation the kind does not take", () => {
    expect(() => classificationOf("value_object", { identity: id("x") })).toThrow(RefusalError);
    expect(() => classificationOf("entity", { context: null })).toThrow("Entity takes no relation “context”.");
    expect(() => classificationOf("bounded_context", { context: id("x") })).toThrow(RefusalError);
  });

  it("keeps the bounded context when the kind changes to one that takes it, and nothing else", () => {
    const aggregate = classificationOf("aggregate", { context: id("sales"), identity: id("number") });
    expect(withKind(aggregate, "value_object")).toEqual({ kind: "value_object", context: "sales" });
    expect(withKind(aggregate, "entity")).toEqual({ kind: "entity", aggregate: null, identity: null });
    expect(withKind(aggregate, "bounded_context")).toEqual({ kind: "bounded_context" });
    expect(withKind(aggregate, null)).toBeNull();
    expect(withKind(aggregate, "aggregate")).toBe(aggregate);
  });

  it("sets one relation through the door", () => {
    const aggregate = classificationOf("aggregate");
    expect(withRelation(aggregate, "identity", id("number"))).toEqual({ kind: "aggregate", context: null, identity: "number" });
    expect(() => withRelation(aggregate, "raisedBy", id("x"))).toThrow(RefusalError);
  });

  it("compares by kind and relations", () => {
    expect(sameClassification(classificationOf("aggregate"), classificationOf("aggregate", { identity: null }))).toBe(true);
    expect(sameClassification(classificationOf("aggregate"), classificationOf("aggregate", { identity: id("x") }))).toBe(false);
    expect(sameClassification(null, null)).toBe(true);
    expect(sameClassification(classificationOf("entity"), null)).toBe(false);
  });
});
