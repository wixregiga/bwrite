export const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

export const isString = (v: unknown): v is string => typeof v === "string";

export const isArrayOf = <T>(v: unknown, guard: (x: unknown) => x is T): v is T[] =>
  Array.isArray(v) && v.every(guard);

export const isTimestamp = (v: unknown): v is string => isString(v) && !Number.isNaN(Date.parse(v));
