"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// ../../extensions/file-cycles.ts
var file_cycles_exports = {};
__export(file_cycles_exports, {
  default: () => file_cycles_default
});
module.exports = __toCommonJS(file_cycles_exports);

// arclint-sdk:arclint
var defineRule = (def) => {
  var _a, _b;
  if (!def || typeof def.type !== "string" || def.type.length === 0) {
    throw new Error("defineRule: type is required and must be a non-empty string");
  }
  if (typeof def.check !== "function") {
    throw new Error("defineRule: check must be a function");
  }
  if (def.description !== void 0 && typeof def.description !== "string") {
    throw new Error("defineRule: description must be a string");
  }
  const capability = (_a = def.capability) != null ? _a : "heuristic";
  if (capability !== "exact" && capability !== "structural" && capability !== "heuristic" && capability !== "advisory") {
    throw new Error(`defineRule: invalid capability "${capability}"`);
  }
  const paramsSchema = def.params ? def.params.toJSON() : { type: "object", properties: {}, additionalProperties: false };
  return {
    __arclintRule: true,
    type: def.type,
    description: (_b = def.description) != null ? _b : "",
    capability,
    paramsSchema,
    check: def.check
  };
};

// ../../extensions/file-cycles.ts
var file_cycles_default = defineRule({
  type: "ddd/file-cycles",
  description: "Reject strongly connected components in the resolved TypeScript file import graph",
  capability: "exact",
  check(ctx) {
    const files = ctx.files().filter((file) => /\.tsx?$/.test(file.path));
    const paths = new Set(files.map((file) => file.path));
    const graph = /* @__PURE__ */ new Map();
    for (const file of files) {
      const facts = ctx.facts(file.path);
      if (!facts || !facts.importsAvailable) {
        ctx.report({ path: file.path, message: "Import facts unavailable; cycle verification cannot proceed" });
        graph.set(file.path, []);
        continue;
      }
      const targets = facts.imports.filter((imp) => imp.class === "internal" && paths.has(imp.targetFile)).map((imp) => imp.targetFile);
      graph.set(file.path, Array.from(new Set(targets)).sort());
    }
    let counter = 0;
    const index = /* @__PURE__ */ new Map();
    const low = /* @__PURE__ */ new Map();
    const onStack = /* @__PURE__ */ new Set();
    const stack = [];
    for (const root of Array.from(paths).sort()) {
      if (index.has(root)) continue;
      const work = [{ node: root, next: 0 }];
      index.set(root, counter);
      low.set(root, counter);
      counter++;
      stack.push(root);
      onStack.add(root);
      while (work.length > 0) {
        const frame = work[work.length - 1];
        const targets = graph.get(frame.node) || [];
        if (frame.next < targets.length) {
          const target = targets[frame.next++];
          if (!index.has(target)) {
            index.set(target, counter);
            low.set(target, counter);
            counter++;
            stack.push(target);
            onStack.add(target);
            work.push({ node: target, next: 0 });
          } else if (onStack.has(target)) {
            low.set(frame.node, Math.min(low.get(frame.node), index.get(target)));
          }
          continue;
        }
        work.pop();
        if (work.length > 0) {
          const parent = work[work.length - 1].node;
          low.set(parent, Math.min(low.get(parent), low.get(frame.node)));
        }
        if (low.get(frame.node) !== index.get(frame.node)) continue;
        const component = [];
        let member;
        do {
          member = stack.pop();
          onStack.delete(member);
          component.push(member);
        } while (member !== frame.node);
        const selfLoop = (graph.get(frame.node) || []).includes(frame.node);
        if (component.length > 1 || selfLoop) {
          component.sort();
          ctx.report({ path: component[0], message: `Import cycle among files: ${component.join(", ")}` });
        }
      }
    }
  }
});
