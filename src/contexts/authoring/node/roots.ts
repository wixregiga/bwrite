// The folders BWrite may read: the ones it was started with, the launch root first.

import { realpath, stat } from "node:fs/promises";
import path from "node:path";
import type { Roots } from "../contracts/vocabulary-api";
import { refuse } from "../application/problem";

/**
 * Resolves root entries against `cwd` to their real paths, dropping repeats. With no entries
 * the working directory is the only root. A root that does not exist stops BWrite from starting.
 */
export async function resolveRoots(entries: readonly string[], cwd: string): Promise<Roots> {
  const wanted = entries.map((entry) => entry.trim()).filter((entry) => entry.length > 0);
  const listed = wanted.length > 0 ? wanted : [cwd];
  const roots: string[] = [];
  for (const entry of listed) {
    const absolute = path.resolve(cwd, entry);
    let real: string;
    try {
      real = await realpath(absolute);
    } catch {
      throw new Error(`BWrite cannot serve ${absolute}: no such folder`);
    }
    if (!(await stat(real)).isDirectory()) throw new Error(`BWrite cannot serve ${absolute}: not a folder`);
    if (!roots.includes(real)) roots.push(real);
  }
  return { launchRoot: roots[0], roots };
}

/** Roots from BWRITE_ROOTS, a list separated by the platform's path delimiter, or the working directory. */
export function rootsFromEnvironment(env: NodeJS.ProcessEnv = process.env, cwd: string = process.cwd()): Promise<Roots> {
  return resolveRoots((env.BWRITE_ROOTS ?? "").split(path.delimiter), cwd);
}

export function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  if (relative === "") return true;
  if (path.isAbsolute(relative)) return false;
  return relative !== ".." && !relative.startsWith(`..${path.sep}`);
}

/**
 * The real folder a request's path names. The path must be absolute, resolve (symbolic links
 * followed) inside one of the roots, and be an existing folder.
 */
export async function resolveProjectFolder(roots: Roots, requested: unknown): Promise<string> {
  if (typeof requested !== "string" || requested.length === 0) throw refuse("invalid-request", "The request names no path.");
  if (requested.includes("\0")) throw refuse("invalid-request", "The path contains a NUL character.");
  if (!path.isAbsolute(requested)) throw refuse("invalid-request", `The path ${requested} is not absolute.`);
  const lexical = path.resolve(requested);
  const outside = refuse("outside-roots", `${requested} is outside the folders BWrite was started with (${roots.roots.join(", ")}).`);
  let real: string;
  try {
    real = await realpath(lexical);
  } catch {
    if (roots.roots.some((root) => isInside(root, lexical))) throw refuse("not-a-folder", `${requested} does not exist.`);
    throw outside;
  }
  if (!roots.roots.some((root) => isInside(root, real))) throw outside;
  if (!(await stat(real)).isDirectory()) throw refuse("not-a-folder", `${requested} is not a folder.`);
  return real;
}
