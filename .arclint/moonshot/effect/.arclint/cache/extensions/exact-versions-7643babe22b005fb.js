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

// ../../extensions/exact-versions.ts
var exact_versions_exports = {};
__export(exact_versions_exports, {
  default: () => exact_versions_default
});
module.exports = __toCommonJS(exact_versions_exports);

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

// ../../extensions/exact-versions.ts
var EXACT = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
var exact_versions_default = defineRule({
  type: "ddd/exact-versions",
  description: "Pin a package family to one exact identical version in the root manifest",
  capability: "exact",
  params: s.object({
    required: s.array(s.string()).describe("Packages the manifest must declare"),
    family: s.array(s.string()).describe("Packages that, when declared, share the required packages' exact version"),
    major: s.integer().describe("Major version the family must use")
  }),
  check(ctx, params) {
    const required = params.required;
    const family = Array.from(new Set(required.concat(params.family)));
    const major = Number(params.major);
    const manifest = ctx.files().find((file) => file.path === "package.json");
    if (!manifest) {
      const subject = ctx.files()[0];
      if (subject) ctx.report({ path: subject.path, message: "Root package.json is required to verify pinned versions" });
      return;
    }
    let data;
    try {
      data = JSON.parse(ctx.read(manifest.path));
    } catch (e) {
      ctx.report({ path: manifest.path, message: "package.json must be valid JSON" });
      return;
    }
    const sections = [
      ["dependencies", data.dependencies],
      ["devDependencies", data.devDependencies],
      ["overrides", data.overrides]
    ];
    const versions = /* @__PURE__ */ new Map();
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
  }
});
