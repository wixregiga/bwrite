import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = resolve(__dirname, "../../src");
/** ArcLint's own definitions, generated from `arclint domain explain`; BWrite quotes them and never rewords them. */
const GENERATED = new Set(["contexts/authoring/domain/arclint-concepts.ts"]);

/**
 * Words BWrite once used without defining them, or for things the model no longer has:
 * an "entry" of the vocabulary, a "Legacy" classification note, and the "Describes" field.
 */
const RETIRED = /\b(entry|entries|legacy|describes)\b/i;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    // Unit tests sit beside their subjects; their strings are test data, not copy.
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

/** Removes comments, leaving string literals intact, so only what the code says remains. */
function withoutComments(code: string): string {
  return code.replace(/("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`)|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, (_match, literal) =>
    literal ?? "",
  );
}

/** The text a file can put in front of a person: its string literals and its JSX text. */
function userFacingText(code: string): string[] {
  const clean = withoutComments(code);
  const literals = clean.match(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g) ?? [];
  const jsxText = [...clean.matchAll(/>([^<>{}]*[A-Za-z][^<>{}]*)</g)].map((m) => m[1]);
  return [...literals, ...jsxText];
}

describe("user-facing copy", () => {
  const files = sourceFiles(SRC).filter((f) => !GENERATED.has(relative(SRC, f).split("\\").join("/")));

  it("reads every source file", () => {
    expect(files.length).toBeGreaterThan(20);
    expect(files.some((f) => f.endsWith("authoring-workspace.tsx"))).toBe(true);
  });

  it("never says entry, Legacy, or Describes", () => {
    const hits = files.flatMap((file) =>
      userFacingText(readFileSync(file, "utf8"))
        .filter((text) => RETIRED.test(text))
        .map((text) => `${relative(SRC, file)}: ${text.trim()}`),
    );
    expect(hits).toEqual([]);
  });

  it("finds a retired word when one is there", () => {
    expect(userFacingText('const a = "Open entry"; // an entry\n<p>Legacy note</p>').filter((t) => RETIRED.test(t))).toEqual([
      '"Open entry"',
      "Legacy note",
    ]);
    expect(userFacingText("// Describes the entry\nconst b = 1;")).toEqual([]);
  });
});
