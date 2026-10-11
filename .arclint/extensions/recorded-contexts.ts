import { defineRule, s } from "arclint";

// A bounded-context folder exists only for a context recorded in
// domain.arclint.yaml, spelled as the recorded name in kebab-case.
export default defineRule({
  type: "ddd/recorded-contexts",
  description: "Every bounded-context folder names a context recorded in domain.arclint.yaml",
  capability: "exact",
  params: s.object({
    root: s.string().describe("Folder holding one sub-folder per bounded context, ending in /"),
  }),
  check(ctx, params) {
    const root = params.root as string;
    const recorded = new Set(ctx.domain().contexts.map(context => ctx.caseTerm(context.name, "kebab-case")));
    const firstFile = new Map<string, string>();
    for (const file of ctx.files()) {
      if (!file.path.startsWith(root)) continue;
      const rest = file.path.slice(root.length);
      const slash = rest.indexOf("/");
      if (slash === -1) {
        ctx.report({ path: file.path, message: `Files under ${root} belong inside a bounded-context folder` });
        continue;
      }
      const folder = rest.slice(0, slash);
      const seen = firstFile.get(folder);
      if (seen === undefined || file.path < seen) firstFile.set(folder, file.path);
    }
    for (const [folder, path] of Array.from(firstFile.entries()).sort()) {
      if (!recorded.has(folder)) {
        ctx.report({
          path,
          message: `Context folder "${folder}" names no context recorded in domain.arclint.yaml; record the context first or move the code into the context that owns it`,
        });
      }
    }
  },
});
