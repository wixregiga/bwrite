import type { ProjectPath } from "../domain/project-path";
import type { Workspace } from "./workspace";

export type LoadResult =
  | { kind: "restored"; workspace: Workspace; savedAt: string }
  | { kind: "seeded"; workspace: Workspace }
  | { kind: "unreadable"; workspace: Workspace; reason: string; backupKey: string | null };

export type SaveResult = { ok: true; savedAt: string } | { ok: false; reason: string };

/** Where the author's Workspace is kept between visits; the browser root chooses the store. */
export interface WorkspaceStorage {
  /** The stored Workspace, or the seed Workspace over `launchRoot` when none can be read. */
  load(launchRoot: ProjectPath): LoadResult;
  save(workspace: Workspace): SaveResult;
}
