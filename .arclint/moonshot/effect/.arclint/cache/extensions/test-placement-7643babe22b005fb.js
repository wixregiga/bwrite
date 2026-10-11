"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getOwnPropSymbols = Object.getOwnPropertySymbols;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __propIsEnum = Object.prototype.propertyIsEnumerable;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __spreadValues = (a, b) => {
  for (var prop in b || (b = {}))
    if (__hasOwnProp.call(b, prop))
      __defNormalProp(a, prop, b[prop]);
  if (__getOwnPropSymbols)
    for (var prop of __getOwnPropSymbols(b)) {
      if (__propIsEnum.call(b, prop))
        __defNormalProp(a, prop, b[prop]);
    }
  return a;
};
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

// ../../extensions/test-placement.ts
var test_placement_exports = {};
__export(test_placement_exports, {
  default: () => test_placement_default
});
module.exports = __toCommonJS(test_placement_exports);

// arclint-sdk:arclint
function node(base) {
  const state = { schema: __spreadValues({}, base), optional: false, hasDefault: false };
  const api = {
    __schema: true,
    __state: state,
    optional() {
      state.optional = true;
      return api;
    },
    default(v) {
      state.schema.default = v;
      state.hasDefault = true;
      return api;
    },
    describe(d) {
      state.schema.description = d;
      return api;
    },
    toJSON() {
      return __spreadValues({}, state.schema);
    }
  };
  return api;
}
var s = {
  string: () => node({ type: "string" }),
  number: () => node({ type: "number" }),
  integer: () => node({ type: "integer" }),
  boolean: () => node({ type: "boolean" }),
  enum: (...values) => node({ type: "string", enum: values }),
  array: (items) => node({ type: "array", items: items.toJSON() }),
  object: (props) => {
    const properties = {};
    const required = [];
    for (const key of Object.keys(props)) {
      const child = props[key];
      properties[key] = child.toJSON();
      if (!child.__state.optional && !child.__state.hasDefault) {
        required.push(key);
      }
    }
    const schema = {
      type: "object",
      properties,
      additionalProperties: false
    };
    if (required.length > 0) {
      schema.required = required;
    }
    return node(schema);
  }
};
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

// ../../extensions/test-placement.ts
var SOURCE = /\.tsx?$/;
var TEST = /\.(test|spec)\.tsx?$/;
var test_placement_default = defineRule({
  type: "ddd/test-placement",
  description: "Colocate unit tests with their subject, keep acceptance tests in named suites, keep tests out of production imports",
  capability: "exact",
  params: s.object({
    suites: s.array(s.string()).describe("Acceptance suite folders, each ending in /"),
    support: s.string().describe("Test harness folder, ending in /")
  }),
  check(ctx, params) {
    const suites = params.suites;
    const support = params.support;
    const testRoots = Array.from(new Set(suites.concat([support]).map((dir) => dir.split("/")[0] + "/")));
    const isTestCode = (path) => TEST.test(path) || testRoots.some((dir) => path.startsWith(dir));
    const files = ctx.files().filter((file) => SOURCE.test(file.path));
    const paths = new Set(files.map((file) => file.path));
    for (const file of files) {
      const path = file.path;
      const inTestRoot = testRoots.some((dir) => path.startsWith(dir));
      if (inTestRoot) {
        if (path.startsWith(support)) {
          if (TEST.test(path)) ctx.report({ path, message: `${support} holds harness modules, not test cases` });
        } else if (!suites.some((dir) => path.startsWith(dir)) || !/\.test\.ts$/.test(path)) {
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
  }
});
