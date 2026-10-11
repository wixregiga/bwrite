import { defineRule, s } from "arclint";

const IMPORT = /\bimport\s+(type\s+)?([^;]*?)\s+from\s+["']([^"']+)["']/g;
const NAMESPACE = /^\*\s+as\s+([A-Za-z_$][\w$]*)$/;

// Modules of the listed packages are imported whole, under their own module
// name: import * as Effect from "effect/Effect". Every call site then names its
// module, which is what content rules over qualified names rely on.
export default defineRule({
  type: "ddd/namespace-imports",
  description: "Import modules of the listed packages as namespaces named after the module",
  capability: "exact",
  params: s.object({
    packages: s.array(s.string()).describe("Package names whose modules must be namespace-imported"),
  }),
  check(ctx, params) {
    const packages = params.packages as string[];
    const governed = (specifier: string): boolean =>
      packages.some(name => specifier === name || specifier.startsWith(name + "/"));
    for (const file of ctx.files()) {
      if (!/\.tsx?$/.test(file.path)) continue;
      const text = ctx.read(file.path);
      IMPORT.lastIndex = 0;
      for (let match = IMPORT.exec(text); match !== null; match = IMPORT.exec(text)) {
        const clause = match[2].trim();
        const specifier = match[3];
        if (!governed(specifier)) continue;
        const line = text.slice(0, match.index).split("\n").length;
        const stem = specifier.split("/").pop() as string;
        const namespace = NAMESPACE.exec(clause);
        if (!namespace) {
          ctx.report({ path: file.path, line, message: `Import "${specifier}" as a namespace: import * as ${stem} from "${specifier}"` });
        } else if (namespace[1] !== stem) {
          ctx.report({ path: file.path, line, message: `Namespace for "${specifier}" must be named ${stem}, not ${namespace[1]}` });
        }
      }
    }
  },
});
