// The arclint adapter against the installed arclint, on real temporary repositories. Every
// assertion about a change reads domain.arclint.yaml back from disk.

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { TermKey, VocabularyChange, VocabularyTerm } from "../application/vocabulary-document";
import type { VocabularyFileAdapter } from "../application/vocabulary-file-adapter";
import { ArclintFileAdapter } from "./arclint-file-adapter";
import { adapterFor } from "./vocabulary-file-detection";
import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { parse } from "yaml";
import { REPO_ROOT } from "../../../../tests/support/unit/arclint-listing";
import { rejection } from "../../../../tests/support/unit/command-results";
import { removeTemporaryFolders, temporaryFolder } from "../../../../tests/support/unit/temporary-folders";

const run = promisify(execFile);

function arclint(cwd: string, ...argv: string[]): Promise<{ stdout: string; stderr: string }> {
  return run("arclint", argv, { cwd });
}

/** A folder set up for arclint the way a new project is: a minimal rules file, then `arclint domain init`. */
async function arclintRepo(): Promise<string> {
  const folder = temporaryFolder({ prefix: "bwrite-arclint-" });
  await writeFile(path.join(folder, "rules.arclint.yaml"), 'runtime: [ts]\nzones:\n  source: "src/**"\nrules: {}\n');
  await arclint(folder, "domain", "init");
  return folder;
}

/** domain.arclint.yaml as it is on disk, parsed. */
async function domainOnDisk(folder: string): Promise<DomainYaml> {
  return parse(await readFile(path.join(folder, "domain.arclint.yaml"), "utf8")) as DomainYaml;
}

interface DomainYaml {
  project: string;
  description?: string;
  contexts?: Record<string, ContextYaml>;
  relations?: { from: string; to: string; kind: string }[];
}

interface ContextYaml {
  definition: string;
  aggregates?: Record<string, { definition: string; identity: string; aliases?: string[]; entities?: Record<string, { definition: string; identity?: string; aliases?: string[] }>; invariants?: Record<string, string>; assertions?: Record<string, { on: string; statement: string }>; repository?: string; factory?: string }>;
  value_objects?: Record<string, { definition: string; aliases?: string[]; invariants?: Record<string, string> }>;
  events?: Record<string, { definition: string; raised_by?: string }>;
  services?: Record<string, { definition: string; assertions?: Record<string, { on: string; statement: string }> }>;
  specifications?: Record<string, { definition: string }>;
  questions?: Record<string, string>;
}

afterAll(removeTemporaryFolders);

const sales = (term: Omit<VocabularyTerm, "context">): VocabularyTerm => ({ ...term, context: "sales" });
const put = (term: VocabularyTerm, replaces?: TermKey): VocabularyChange =>
  replaces ? { type: "put-term", term, replaces } : { type: "put-term", term };

const ORDER: VocabularyTerm = sales({
  name: "Order",
  kind: "aggregate",
  identity: "OrderId",
  aliases: ["Purchase Order"],
  definition: "A customer's request to buy products.",
  invariants: [{ key: "has-lines", statement: "An Order has at least one line." }],
  assertions: [{ key: "paid-in-full", on: "Ship", statement: "An Order ships only once paid." }],
});

describe("reading", () => {
  it("loads this repository's own domain exactly as arclint lists it", async () => {
    const adapter = await adapterFor(REPO_ROOT);
    expect(adapter.format).toBe("arclint");
    const { source, document } = await adapter.load();
    expect(source).toEqual({ format: "arclint", file: "domain.arclint.yaml", found: true, holdsProposals: false, holdsUnplacedTerms: false });
    const listed = JSON.parse((await arclint(REPO_ROOT, "domain", "list", "--format", "json")).stdout);
    const context = listed.contexts[0];
    expect(document!.project).toBe(listed.project);
    expect(document!.description).toMatch(/^BWrite is where a product team/);
    const names = (kind: string) => document!.terms.filter((t) => t.kind === kind).map((t) => t.name);
    expect(names("bounded_context")).toEqual(listed.contexts.map((c: { name: string }) => c.name));
    expect(names("aggregate")).toEqual(context.aggregates.map((a: { name: string }) => a.name));
    expect(names("value_object")).toEqual(context.valueObjects.map((v: { name: string }) => v.name));
    expect(names("entity")).toEqual(context.aggregates.flatMap((a: { entities?: { name: string }[] }) => (a.entities ?? []).map((e) => e.name)));
    for (const aggregate of context.aggregates) {
      const term = document!.terms.find((t) => t.kind === "aggregate" && t.name === aggregate.name)!;
      expect(term.context).toBe(context.name);
      expect(term.identity).toBe(aggregate.identity);
      expect(term.definition).toBe(aggregate.definition);
      expect(term.aliases ?? []).toEqual(aggregate.aliases ?? []);
      expect(term.invariants ?? []).toEqual(aggregate.invariants ?? []);
      expect(term.assertions ?? []).toEqual(aggregate.assertions ?? []);
    }
    const domainTerm = document!.terms.find((t) => t.name === "DomainTerm")!;
    expect(domainTerm).toMatchObject({ kind: "entity", aggregate: "UbiquitousLanguage", identity: "TermId" });
    expect(domainTerm.context).toBeUndefined();
  });

  it("answers the rules arclint lists for the folder", async () => {
    const listed = JSON.parse((await arclint(REPO_ROOT, "rules", "--format", "json")).stdout);
    expect(listed.length).toBeGreaterThan(0);
    expect(await (await adapterFor(REPO_ROOT)).rules()).toEqual(listed);
  });

  it("maps every concept arclint records, relations and questions included", async () => {
    const folder = await arclintRepo();
    const define = (...argv: string[]) => arclint(folder, "domain", "define", ...argv);
    await define("bounded_context", "sales", "--definition", "Selling things.");
    await define("bounded_context", "shipping", "--definition", "Moving things.");
    await define("aggregate", "Order", "--context", "sales", "--definition", "A request.", "--identity", "OrderId", "--alias", "PO", "--repository", "Orders");
    await define("entity", "OrderLine", "--context", "sales", "--owner", "Order", "--definition", "One line.", "--identity", "LineId");
    await define("value_object", "OrderId", "--context", "sales", "--definition", "Identifies an Order.");
    await define("value_object", "Money", "--context", "sales", "--definition", "An amount.");
    await define("invariant", "never-negative", "--context", "sales", "--owner", "Money", "--statement", "Never negative.");
    await define("domain_event", "OrderShipped", "--context", "sales", "--raised-by", "Order", "--definition", "Left.");
    await define("domain_service", "Pricing", "--context", "sales", "--definition", "Prices.");
    await define("assertion", "priced-once", "--context", "sales", "--owner", "Pricing", "--on", "Price", "--statement", "Priced once.");
    await define("specification", "BigOrder", "--context", "sales", "--definition", "Big.");
    await define("question", "resale", "--context", "sales", "--text", "Resold?");
    const { writeFile, readFile } = await import("node:fs/promises");
    const file = `${folder}/domain.arclint.yaml`;
    await writeFile(file, `${await readFile(file, "utf8")}relations:\n  - from: sales\n    to: shipping\n    kind: customer_supplier\n    description: Orders to ship.\n`);

    const { document } = await (await adapterFor(folder)).load();
    expect(document!.terms).toEqual([
      { name: "sales", kind: "bounded_context", definition: "Selling things." },
      { name: "Order", kind: "aggregate", definition: "A request.", context: "sales", aliases: ["PO"], identity: "OrderId" },
      { name: "OrderLine", kind: "entity", definition: "One line.", aggregate: "Order", identity: "LineId" },
      { name: "OrderId", kind: "value_object", definition: "Identifies an Order.", context: "sales" },
      { name: "Money", kind: "value_object", definition: "An amount.", context: "sales", invariants: [{ key: "never-negative", statement: "Never negative." }] },
      { name: "OrderShipped", kind: "domain_event", definition: "Left.", context: "sales", raisedBy: "Order" },
      { name: "Pricing", kind: "domain_service", definition: "Prices.", context: "sales", assertions: [{ key: "priced-once", on: "Price", statement: "Priced once." }] },
      { name: "BigOrder", kind: "specification", definition: "Big.", context: "sales" },
      { name: "shipping", kind: "bounded_context", definition: "Moving things." },
    ]);
    expect(document!.questions).toEqual([{ context: "sales", key: "resale", text: "Resold?" }]);
    expect(document!.relations).toEqual([{ from: "sales", to: "shipping", kind: "customer_supplier", description: "Orders to ship." }]);
  });

  it("answers a folder without domain.arclint.yaml as not found, and create runs arclint domain init", async () => {
    const folder = await arclintRepo();
    const { rm } = await import("node:fs/promises");
    await rm(`${folder}/domain.arclint.yaml`);
    const adapter = await adapterFor(folder);
    expect((await adapter.load()).source.found).toBe(false);
    expect((await adapter.load()).document).toBeNull();
    const created = await adapter.create();
    expect(created.source.found).toBe(true);
    expect(created.document).toMatchObject({ version: 1, terms: [] });
    expect((await domainOnDisk(folder)).project).toBe(folder.split("/").pop());
  });
});

describe("changes", () => {
  let folder: string;
  let adapter: VocabularyFileAdapter;

  beforeEach(async () => {
    folder = await arclintRepo();
    adapter = await adapterFor(folder);
    await adapter.apply([
      put({ name: "sales", kind: "bounded_context", definition: "Selling things." }),
      put({ name: "shipping", kind: "bounded_context", definition: "Moving things." }),
      put(sales({ name: "OrderId", kind: "value_object", definition: "Identifies an Order." })),
      put(ORDER),
      { type: "put-term", term: { name: "OrderLine", kind: "entity", aggregate: "Order", identity: "LineId", definition: "One product on an Order." } },
      put(sales({ name: "Money", kind: "value_object", definition: "An amount.", invariants: [{ key: "never-negative", statement: "Money is never negative." }] })),
      put(sales({ name: "OrderShipped", kind: "domain_event", raisedBy: "Order", definition: "The Order left." })),
      put(sales({ name: "Pricing", kind: "domain_service", definition: "Prices things.", assertions: [{ key: "priced-once", on: "Price", statement: "Priced once." }] })),
      put(sales({ name: "BigOrder", kind: "specification", definition: "A big order." })),
    ]);
  });

  it("creates every kind with its rules", async () => {
    const sales = (await domainOnDisk(folder)).contexts!.sales;
    expect(sales.aggregates!.Order).toMatchObject({
      definition: "A customer's request to buy products.",
      identity: "OrderId",
      aliases: ["Purchase Order"],
      invariants: { "has-lines": "An Order has at least one line." },
      assertions: { "paid-in-full": { on: "Ship", statement: "An Order ships only once paid." } },
      entities: { OrderLine: { definition: "One product on an Order.", identity: "LineId" } },
    });
    expect(sales.value_objects!.Money.invariants).toEqual({ "never-negative": "Money is never negative." });
    expect(sales.events!.OrderShipped.raised_by).toBe("Order");
    expect(sales.services!.Pricing.assertions).toEqual({ "priced-once": { on: "Price", statement: "Priced once." } });
    expect(sales.specifications!.BigOrder.definition).toBe("A big order.");
  });

  it("plans the exact argv, one define per term and one per rule", async () => {
    const steps = await adapter.plan([put(sales({ name: "Discount", kind: "value_object", aliases: ["Rebate"], definition: "Money off.", invariants: [{ key: "below-price", statement: "Below the price." }] }))]);
    expect(steps.map((s) => s.command)).toEqual([
      ["domain", "define", "value_object", "Discount", "--context", "sales", "--definition", "Money off.", "--alias", "Rebate"],
      ["domain", "define", "invariant", "below-price", "--context", "sales", "--owner", "Discount", "--statement", "Below the price."],
    ]);
    expect((await domainOnDisk(folder)).contexts!.sales.value_objects!.Discount).toBeUndefined();
  });

  it("changes a definition, and only the definition", async () => {
    const steps = await adapter.plan([put({ ...ORDER, definition: "A request to buy." })]);
    expect(steps.map((s) => s.command)).toEqual([["domain", "define", "aggregate", "Order", "--context", "sales", "--definition", "A request to buy."]]);
    await adapter.apply([put({ ...ORDER, definition: "A request to buy." })]);
    expect((await domainOnDisk(folder)).contexts!.sales.aggregates!.Order).toMatchObject({ definition: "A request to buy.", aliases: ["Purchase Order"], identity: "OrderId" });
  });

  it("replaces aliases with repeated --alias and clears them with --clear-aliases", async () => {
    await adapter.apply([put({ ...ORDER, aliases: ["PO", "Purchase"] })]);
    expect((await domainOnDisk(folder)).contexts!.sales.aggregates!.Order.aliases).toEqual(["PO", "Purchase"]);
    const cleared = { ...ORDER };
    delete cleared.aliases;
    expect((await adapter.plan([put(cleared)]))[0].command).toEqual(["domain", "define", "aggregate", "Order", "--context", "sales", "--clear-aliases"]);
    await adapter.apply([put(cleared)]);
    expect((await domainOnDisk(folder)).contexts!.sales.aggregates!.Order.aliases).toBeUndefined();
  });

  it("changes an identity, an Entity's owner, and what raises an event", async () => {
    await adapter.apply([
      put(sales({ name: "Cart", kind: "aggregate", identity: "CartId", definition: "Items not yet ordered." })),
      put({ ...ORDER, identity: "OrderNumber" }),
      { type: "put-term", term: { name: "OrderLine", kind: "entity", aggregate: "Cart", identity: "LineId", definition: "One product on an Order." } },
      put(sales({ name: "OrderShipped", kind: "domain_event", raisedBy: "Cart", definition: "The Order left." })),
    ]);
    let sales_ = (await domainOnDisk(folder)).contexts!.sales;
    expect(sales_.aggregates!.Order.identity).toBe("OrderNumber");
    expect(sales_.aggregates!.Order.entities).toBeUndefined();
    expect(sales_.aggregates!.Cart.entities!.OrderLine).toEqual({ definition: "One product on an Order.", identity: "LineId" });
    expect(sales_.events!.OrderShipped.raised_by).toBe("Cart");

    const steps = await adapter.plan([put(sales({ name: "OrderShipped", kind: "domain_event", definition: "The Order left." }))]);
    expect(steps[0].command).toEqual(["domain", "define", "domain_event", "OrderShipped", "--context", "sales", "--raised-by", ""]);
    await adapter.apply([put(sales({ name: "OrderShipped", kind: "domain_event", definition: "The Order left." }))]);
    sales_ = (await domainOnDisk(folder)).contexts!.sales;
    expect(sales_.events!.OrderShipped.raised_by).toBeUndefined();
  });

  it("adds, changes, and removes invariants and assertions", async () => {
    const next: VocabularyTerm = {
      ...ORDER,
      invariants: [{ key: "has-lines", statement: "An Order always has a line." }, { key: "one-currency", statement: "One currency per Order." }],
      assertions: [{ key: "paid-in-full", on: "Dispatch", statement: "An Order ships only once paid." }],
    };
    await adapter.apply([put(next)]);
    let order = (await domainOnDisk(folder)).contexts!.sales.aggregates!.Order;
    expect(order.invariants).toEqual({ "has-lines": "An Order always has a line.", "one-currency": "One currency per Order." });
    expect(order.assertions).toEqual({ "paid-in-full": { on: "Dispatch", statement: "An Order ships only once paid." } });

    const fewer = { ...next, invariants: [{ key: "one-currency", statement: "One currency per Order." }] };
    delete (fewer as VocabularyTerm).assertions;
    const steps = await adapter.plan([put(fewer)]);
    expect(steps.map((s) => s.command)).toEqual([
      ["domain", "remove", "invariant", "has-lines", "--context", "sales", "--owner", "Order"],
      ["domain", "remove", "assertion", "paid-in-full", "--context", "sales", "--owner", "Order"],
    ]);
    await adapter.apply([put(fewer)]);
    order = (await domainOnDisk(folder)).contexts!.sales.aggregates!.Order;
    expect(order.invariants).toEqual({ "one-currency": "One currency per Order." });
    expect(order.assertions).toBeUndefined();
    await adapter.apply([put(sales({ name: "Money", kind: "value_object", definition: "An amount." }))]);
    expect((await domainOnDisk(folder)).contexts!.sales.value_objects!.Money.invariants).toBeUndefined();
  });

  it("changes a kind by removing the term, then defining it", async () => {
    const steps = await adapter.plan([put(sales({ name: "BigOrder", kind: "value_object", definition: "A big order." }), { name: "BigOrder", context: "sales" })]);
    expect(steps.map((s) => s.command)).toEqual([
      ["domain", "remove", "specification", "BigOrder", "--context", "sales"],
      ["domain", "define", "value_object", "BigOrder", "--context", "sales", "--definition", "A big order."],
    ]);
    await adapter.apply([put(sales({ name: "BigOrder", kind: "value_object", definition: "A big order." }), { name: "BigOrder", context: "sales" })]);
    const sales_ = (await domainOnDisk(folder)).contexts!.sales;
    expect(sales_.specifications).toBeUndefined();
    expect(sales_.value_objects!.BigOrder.definition).toBe("A big order.");
  });

  it("moves an Aggregate to another bounded context with its Entities and rules", async () => {
    await adapter.apply([put({ ...ORDER, context: "shipping" }, { name: "Order", context: "sales" })]);
    const domain = await domainOnDisk(folder);
    expect(domain.contexts!.sales.aggregates).toBeUndefined();
    expect(domain.contexts!.sales.events!.OrderShipped.raised_by).toBeUndefined();
    expect(domain.contexts!.shipping.aggregates!.Order).toMatchObject({
      identity: "OrderId",
      invariants: { "has-lines": "An Order has at least one line." },
      entities: { OrderLine: { definition: "One product on an Order.", identity: "LineId" } },
    });
  });

  it("renames an Aggregate, keeping its Entities, its repository, and the events it raises", async () => {
    await arclint(folder, "domain", "define", "aggregate", "Order", "--context", "sales", "--repository", "OrderRepository");
    adapter = await adapterFor(folder);
    await adapter.apply([put({ ...ORDER, name: "Purchase", aliases: [] }, { name: "Order", context: "sales" })]);
    const sales_ = (await domainOnDisk(folder)).contexts!.sales;
    expect(sales_.aggregates!.Order).toBeUndefined();
    expect(sales_.aggregates!.Purchase).toMatchObject({ identity: "OrderId", repository: "OrderRepository", entities: { OrderLine: { identity: "LineId" } } });
    expect(sales_.events!.OrderShipped.raised_by).toBe("Purchase");
  });

  it("renames a Value Object and the identities that name it", async () => {
    await adapter.apply([put(sales({ name: "OrderNumber", kind: "value_object", definition: "Identifies an Order." }), { name: "OrderId", context: "sales" })]);
    const sales_ = (await domainOnDisk(folder)).contexts!.sales;
    expect(sales_.value_objects!.OrderId).toBeUndefined();
    expect(sales_.value_objects!.OrderNumber.definition).toBe("Identifies an Order.");
    expect(sales_.aggregates!.Order.identity).toBe("OrderNumber");
  });

  it("renames a bounded context by recording everything in it under the new name", async () => {
    await arclint(folder, "domain", "define", "question", "resale", "--context", "sales", "--text", "Can an Order be resold?");
    adapter = await adapterFor(folder);
    const before = (await domainOnDisk(folder)).contexts!.sales;
    await adapter.apply([put({ name: "selling", kind: "bounded_context", definition: "Selling things." }, { name: "sales" })]);
    const domain = await domainOnDisk(folder);
    expect(domain.contexts!.sales).toBeUndefined();
    expect(domain.contexts!.selling).toEqual(before);
  });

  it("removes a term, and an Aggregate's Entities with it", async () => {
    expect((await adapter.plan([{ type: "remove-term", term: { name: "Order", context: "sales" } }]))[0].command).toEqual(["domain", "remove", "aggregate", "Order", "--context", "sales"]);
    await adapter.apply([{ type: "remove-term", term: { name: "Order", context: "sales" } }]);
    const sales_ = (await domainOnDisk(folder)).contexts!.sales;
    expect(sales_.aggregates).toBeUndefined();
    await adapter.apply([{ type: "remove-term", term: { name: "shipping" } }]);
    expect((await domainOnDisk(folder)).contexts!.shipping).toBeUndefined();
  });

  it("refuses proposed and unplaced terms as format-cannot-hold", async () => {
    const proposed = await rejection(
      adapter.plan([put(sales({ name: "Gift Wrap", kind: "value_object", definition: "Wrapping.", status: "proposed", proposal: { feature: "Checkout", featureId: "f-1", text: "gift wrap", proposedAt: "2026-10-10T12:00:00.000Z" } }))]),
    );
    expect(proposed.problem).toBe("format-cannot-hold");
    expect((await rejection(adapter.plan([put({ name: "Loose", definition: "Unclassified." })]))).problem).toBe("format-cannot-hold");
    expect((await rejection(adapter.plan([put({ name: "Floating", kind: "value_object", definition: "No context." })]))).problem).toBe("format-cannot-hold");
  });

  it("refuses any value that starts with - before running anything", async () => {
    const before = await domainOnDisk(folder);
    for (const term of [
      sales({ name: "--help", kind: "value_object", definition: "x" }),
      sales({ name: "Fine", kind: "value_object", definition: "--context=shipping" }),
      sales({ name: "Fine", kind: "value_object", definition: "x", aliases: ["-v"] }),
    ]) {
      const refusal = await rejection(adapter.apply([put(term)]));
      expect(refusal.problem).toBe("invalid-request");
      expect(refusal.message).toMatch(/starts with "-"/);
    }
    expect(await domainOnDisk(folder)).toEqual(before);
  });

  it("reports which steps ran when a later step fails", async () => {
    const refusal = await rejection(
      adapter.apply([
        put(sales({ name: "Coupon", kind: "value_object", definition: "A code for money off." })),
        put(sales({ name: "Basket", kind: "aggregate", identity: "BasketId", definition: "Items.", invariants: [{ key: "Not A Key", statement: "Keys are kebab-case." }] })),
      ]),
    );
    expect(refusal.problem).toBe("arclint-failed");
    expect(refusal.message).toMatch(/^Step 3 of 3, arclint domain define invariant Not A Key/);
    expect(refusal.message).toMatch(/Steps 1 to 2 ran and stay recorded/);
    const sales_ = (await domainOnDisk(folder)).contexts!.sales;
    expect(sales_.value_objects!.Coupon).toBeDefined();
    expect(sales_.aggregates!.Basket).toBeDefined();
  });

  it("answers arclint-missing when arclint is not installed", async () => {
    const missing = new ArclintFileAdapter(folder, folder, { command: "arclint-not-installed-anywhere" });
    expect((await rejection(missing.load())).problem).toBe("arclint-missing");
  });
});
