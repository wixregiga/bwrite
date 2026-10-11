import { defineRule, s } from "arclint";

const WORD_FOLDER = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

// Every source file has exactly one architectural owner, and every folder on
// its path is a lowercase hyphenated word an agent can type without guessing.
export default defineRule({
  type: "ddd/placement",
  description: "Every TypeScript source file belongs to exactly one Zone under lowercase hyphenated folders",
  capability: "exact",
  params: s.object({
    roots: s.array(s.string()).describe("Source roots, each ending in /"),
  }),
  check(ctx, params) {
    const roots = params.roots as string[];
    for (const file of ctx.files()) {
      if (!/\.tsx?$/.test(file.path) || !roots.some(root => file.path.startsWith(root))) continue;
      const zones = ctx.zoneOf(file.path);
      if (zones.length === 0) {
        ctx.report({ path: file.path, message: "Source file belongs to no Zone; move it into the segment that owns its responsibility" });
      } else if (zones.length > 1) {
        ctx.report({ path: file.path, message: `Source file belongs to several Zones (${zones.join(", ")}); Zone globs must partition the source tree` });
      }
      const folders = file.dir === "" || file.dir === "." ? [] : file.dir.split("/");
      const wrong = folders.filter(folder => !WORD_FOLDER.test(folder));
      if (wrong.length > 0) {
        ctx.report({ path: file.path, message: `Folder names must be lowercase hyphenated words: ${wrong.join(", ")}` });
      }
    }
  },
});
