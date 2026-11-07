// Gate: Stage 2 equals Stage 1 except the declared delta.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { parse } from "yaml";

const REPLACED = new Set(["application-platform", "formats-packages", "contracts-platform", "transport-platform", "browser-platform", "ui-packages", "app-packages"]);
const REMOVED = new Set(["node-platform", "server_shared-platform", "server_app-platform"]);
const ADDED = new Set(["application-packages", "contracts-packages", "transport-packages", "browser-packages", "node-packages", "server_shared-packages",
  "server_app-packages", "effect-exact-pins", "effect-stable-core", "effect-namespace-imports", "effect-run-at-roots", "effect-named-functions"]);

type Ruleset = { runtime: unknown; scan: unknown; zones: unknown; rules: Record<string, unknown> };
const load = (...path: string[]): Ruleset => parse(readFileSync(join(import.meta.dirname, ...path), "utf8")) as Ruleset;
// Stage 1 is the active ruleset at the repository root; Stage 2 sits beside this script's folder.
const one = load("..", "..", "..", "..", "rules.arclint.yaml");
const two = load("..", "rules.effect.arclint.yaml");
const errors: string[] = [];
if (!isDeepStrictEqual(one.zones, two.zones)) errors.push("zones differ");
if (!isDeepStrictEqual(one.scan, two.scan) || !isDeepStrictEqual(one.runtime, two.runtime)) errors.push("scan or runtime differs");
for (const [rule, body] of Object.entries(one.rules)) {
  if (REMOVED.has(rule)) {
    if (rule in two.rules) errors.push(`${rule} is declared removed but present`);
  } else if (REPLACED.has(rule)) {
    if (!(rule in two.rules)) errors.push(`${rule} is declared replaced but missing`);
    else if (isDeepStrictEqual(two.rules[rule], body)) errors.push(`${rule} is declared replaced but unchanged`);
  } else if (!isDeepStrictEqual(two.rules[rule], body)) {
    errors.push(`${rule} differs from Stage 1 without being declared`);
  }
}
const added = Object.keys(two.rules).filter((rule) => !(rule in one.rules)).sort();
if (!isDeepStrictEqual(added, [...ADDED].sort())) errors.push(`added rules ${added.join(", ")} differ from declared ${[...ADDED].sort().join(", ")}`);
if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log(`stage 2 delta ok: ${REPLACED.size} replaced, ${REMOVED.size} removed, ${ADDED.size} added`);
