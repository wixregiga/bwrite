import { defineRule, s } from "arclint";

const SOURCE = /\.tsx?$/;
const TEST = /\.(test|spec)\.tsx?$/;

// Unit tests sit beside their same-stem subject, acceptance suites live in
// named folders, harness code lives in one support folder, and production
// code never imports any of them.
export default defineRule({
  type: "ddd/test-placement",
  description: "Colocate unit tests with their subject, keep acceptance tests in named suites, keep tests out of production imports",
  capability: "exact",
  params: s.object({
    suites: s.array(s.string()).describe("Acceptance suite folders, each ending in /"),
    support: s.string().describe("Test harness folder, ending in /"),
  }),
  check(ctx, params) {
    const suites = params.suites as string[];
    const support = params.support as string;
    const testRoots = Array.from(new Set(suites.concat([support]).map(dir => dir.split("/")[0] + "/")));
    const isTestCode = (path: string): boolean => TEST.test(path) || testRoots.some(dir => path.startsWith(dir));
    const files = ctx.files().filter(file => SOURCE.test(file.path));
    const paths = new Set(files.map(file => file.path));
    for (const file of files) {
      const path = file.path;
      const inTestRoot = testRoots.some(dir => path.startsWith(dir));
      if (inTestRoot) {
        if (path.startsWith(support)) {
          if (TEST.test(path)) ctx.report({ path, message: `${support} holds harness modules, not test cases` });
        } else if (!suites.some(dir => path.startsWith(dir)) || !/\.test\.ts$/.test(path)) {
          ctx.report({ path, message: `Acceptance tests end in .test.ts under one of ${suites.join(", ")}; harness modules belong under ${support}` });
        }
        continue;
      }
      if (TEST.test(path)) {
        if (!/\.test\.tsx?$/.test(path)) {
          ctx.report({ path, message: "Unit tests end in .test.ts or .test.tsx" });
        } else {
          const stem = path.replace(/\.test\.tsx?$/, "");
          if (!paths.has(stem + ".ts") && !paths.has(stem + ".tsx")) {
            ctx.report({ path, message: `Unit test has no same-stem subject beside it (${stem}.ts or ${stem}.tsx)` });
          }
        }
        continue;
      }
      const facts = ctx.facts(path);
      if (!facts || !facts.importsAvailable) {
        ctx.report({ path, message: "Import facts unavailable; test isolation verification cannot proceed" });
        continue;
      }
      for (const imp of facts.imports) {
        if (imp.class === "internal" && imp.targetFile && isTestCode(imp.targetFile)) {
          ctx.report({ path, line: imp.line, message: `Production module imports test code ${imp.targetFile}` });
        }
      }
    }
  },
});
