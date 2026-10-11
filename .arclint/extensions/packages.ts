import { defineRule, s } from "arclint";

// Each Zone names the third-party packages it may speak. An entry is an exact
// module specifier ("react", "effect/Effect") or a scope prefix ending in /*
// ("@codemirror/*"), which admits every specifier under that prefix. A
// specifier with an "internal" path segment is never a public module.
export default defineRule({
  type: "ddd/packages",
  description: "Restrict a Zone's external imports to its declared package list",
  capability: "exact",
  params: s.object({
    packages: s.array(s.string()).describe("Exact specifiers or prefixes ending in /*"),
  }),
  check(ctx, params) {
    const entries = params.packages as string[];
    const exact = new Set(entries.filter(entry => !entry.endsWith("/*")));
    const prefixes = entries.filter(entry => entry.endsWith("/*")).map(entry => entry.slice(0, -1));
    const admitted = (specifier: string): boolean =>
      exact.has(specifier) || prefixes.some(prefix => specifier.startsWith(prefix) && specifier.length > prefix.length);
    for (const file of ctx.files()) {
      if (!/\.tsx?$/.test(file.path)) continue;
      const facts = ctx.facts(file.path);
      if (!facts || !facts.importsAvailable) {
        ctx.report({ path: file.path, message: "Import facts unavailable; package verification cannot proceed" });
        continue;
      }
      for (const imp of facts.imports) {
        if (imp.class !== "external") continue;
        if (imp.path.split("/").includes("internal")) {
          ctx.report({ path: file.path, line: imp.line, message: `Package "${imp.path}" reaches an internal module; import the public module instead` });
          continue;
        }
        if (admitted(imp.path)) continue;
        const listed = entries.length === 0 ? "none" : entries.join(", ");
        ctx.report({ path: file.path, line: imp.line, message: `Package "${imp.path}" is not declared for ${facts.zones.join(", ")} (declared: ${listed})` });
      }
    }
  },
});
