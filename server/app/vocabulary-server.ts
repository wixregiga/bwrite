// Composes BWrite's API for the folders it may read: the authoring context's HTTP and SSE
// handlers over the roots given, or over BWRITE_ROOTS and the working directory.

import type { Roots } from "../../src/contexts/authoring/contracts/vocabulary-api";
import { createVocabularyApi, type ConnectHandler } from "../../src/contexts/authoring/node/vocabulary-api";
import { resolveRoots, rootsFromEnvironment } from "../../src/contexts/authoring/node/roots";

export type { ConnectHandler };

export interface ApiComposition {
  /** The folders BWrite may read; absent: BWRITE_ROOTS, or else `cwd`. */
  roots?: readonly string[];
  /** The folder relative roots resolve against. */
  cwd: string;
  /** The arclint executable to run; absent: `arclint` on PATH. */
  arclintCommand?: string;
}

/** BWrite's API handler and the roots it serves. */
export async function composeApi(composition: ApiComposition): Promise<{ api: ConnectHandler; roots: Roots }> {
  const roots = composition.roots === undefined
    ? await rootsFromEnvironment(process.env, composition.cwd)
    : await resolveRoots(composition.roots, composition.cwd);
  const arclint = composition.arclintCommand === undefined ? undefined : { command: composition.arclintCommand };
  return { api: createVocabularyApi({ roots, arclint }), roots };
}

/** A server that takes Connect middleware, as Vite's dev and preview servers do. */
export interface MiddlewareHost {
  middlewares: { use(handler: ConnectHandler): unknown };
  httpServer?: { once(event: "close", listener: () => void): unknown } | null;
}

/** Mounts BWrite's API on a dev or preview server, over BWRITE_ROOTS or the folder it was started in. */
export async function mountApi(host: MiddlewareHost): Promise<void> {
  const { api } = await composeApi({ cwd: process.cwd() });
  host.middlewares.use(api);
  host.httpServer?.once("close", () => api.close());
}
