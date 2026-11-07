// BWrite's own file on real temporary folders: round trips, the layout it is written in,
// comments kept, and every validation refusal with the path inside the file it names.

import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { VocabularyDocument, VocabularyTerm } from "../application/vocabulary-document";
import { BWriteFileAdapter } from "./bwrite-file-adapter";
import { BWRITE_FILE } from "../formats/bwrite-file";
import { rejection } from "../../../../tests/support/unit/command-results";
import { removeTemporaryFolders, temporaryFolder } from "../../../../tests/support/unit/temporary-folders";

afterAll(removeTemporaryFolders);

const SHOP = `# The shop's language, kept by BWrite.
version: 1
project: shop
description: Selling things online.
terms:
  - name: Sales
    kind: bounded_context
    definition: Taking and fulfilling orders.
  # Orders are the heart of it.
  - name: Order
    kind: aggregate
    context: Sales
    identity: OrderId
    aliases: [Purchase Order]
    definition: A customer's request to buy products.
    invariants:
      - key: has-lines
        statement: An Order has at least one line.
  - name: OrderId
    kind: value_object
    context: Sales
    definition: Identifies an Order.
  - name: Gift Wrap
    status: proposed
    definition: Wrapping an item as a gift.
    proposal: { feature: Checkout, featureId: f-1, text: gift wrap, proposedAt: 2026-10-10T12:00:00.000Z }
questions:
  - context: Sales
    key: who-pays-shipping
    text: Who pays shipping on a return?
`;

describe("BWrite's file", () => {
  let folder: string;
  let adapter: BWriteFileAdapter;
  const file = () => path.join(folder, BWRITE_FILE);

  beforeEach(async () => {
    folder = temporaryFolder({ prefix: "bwrite-file-" });
    adapter = new BWriteFileAdapter(folder);
  });

  it("creates an empty document named after the folder, and leaves an existing file alone", async () => {
    expect((await adapter.load()).source).toEqual({ format: "bwrite", file: BWRITE_FILE, found: false, holdsProposals: true, holdsUnplacedTerms: true });
    const created = await adapter.create();
    expect(created.document).toEqual({ version: 1, project: path.basename(folder), terms: [] });
    expect(await readFile(file(), "utf8")).toBe(`version: 1\nproject: ${path.basename(folder)}\nterms: []\n`);
    await writeFile(file(), SHOP);
    expect((await adapter.create()).document!.project).toBe("shop");
    expect(await readFile(file(), "utf8")).toBe(SHOP);
  });

  it("reads the documented layout into the canonical document", async () => {
    await writeFile(file(), SHOP);
    const { document } = await adapter.load();
    expect(document).toEqual({
      version: 1,
      project: "shop",
      description: "Selling things online.",
      terms: [
        { name: "Sales", kind: "bounded_context", definition: "Taking and fulfilling orders." },
        { name: "Order", kind: "aggregate", context: "Sales", identity: "OrderId", aliases: ["Purchase Order"], definition: "A customer's request to buy products.", invariants: [{ key: "has-lines", statement: "An Order has at least one line." }] },
        { name: "OrderId", kind: "value_object", context: "Sales", definition: "Identifies an Order." },
        { name: "Gift Wrap", status: "proposed", definition: "Wrapping an item as a gift.", proposal: { feature: "Checkout", featureId: "f-1", text: "gift wrap", proposedAt: "2026-10-10T12:00:00.000Z" } },
      ],
      questions: [{ context: "Sales", key: "who-pays-shipping", text: "Who pays shipping on a return?" }],
    } satisfies VocabularyDocument);
  });

  it("writes a change set in the documented field order, keeping comments on what it leaves alone", async () => {
    await writeFile(file(), SHOP);
    const giftWrap: VocabularyTerm = { name: "Gift Wrap", kind: "value_object", context: "Sales", definition: "Wrapping an item as a gift." };
    const loaded = await adapter.apply([
      { type: "put-term", term: giftWrap, replaces: { name: "Gift Wrap" } },
      { type: "put-term", term: { name: "Line", kind: "entity", aggregate: "Order", definition: "One product on an Order.", aliases: ["Order Line"] } },
      { type: "put-term", term: { name: "Order", kind: "aggregate", context: "Sales", identity: "OrderId", aliases: ["Purchase Order"], definition: "A customer's request to buy products.", invariants: [{ key: "has-lines", statement: "An Order has at least one line." }], assertions: [{ key: "paid-in-full", on: "Ship", statement: "Ships once paid." }] } },
    ]);
    const text = await readFile(file(), "utf8");
    expect(text).toContain("# The shop's language, kept by BWrite.\n");
    expect(text).toContain("  # Orders are the heart of it.\n  - name: Order\n");
    expect(text).toContain("  - name: Gift Wrap\n    kind: value_object\n    context: Sales\n    definition: Wrapping an item as a gift.\n");
    expect(text).toContain("  - name: Line\n    kind: entity\n    aggregate: Order\n    aliases: [ Order Line ]\n    definition: One product on an Order.\n");
    expect(text).toMatch(/invariants:\n {6}- key: has-lines\n {8}statement: An Order has at least one line.\n {4}assertions:\n {6}- key: paid-in-full\n {8}on: Ship\n/);
    expect(text.indexOf("terms:")).toBeLessThan(text.indexOf("questions:"));
    const reread = await new BWriteFileAdapter(folder).load();
    expect(reread.document).toEqual(loaded.document);
    expect(reread.document!.terms.map((t) => t.name)).toEqual(["Sales", "Order", "OrderId", "Gift Wrap", "Line"]);
    expect(await readdir(folder)).toEqual([BWRITE_FILE]);
  });

  it("round-trips a document it wrote without changing a byte", async () => {
    await writeFile(file(), SHOP);
    await adapter.apply([{ type: "put-term", term: { name: "Refund", kind: "domain_event", context: "Sales", raisedBy: "Order", definition: "Money went back." } }]);
    const first = await readFile(file(), "utf8");
    const { document } = await adapter.load();
    await adapter.apply(document!.terms.map((term) => ({ type: "put-term" as const, term })));
    expect(await readFile(file(), "utf8")).toBe(first);
  });

  it("renames a bounded context and carries every reference along; removes an Aggregate with its Entities", async () => {
    await writeFile(file(), SHOP);
    await adapter.apply([
      { type: "put-term", term: { name: "Line", kind: "entity", aggregate: "Order", definition: "One line." } },
      { type: "put-term", term: { name: "Selling", kind: "bounded_context", definition: "Taking and fulfilling orders." }, replaces: { name: "Sales" } },
    ]);
    let { document } = await adapter.load();
    expect(document!.terms.filter((t) => t.context !== undefined).every((t) => t.context === "Selling")).toBe(true);
    expect(document!.questions![0].context).toBe("Selling");
    await adapter.apply([{ type: "remove-term", term: { name: "Order", context: "Selling" } }]);
    ({ document } = await adapter.load());
    expect(document!.terms.map((t) => t.name)).toEqual(["Selling", "OrderId", "Gift Wrap"]);
  });

  it("plans plain descriptions without writing", async () => {
    await writeFile(file(), SHOP);
    const steps = await adapter.plan([
      { type: "put-term", term: { name: "Order", kind: "aggregate", context: "Sales", identity: "OrderId", definition: "A request to buy." } },
      { type: "remove-term", term: { name: "Gift Wrap" } },
    ]);
    expect(steps).toEqual([
      { description: "Change the aliases, definition, invariants of Aggregate Order in Sales." },
      { description: "Remove unclassified term Gift Wrap." },
      { description: `Write ${BWRITE_FILE}.` },
    ]);
    expect(await readFile(file(), "utf8")).toBe(SHOP);
  });

  it("refuses a change set that would leave the file invalid", async () => {
    await writeFile(file(), SHOP);
    const refusal = await rejection(adapter.apply([{ type: "remove-term", term: { name: "OrderId", context: "Sales" } }]));
    expect(refusal.problem).toBe("invalid-request");
    expect(refusal.message).toContain("terms[1].identity: names no Value Object called OrderId");
    expect(await readFile(file(), "utf8")).toBe(SHOP);
  });

  const INVALID: [string, string, string][] = [
    ["version 1", SHOP.replace("version: 1", "version: 2"), "version: must be 1"],
    ["known fields only, at the top", `${SHOP}owner: me\n`, "document.owner: is not a field BWrite knows"],
    ["known fields only, on a term", SHOP.replace("    identity: OrderId\n", "    identity: OrderId\n    colour: red\n"), "terms[1].colour: is not a field BWrite knows"],
    ["kinds from TERM_KINDS", SHOP.replace("kind: value_object", "kind: money"), "terms[2].kind: must be one of bounded_context, aggregate"],
    ["a proposal on a proposed term", SHOP.replace(/ {4}proposal: .*\n/, ""), "terms[3].proposal: is required on a proposed term"],
    ["no proposal on an accepted term", SHOP.replace("    status: proposed\n", ""), "terms[3].proposal: belongs only on a proposed term"],
    ["invariants only on Aggregates and Value Objects", SHOP.replace("    definition: Taking and fulfilling orders.\n", "    definition: Taking and fulfilling orders.\n    invariants: []\n"), "terms[0].invariants: only an Aggregate or a Value Object holds invariants"],
    ["assertions only on Aggregates and Domain Services", SHOP.replace("    definition: Identifies an Order.\n", "    definition: Identifies an Order.\n    assertions: []\n"), "terms[2].assertions: only an Aggregate or a Domain Service holds assertions"],
    ["unique names per bounded context", SHOP.replace("questions:\n", "  - name: \" order \"\n    kind: value_object\n    context: Sales\n    definition: Twice.\nquestions:\n"), "terms[4].name: repeats  order , already terms[1] in Sales"],
    ["contexts that exist", SHOP.replace("    context: Sales\n    identity", "    context: Billing\n    identity"), "terms[1].context: names no bounded context"],
    ["identities that exist", SHOP.replace("identity: OrderId", "identity: OrderNumber"), "terms[1].identity: names no Value Object called OrderNumber"],
    ["questions in existing contexts", SHOP.replace("  - context: Sales\n    key", "  - context: Billing\n    key"), "questions[0].context: names no bounded context"],
    ["relations between existing contexts", `${SHOP}relations:\n  - from: Sales\n    to: Billing\n    kind: conformist\n`, "relations[0].to: names no bounded context"],
    ["YAML syntax", `${SHOP}terms: [\n`, BWRITE_FILE],
  ];

  for (const [rule, text, message] of INVALID) {
    it(`refuses a file that breaks: ${rule}`, async () => {
      await writeFile(file(), text);
      const refusal = await rejection(adapter.load());
      expect(refusal.problem).toBe("file-invalid");
      expect(refusal.message).toContain(message);
    });
  }
});
