import { defineRule, s } from "arclint";

const EXACT = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

type Manifest = {
  dependencies?: Record<string, unknown>;
  devDependencies?: Record<string, unknown>;
  overrides?: Record<string, unknown>;
};

// A package family adopted together is pinned to one exact, identical version
// in the root manifest, wherever it is declared. Ranges, tags and drift
// between family members are findings.
export default defineRule({
  type: "ddd/exact-versions",
  description: "Pin a package family to one exact identical version in the root manifest",
  capability: "exact",
  params: s.object({
    required: s.array(s.string()).describe("Packages the manifest must declare"),
    family: s.array(s.string()).describe("Packages that, when declared, share the required packages' exact version"),
    major: s.integer().describe("Major version the family must use"),
  }),
  check(ctx, params) {
    const required = params.required as string[];
    const family = Array.from(new Set(required.concat(params.family as string[])));
    const major = Number(params.major);
    const manifest = ctx.files().find(file => file.path === "package.json");
    if (!manifest) {
      const subject = ctx.files()[0];
      if (subject) ctx.report({ path: subject.path, message: "Root package.json is required to verify pinned versions" });
      return;
    }
    let data: Manifest;
    try {
      data = JSON.parse(ctx.read(manifest.path)) as Manifest;
    } catch {
      ctx.report({ path: manifest.path, message: "package.json must be valid JSON" });
      return;
    }
    const sections: Array<[string, Record<string, unknown> | undefined]> = [
      ["dependencies", data.dependencies], ["devDependencies", data.devDependencies], ["overrides", data.overrides],
    ];
    const versions = new Map<string, string>();
    for (const name of family) {
      for (const [section, entries] of sections) {
        if (!entries || !(name in entries)) continue;
        const version = entries[name];
        if (typeof version !== "string" || !EXACT.test(version)) {
          ctx.report({ path: manifest.path, message: `${section}.${name} must be one exact version, not ${JSON.stringify(version)}` });
          continue;
        }
        if (Number(version.split(".")[0]) !== major) {
          ctx.report({ path: manifest.path, message: `${section}.${name} must use major version ${major}, not ${version}` });
          continue;
        }
        versions.set(`${section}.${name}`, version);
      }
    }
    for (const name of required) {
      if (!sections.some(([, entries]) => entries && name in entries)) {
        ctx.report({ path: manifest.path, message: `${name} must be declared with one exact version` });
      }
    }
    const distinct = Array.from(new Set(versions.values())).sort();
    if (distinct.length > 1) {
      const listing = Array.from(versions.entries()).sort().map(([key, version]) => `${key}@${version}`).join(", ");
      ctx.report({ path: manifest.path, message: `Package family versions differ: ${listing}` });
    }
  },
});
