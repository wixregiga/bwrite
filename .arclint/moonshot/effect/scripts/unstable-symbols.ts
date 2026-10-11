// Derives the `@stability unstable` exports of the Effect modules Stage 2 admits
// in process-neutral zones, from the installed declaration files.
// Usage: node scripts/unstable-symbols.ts <effect package dir>        prints the pattern
//        node scripts/unstable-symbols.ts <effect package dir> --check  exits 1 on drift from rules.effect.arclint.yaml
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";

const MODULES = ["Effect", "Stream", "Schema"];
const DOC = /\/\*\*(?:(?!\*\/)[\s\S])*?@stability unstable(?:(?!\*\/)[\s\S])*?\*\/\s*/g;
const DECL = /^export declare (?:const|function|class|interface|type|namespace) ([A-Za-z_$][\w$]*)/;

function unstable(text: string): string[] {
  const names = new Set<string>();
  for (const doc of text.matchAll(DOC)) {
    const match = DECL.exec(text.slice(doc.index + doc[0].length));
    if (match?.[1]) names.add(match[1]);
  }
  return [...names].sort();
}

const [packageDir, mode] = process.argv.slice(2);
if (!packageDir) throw new Error("usage: unstable-symbols.ts <effect package dir> [--check]");
const pattern = MODULES.flatMap((module) => {
  const names = unstable(readFileSync(join(packageDir, "dist", `${module}.d.ts`), "utf8"));
  return names.length ? [`\\b${module}\\.(?:${names.join("|")})\\b`] : [];
}).join("|");
if (mode !== "--check") {
  console.log(pattern);
} else {
  const rules = parse(readFileSync(join(import.meta.dirname, "..", "rules.effect.arclint.yaml"), "utf8")) as {
    rules: Record<string, { content?: { forbid: string } }>;
  };
  const configured = rules.rules["effect-stable-core"]?.content?.forbid;
  if (configured !== pattern) {
    console.error("effect-stable-core drifted from the installed declarations; expected:\n" + pattern);
    process.exit(1);
  }
  console.log(`effect-stable-core matches ${pattern.split("|").length} unstable exports of ${MODULES.join(", ")}`);
}
