import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// arclint does not scan colocated unit tests or tests/support/unit/ (rules.arclint.yaml
// scan.exclude), so its test-placement rule cannot see them. This suite keeps both of
// its guarantees for them by reading the real src/ tree.

const REPO = resolve(__dirname, "../..");
const SRC = join(REPO, "src");
const UNIT_SUPPORT = join(REPO, "tests/support/unit");
const UNIT_TEST = /\.test\.tsx?$/;
const SOURCE = /\.tsx?$/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return SOURCE.test(name) && !name.endsWith(".d.ts") ? [path] : [];
  });
}

const display = (path: string) => relative(REPO, path).split("\\").join("/");

/** Removes comments, leaving string literals intact, so only what the code says remains. */
function withoutComments(code: string): string {
  return code.replace(/("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`)|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, (_match, literal) =>
    literal ?? "",
  );
}

/** Every module specifier a file names: static and type imports, re-exports, side-effect and dynamic imports. */
function specifiers(code: string): string[] {
  const clean = withoutComments(code);
  const found: string[] = [];
  for (const m of clean.matchAll(/^\s*(?:import|export)\b[^;"']*?\bfrom\s*["']([^"']+)["']/gm)) found.push(m[1]);
  for (const m of clean.matchAll(/^\s*import\s*["']([^"']+)["']/gm)) found.push(m[1]);
  for (const m of clean.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g)) found.push(m[1]);
  return found;
}

/** The files a relative specifier can resolve to, as TypeScript's bundler resolution tries them. */
function candidates(from: string, specifier: string): string[] {
  const base = resolve(dirname(from), specifier);
  return [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")];
}

/** Why an import of `specifier` from production file `from` reaches test code, or null when it does not. */
function testCodeReached(from: string, specifier: string): string | null {
  if (!specifier.startsWith(".")) return null;
  for (const target of candidates(from, specifier)) {
    if (UNIT_TEST.test(target) || /\.test$/.test(target)) return `${specifier} names a unit test`;
    if (target === UNIT_SUPPORT || target.startsWith(UNIT_SUPPORT + "/") || target.startsWith(UNIT_SUPPORT + "\\")) {
      return `${specifier} reaches the unit-test harness`;
    }
    if (existsSync(target) && statSync(target).isFile()) return null;
  }
  return null;
}

describe("colocated unit tests", () => {
  const files = sourceFiles(SRC);
  const tests = files.filter((f) => UNIT_TEST.test(f));
  const production = files.filter((f) => !UNIT_TEST.test(f));

  it("reads the real src/ tree", () => {
    expect(tests.length).toBeGreaterThan(0);
    expect(production.length).toBeGreaterThan(tests.length);
  });

  it("sit beside a same-stem subject", () => {
    const orphans = tests
      .filter((test) => {
        const stem = test.replace(UNIT_TEST, "");
        return !existsSync(`${stem}.ts`) && !existsSync(`${stem}.tsx`);
      })
      .map(display);
    expect(orphans).toEqual([]);
  });

  it("are never imported by production code, nor is their harness", () => {
    const reaches = production.flatMap((file) =>
      specifiers(readFileSync(file, "utf8")).flatMap((specifier) => {
        const why = testCodeReached(file, specifier);
        return why === null ? [] : [`${display(file)}: ${why}`];
      }),
    );
    expect(reaches).toEqual([]);
  });
});
