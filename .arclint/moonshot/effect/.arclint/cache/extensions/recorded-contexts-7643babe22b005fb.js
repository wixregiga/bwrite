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

// ../../extensions/recorded-contexts.ts
var recorded_contexts_exports = {};
__export(recorded_contexts_exports, {
  default: () => recorded_contexts_default
});
module.exports = __toCommonJS(recorded_contexts_exports);

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

// ../../extensions/recorded-contexts.ts
var recorded_contexts_default = defineRule({
  type: "ddd/recorded-contexts",
  description: "Every bounded-context folder names a context recorded in domain.arclint.yaml",
  capability: "exact",
  params: s.object({
    root: s.string().describe("Folder holding one sub-folder per bounded context, ending in /")
  }),
  check(ctx, params) {
    const root = params.root;
    const recorded = new Set(ctx.domain().contexts.map((context) => ctx.caseTerm(context.name, "kebab-case")));
    const firstFile = /* @__PURE__ */ new Map();
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
      if (seen === void 0 || file.path < seen) firstFile.set(folder, file.path);
    }
    for (const [folder, path] of Array.from(firstFile.entries()).sort()) {
      if (!recorded.has(folder)) {
        ctx.report({
          path,
          message: `Context folder "${folder}" names no context recorded in domain.arclint.yaml; record the context first or move the code into the context that owns it`
        });
      }
    }
  }
});
