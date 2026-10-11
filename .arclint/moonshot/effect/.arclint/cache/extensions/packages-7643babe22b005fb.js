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

// ../../extensions/packages.ts
var packages_exports = {};
__export(packages_exports, {
  default: () => packages_default
});
module.exports = __toCommonJS(packages_exports);

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

// ../../extensions/packages.ts
var packages_default = defineRule({
  type: "ddd/packages",
  description: "Restrict a Zone's external imports to its declared package list",
  capability: "exact",
  params: s.object({
    packages: s.array(s.string()).describe("Exact specifiers or prefixes ending in /*")
  }),
  check(ctx, params) {
    const entries = params.packages;
    const exact = new Set(entries.filter((entry) => !entry.endsWith("/*")));
    const prefixes = entries.filter((entry) => entry.endsWith("/*")).map((entry) => entry.slice(0, -1));
    const admitted = (specifier) => exact.has(specifier) || prefixes.some((prefix) => specifier.startsWith(prefix) && specifier.length > prefix.length);
    for (const file of ctx.files()) {
      if (!/\.tsx?$/.test(file.path)) continue;
      const facts = ctx.facts(file.path);
      if (!facts || !facts.importsAvailable) {
        ctx.report({ path: file.path, message: "Import facts unavailable; package verification cannot proceed" });
        continue;
      }
      for (const imp of facts.imports) {
        if (imp.class !== "external") continue;
        if (imp.path.split("/").includes("internal")) {
          ctx.report({ path: file.path, line: imp.line, message: `Package "${imp.path}" reaches an internal module; import the public module instead` });
          continue;
        }
        if (admitted(imp.path)) continue;
        const listed = entries.length === 0 ? "none" : entries.join(", ");
        ctx.report({ path: file.path, line: imp.line, message: `Package "${imp.path}" is not declared for ${facts.zones.join(", ")} (declared: ${listed})` });
      }
    }
  }
});
