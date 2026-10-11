// arclint's format: domain.arclint.yaml, read and changed only by running arclint. Reading maps
// `arclint domain overview --format json` (the listing `domain list` gives, plus the project's
// description) onto the canonical VocabularyDocument; changes become `arclint domain define`
// and `arclint domain remove` commands, found by comparing each put-term with the file as the
// earlier commands of the same change set leave it.

import { execFile } from "node:child_process";
import path from "node:path";
import type { TermKind } from "../domain/term-kind";
import { kindTitle } from "../domain/term-kind";
import type { ArcLintRule, PlannedStep, VocabularyChange, VocabularyDocument, VocabularyRule, VocabularyTerm, VocabularyAssertion } from "../application/vocabulary-document";
import { ProblemError, refuse } from "../application/problem";
import { findAggregate, findTerm, sameName, termKeyOf } from "../application/vocabulary-shape";
import type { LoadedFile, VocabularyFileAdapter } from "../application/vocabulary-file-adapter";
import { applyChange, changedFields, cloneDocument, describeKey, describeTerm } from "../application/change-set";
import { documentFromArclint, extrasKey, type AggregateExtras, type ArclintDomain } from "../formats/arclint-domain";

export const ARCLINT_RULES_FILE = "rules.arclint.yaml";
export const ARCLINT_DOMAIN_FILE = "domain.arclint.yaml";

export interface ArclintOptions {
  /** The arclint executable, found on PATH unless a path is given. */
  command?: string;
  /** Milliseconds one arclint run may take. */
  timeout?: number;
}

// The JSON arclint answers with, as captured from arclint 0.1.0-beta.1.

/** Kinds whose arclint entries record aliases. */
const KINDS_WITH_ALIASES: readonly TermKind[] = ["aggregate", "entity", "value_object"];

function value(text: string, field: string): string {
  if (text.startsWith("-")) throw refuse("invalid-request", `The ${field} "${text}" starts with "-", which arclint would read as an option.`);
  return text;
}

/**
 * Plans the arclint commands for a change set, keeping a model of the file as each command
 * leaves it so a later change sees what an earlier one did.
 */
class ArclintPlanner {
  readonly steps: PlannedStep[] = [];
  private readonly doc: VocabularyDocument;
  private readonly extras: Map<string, AggregateExtras>;

  constructor(document: VocabularyDocument, extras: Map<string, AggregateExtras>) {
    this.doc = cloneDocument(document);
    this.extras = new Map(extras);
  }

  private step(description: string, command: string[]): void {
    this.steps.push({ description, command });
  }

  private contextOf(term: VocabularyTerm): string | undefined {
    if (term.kind !== "entity") return term.context;
    return term.aggregate === undefined ? undefined : findAggregate(this.doc.terms, term.aggregate)?.context;
  }

  private define(kind: string, name: string, context: string | undefined, flags: [string, string][]): string[] {
    const argv = ["domain", "define", kind, value(name, `${kind} name`)];
    if (context !== undefined) argv.push("--context", value(context, "bounded context"));
    for (const [flag, text] of flags) argv.push(flag, value(text, flag.slice(2)));
    return argv;
  }

  private remove(kind: string, name: string, context: string | undefined, owner?: string): string[] {
    const argv = ["domain", "remove", kind, value(name, `${kind} name`)];
    if (context !== undefined) argv.push("--context", value(context, "bounded context"));
    if (owner !== undefined) argv.push("--owner", value(owner, "owner"));
    return argv;
  }

  /** Refuses what arclint's file cannot record. */
  private checkHoldable(term: VocabularyTerm, at: string): void {
    const cannot = (why: string) => refuse("format-cannot-hold", `${at}: ${term.name} ${why}`);
    if (term.status === "proposed") throw cannot("is proposed; domain.arclint.yaml records only accepted terms, so BWrite's own file keeps proposals.");
    if (term.kind === undefined) throw cannot("is not classified; domain.arclint.yaml records every term as a building block.");
    if (term.kind === "entity" && term.aggregate === undefined) throw cannot("is an Entity of no Aggregate; arclint records every Entity under its Aggregate.");
    if (term.kind !== "bounded_context" && term.kind !== "entity" && term.context === undefined) {
      throw cannot("is in no bounded context; arclint records every term in one.");
    }
    if (term.aliases?.length && !KINDS_WITH_ALIASES.includes(term.kind)) throw cannot(`has aliases; arclint records aliases only on an Aggregate, an Entity, or a Value Object.`);
    if (term.kind === "aggregate" && !term.identity) throw cannot("has no identity; arclint records every Aggregate with the Value Object that identifies it.");
  }

  private termFlags(term: VocabularyTerm): [string, string][] {
    const flags: [string, string][] = [["--definition", term.definition]];
    if (term.kind === "entity") flags.unshift(["--owner", term.aggregate!]);
    if (term.identity) flags.push(["--identity", term.identity]);
    if (term.raisedBy) flags.push(["--raised-by", term.raisedBy]);
    for (const alias of term.aliases ?? []) flags.push(["--alias", alias]);
    if (term.kind === "aggregate") {
      const extras = this.extras.get(extrasKey(term.context, term.name));
      if (extras?.repository) flags.push(["--repository", extras.repository]);
      if (extras?.factory) flags.push(["--factory", extras.factory]);
    }
    return flags;
  }

  private defineRule(owner: VocabularyTerm, context: string | undefined, rule: VocabularyRule | VocabularyAssertion, kind: "invariant" | "assertion"): void {
    const flags: [string, string][] = [["--owner", owner.name]];
    if (kind === "assertion") flags.push(["--on", (rule as VocabularyAssertion).on]);
    flags.push(["--statement", rule.statement]);
    this.step(`Record the ${kind} ${rule.key} on ${owner.name}.`, this.define(kind, rule.key, context, flags));
  }

  /** Records a term afresh, with its rules. */
  private record(term: VocabularyTerm, verb = "Record"): void {
    const context = this.contextOf(term);
    this.step(`${verb} ${kindTitle(term.kind!)} ${describeKey({ name: term.name, context })}.`, this.define(term.kind!, term.name, term.kind === "bounded_context" ? undefined : context, this.termFlags(term)));
    for (const rule of term.invariants ?? []) this.defineRule(term, context, rule, "invariant");
    for (const rule of term.assertions ?? []) this.defineRule(term, context, rule, "assertion");
  }

  private removeTerm(term: VocabularyTerm, why: string): void {
    const context = this.contextOf(term);
    const takes =
      term.kind === "bounded_context"
        ? ", with everything recorded in it and the relations that name it"
        : term.kind === "aggregate"
          ? ", with its Entities and rules"
          : "";
    this.step(
      `${why} ${describeTerm(term, this.doc)}${takes}.`,
      this.remove(term.kind!, term.name, term.kind === "bounded_context" ? undefined : context, term.kind === "entity" ? term.aggregate : undefined),
    );
  }

  private diffRules(before: VocabularyTerm, after: VocabularyTerm, context: string | undefined, kind: "invariant" | "assertion"): void {
    const field = kind === "invariant" ? "invariants" : "assertions";
    const old = (before[field] ?? []) as (VocabularyRule | VocabularyAssertion)[];
    const next = (after[field] ?? []) as (VocabularyRule | VocabularyAssertion)[];
    for (const rule of old) {
      if (!next.some((r) => r.key === rule.key)) {
        this.step(`Remove the ${kind} ${rule.key} from ${after.name}.`, this.remove(kind, rule.key, context, after.name));
      }
    }
    for (const rule of next) {
      const was = old.find((r) => r.key === rule.key);
      if (!was || JSON.stringify(was) !== JSON.stringify(rule)) this.defineRule(after, context, rule, kind);
    }
  }

  /** Re-records everything inside a bounded context under a new one, then removes the old. */
  private renameContext(before: VocabularyTerm, after: VocabularyTerm, at: string): void {
    if ((this.doc.relations ?? []).some((r) => sameName(r.from, before.name) || sameName(r.to, before.name))) {
      throw refuse("format-cannot-hold", `${at}: the context map relates ${before.name}, and arclint has no command that records a relation, so renaming it would lose the relation.`);
    }
    if (sameName(before.name, after.name)) {
      throw refuse("format-cannot-hold", `${at}: arclint cannot rename the bounded context ${before.name} to ${after.name}, a name that differs only in letter case or spacing.`);
    }
    this.record(after);
    const order: readonly (TermKind | undefined)[] = ["aggregate", "value_object", "domain_event", "domain_service", "specification"];
    const members = [...this.doc.terms].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
    for (const term of members) {
      if (term.kind === "bounded_context" || term.kind === "entity" || term.context === undefined || !sameName(term.context, before.name)) continue;
      const moved = { ...term, context: after.name };
      const extras = term.kind === "aggregate" ? this.extras.get(extrasKey(before.name, term.name)) : undefined;
      if (extras) this.extras.set(extrasKey(after.name, term.name), extras);
      this.record(moved, "Re-record");
      if (term.kind === "aggregate") {
        for (const entity of this.doc.terms) {
          if (entity.kind === "entity" && findAggregate(this.doc.terms, entity.aggregate ?? "") === term) {
            this.step(`Re-record Entity ${entity.name} of ${term.name} in ${after.name}.`, this.define("entity", entity.name, after.name, this.termFlags(entity)));
          }
        }
      }
    }
    for (const question of this.doc.questions ?? []) {
      if (question.context !== undefined && sameName(question.context, before.name)) {
        this.step(`Re-record the question ${question.key} in ${after.name}.`, this.define("question", question.key, after.name, [["--text", question.text]]));
      }
    }
    this.removeTerm(before, "Remove the old");
  }

  private renameAggregate(before: VocabularyTerm, after: VocabularyTerm): void {
    const entities = this.doc.terms.filter((t) => t.kind === "entity" && findAggregate(this.doc.terms, t.aggregate ?? "") === before);
    const sameContext = sameName(before.context!, after.context!);
    const events = sameContext
      ? this.doc.terms.filter((t) => t.kind === "domain_event" && t.raisedBy !== undefined && sameName(t.raisedBy, before.name) && sameName(t.context!, before.context!))
      : [];
    const extras = this.extras.get(extrasKey(before.context, before.name));
    if (extras) this.extras.set(extrasKey(after.context, after.name), extras);
    this.removeTerm(before, "Remove");
    this.record(after);
    for (const entity of entities) {
      this.step(`Re-record Entity ${entity.name} under ${after.name}.`, this.define("entity", entity.name, after.context, this.termFlags({ ...entity, aggregate: after.name })));
    }
    for (const event of events) {
      this.step(`Name ${after.name} as what raises ${event.name}.`, this.define("domain_event", event.name, event.context, [["--raised-by", after.name]]));
    }
  }

  private update(before: VocabularyTerm, after: VocabularyTerm): void {
    const context = this.contextOf(after);
    if (after.kind === "entity" && !sameName(before.aggregate!, after.aggregate!)) {
      this.removeTerm(before, "Remove");
      this.record(after);
      return;
    }
    const flags: [string, string][] = [];
    const changed = changedFields(before, after);
    if (changed.includes("definition")) flags.push(["--definition", after.definition]);
    const clearAliases = changed.includes("aliases") && !after.aliases?.length;
    if (changed.includes("aliases")) for (const alias of after.aliases ?? []) flags.push(["--alias", alias]);
    if (changed.includes("identity")) flags.push(["--identity", after.identity ?? ""]);
    if (changed.includes("raisedBy")) flags.push(["--raised-by", after.raisedBy ?? ""]);
    if (flags.length > 0 || clearAliases) {
      if (after.kind === "entity") flags.unshift(["--owner", after.aggregate!]);
      const argv = this.define(after.kind!, after.name, after.kind === "bounded_context" ? undefined : context, flags);
      if (clearAliases) argv.push("--clear-aliases");
      const fields = changed.filter((f) => ["definition", "aliases", "identity", "raisedBy"].includes(f));
      this.step(`Change the ${fields.join(", ")} of ${describeTerm(after, this.doc)}.`, argv);
    }
    this.diffRules(before, after, context, "invariant");
    this.diffRules(before, after, context, "assertion");
  }

  private put(change: Extract<VocabularyChange, { type: "put-term" }>, at: string): void {
    const term = change.term;
    this.checkHoldable(term, at);
    if (term.kind === "entity") {
      const owner = findAggregate(this.doc.terms, term.aggregate!);
      if (!owner) throw refuse("invalid-request", `${at}: ${term.name} names ${term.aggregate}, which is not one recorded Aggregate.`);
    } else if (term.kind !== "bounded_context") {
      if (!this.doc.terms.some((t) => t.kind === "bounded_context" && sameName(t.name, term.context!))) {
        throw refuse("invalid-request", `${at}: ${term.name} names the bounded context ${term.context}, which is not recorded.`);
      }
    }
    const key = change.replaces ?? termKeyOf(term, this.doc);
    const index = findTerm(this.doc, key);
    if (index < 0) {
      if (change.replaces) throw refuse("invalid-request", `${at}: there is no term ${describeKey(change.replaces)} to replace.`);
      this.record(term);
      return;
    }
    const before = this.doc.terms[index];
    if (before.kind !== term.kind) {
      if (!change.replaces) return; // applyChange refuses it with the reason.
      this.removeTerm(before, "Remove");
      this.record(term);
      return;
    }
    const renamed = before.name !== term.name || !sameName(this.contextOf(before) ?? "", this.contextOf(term) ?? "");
    if (!renamed) {
      this.update(before, term);
      return;
    }
    if (term.kind === "bounded_context") return this.renameContext(before, term, at);
    if (term.kind === "aggregate") return this.renameAggregate(before, term);
    const identities =
      term.kind === "value_object" && sameName(before.context!, term.context!)
        ? this.doc.terms.filter((t) => t.identity !== undefined && sameName(t.identity, before.name) && sameName(this.contextOf(t) ?? "", before.context!))
        : [];
    this.removeTerm(before, "Remove");
    this.record(term);
    for (const holder of identities) {
      const flags: [string, string][] = holder.kind === "entity" ? [["--owner", holder.aggregate!]] : [];
      flags.push(["--identity", term.name]);
      this.step(`Identify ${describeTerm(holder, this.doc)} by ${term.name}.`, this.define(holder.kind!, holder.name, this.contextOf(holder), flags));
    }
  }

  plan(changes: readonly VocabularyChange[]): PlannedStep[] {
    changes.forEach((change, i) => {
      const at = `changes[${i}]`;
      if (change.type === "remove-term") {
        const index = findTerm(this.doc, change.term);
        if (index < 0) throw refuse("invalid-request", `${at}: there is no term ${describeKey(change.term)} in ${ARCLINT_DOMAIN_FILE}.`);
        this.removeTerm(this.doc.terms[index], "Remove");
      } else {
        this.put(change, at);
      }
      applyChange(this.doc, change);
    });
    return this.steps;
  }
}

export class ArclintFileAdapter implements VocabularyFileAdapter {
  readonly format = "arclint" as const;
  readonly folder: string;
  readonly watchedFile: string;
  private readonly command: string;
  private readonly timeout: number;

  /** `rulesFolder` is the folder holding the rules.arclint.yaml arclint resolves for `folder`. */
  constructor(folder: string, rulesFolder: string, options: ArclintOptions = {}) {
    this.folder = folder;
    this.watchedFile = path.join(rulesFolder, ARCLINT_DOMAIN_FILE);
    this.command = options.command ?? "arclint";
    this.timeout = options.timeout ?? 30_000;
  }

  /** Runs arclint in the folder, without a shell, and answers its standard output. */
  run(argv: readonly string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      execFile(
        this.command,
        [...argv, "--no-color"],
        { cwd: this.folder, timeout: this.timeout, maxBuffer: 64 * 1024 * 1024, windowsHide: true, env: { ...process.env, NO_COLOR: "1" } },
        (error, stdout, stderr) => {
          if (!error) return resolve(stdout);
          const code = (error as NodeJS.ErrnoException).code;
          if (code === "ENOENT") {
            return reject(refuse("arclint-missing", `${this.folder} is set up for arclint (it has a ${ARCLINT_RULES_FILE}), but arclint is not installed where BWrite runs.`));
          }
          if (error.killed) return reject(refuse("arclint-failed", `arclint ${argv.join(" ")} did not finish within ${this.timeout} ms.`));
          const said = stderr.trim() || stdout.trim() || error.message;
          reject(refuse("arclint-failed", said.replace(/^arclint: /, "")));
        },
      );
    });
  }

  private async read(): Promise<{ loaded: LoadedFile; extras: Map<string, AggregateExtras> }> {
    const domain = JSON.parse(await this.run(["domain", "overview", "--format", "json"])) as ArclintDomain;
    const file = path.relative(this.folder, path.resolve(path.dirname(this.watchedFile), domain.source || ARCLINT_DOMAIN_FILE));
    const source = { format: this.format, file, found: domain.found, holdsProposals: false, holdsUnplacedTerms: false };
    if (!domain.found) return { loaded: { source, document: null }, extras: new Map() };
    const { document, extras } = documentFromArclint(domain);
    return { loaded: { source, document }, extras };
  }

  async load(): Promise<LoadedFile> {
    return (await this.read()).loaded;
  }

  async plan(changes: readonly VocabularyChange[]): Promise<PlannedStep[]> {
    const { loaded, extras } = await this.read();
    if (loaded.document === null) throw refuse("invalid-request", `${this.folder} has no ${ARCLINT_DOMAIN_FILE} yet; create it first.`);
    return new ArclintPlanner(loaded.document, extras).plan(changes);
  }

  async apply(changes: readonly VocabularyChange[]): Promise<LoadedFile> {
    const steps = await this.plan(changes);
    for (const [i, step] of steps.entries()) {
      try {
        await this.run(step.command!);
      } catch (error) {
        if (!(error instanceof ProblemError)) throw error;
        const ran = steps.slice(0, i).map((s, n) => `${n + 1}. arclint ${s.command!.join(" ")}`);
        const done = ran.length > 0 ? ` Steps 1 to ${i} ran and stay recorded in ${ARCLINT_DOMAIN_FILE}: ${ran.join("; ")}.` : " No step ran before it, so nothing changed.";
        const rest = steps.length - i - 1 > 0 ? ` The ${steps.length - i - 1} step(s) after it did not run.` : "";
        throw refuse(error.problem, `Step ${i + 1} of ${steps.length}, arclint ${step.command!.join(" ")}, failed: ${error.message}${done}${rest}`);
      }
    }
    return this.load();
  }

  async create(): Promise<LoadedFile> {
    const current = await this.load();
    if (current.source.found) return current;
    await this.run(["domain", "init"]);
    return this.load();
  }

  async rules(): Promise<ArcLintRule[]> {
    return JSON.parse(await this.run(["rules", "--format", "json"])) as ArcLintRule[];
  }
}
