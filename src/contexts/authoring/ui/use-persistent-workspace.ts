import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import type { ProjectPath } from "../domain/project-path";
import type { Workspace } from "../application/workspace";
import type { LoadResult, WorkspaceStorage } from "../application/workspace-storage";
import { workspaceReducer, type WorkspaceAction } from "../application/workspace-reducer";

const SAVE_DELAY_MS = 400;

export type SaveStatus =
  | { kind: "loaded"; load: LoadResult }
  | { kind: "pending" }
  | { kind: "saved"; savedAt: string }
  | { kind: "failed"; reason: string };

/**
 * Loading keeps a backup of unreadable data, a write that must happen once. React calls state
 * initializers twice under StrictMode in development, so the first result per storage is reused.
 */
const loads = new WeakMap<WorkspaceStorage, LoadResult>();

function loadOnce(storage: WorkspaceStorage, launchRoot: ProjectPath): LoadResult {
  let result = loads.get(storage);
  if (!result) {
    result = storage.load(launchRoot);
    loads.set(storage, result);
  }
  return result;
}

/** Whether an action changes what is stored in the browser; reading a VocabularyFile changes nothing stored. */
function changesStoredData(action: WorkspaceAction): boolean {
  if (action.type === "vocabulary/loading" || action.type === "vocabulary/failed") return false;
  if (action.type === "vocabulary/loaded") return action.localProposals !== undefined || (action.retargets?.length ?? 0) > 0;
  return true;
}

export function usePersistentWorkspace(launchRoot: ProjectPath, storage: WorkspaceStorage) {
  const [initial] = useState(() => loadOnce(storage, launchRoot));
  const [workspace, rawDispatch] = useReducer(workspaceReducer, initial.workspace);
  const [status, setStatus] = useState<SaveStatus>({ kind: "loaded", load: initial });

  const dirty = useRef(false);
  const latest = useRef<Workspace>(workspace);
  latest.current = workspace;

  const flush = useCallback(() => {
    if (!dirty.current) return;
    dirty.current = false;
    const result = storage.save(latest.current);
    setStatus(result.ok ? { kind: "saved", savedAt: result.savedAt } : { kind: "failed", reason: result.reason });
  }, [storage]);

  const dispatch = useCallback((action: WorkspaceAction) => {
    rawDispatch(action);
    if (!changesStoredData(action)) return;
    dirty.current = true;
    setStatus({ kind: "pending" });
  }, []);

  useEffect(() => {
    if (!dirty.current) return;
    const timer = window.setTimeout(flush, SAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [workspace, flush]);

  useEffect(() => {
    const onHide = () => flush();
    window.addEventListener("pagehide", onHide);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
      document.removeEventListener("visibilitychange", onHide);
    };
  }, [flush]);

  return { workspace, dispatch, status, flush };
}
