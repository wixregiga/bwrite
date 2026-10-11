import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { ConfirmDialog } from "./confirm-dialog";
import { FeatureEditor } from "./feature-editor";
import { type EditorSelection, type FeatureEditorHandle, type SelectionMenuRequest } from "../editor/feature-editor-view";
import { LanguageIcon, SidebarIcon } from "./icons";
import { Logo } from "./logo";
import { PlaceRuleDialog, type PlacementOutcome } from "./place-rule-dialog";
import { ProposalDialog, type ProposalOutcome } from "./proposal-dialog";
import { ReferenceDialog } from "./reference-dialog";
import { SelectionMenu } from "./selection-menu";
import { Sidebar, UNTITLED_FEATURE, type ItemKind, type RenameTarget, type SidebarFocusRequest } from "./sidebar";
import { TitleField } from "./title-field";
import { Toast, type ToastMessage } from "./toast";
import { NewProjectDialog } from "./new-project-dialog";
import {
  VocabularyPanel,
  type Occurrence,
  type PanelTab,
  type RuleStatement,
  type RulesView,
  type VocabularyStatus,
} from "./vocabulary-panel";
import type { ReferenceTargets } from "../editor/domain-references";
import type { EditorTerm, EditorVocabulary } from "../editor/domain-terms";
import type { Classification } from "../domain/classification";
import { cleanFeatureTitle, type Feature } from "../domain/feature";
import { newFeatureId, type FeatureId } from "../domain/feature-id";
import { isReferenceRange, ruleKeyOf, type TermReference } from "../domain/term-reference";
import { ruleLineAt, type RuleLine } from "../domain/gherkin";
import { termIdFor, type TermId } from "../domain/term-id";
import { termProposalOf } from "../domain/term-proposal";
import { type DomainTerm } from "../domain/domain-term";
import { ruleLabel, type PlacedRule, type RuleChange } from "../domain/placed-rule";
import { UNTITLED_PROJECT, nextAvailableName, type Project } from "../domain/project";
import { newProjectId, type ProjectId } from "../domain/project-id";
import type { ProjectPath } from "../domain/project-path";
import type { UbiquitousLanguage } from "../domain/ubiquitous-language";
import type { PlannedWrite, UbiquitousLanguageRepository } from "../domain/ubiquitous-language-repository";
import { languageEdit, type LanguageEdit, type RecordedVocabulary } from "../application/language-document";
import type { ArcLintRule, VocabularyChange } from "../application/vocabulary-document";
import type { ProjectRulesSource } from "../application/project-rules";
import {
  describeReference,
  lineNumberAt,
  overlappingReferences,
  readingWord,
  referenceCue,
  resolveUsages,
  type ReferenceDraft,
} from "../domain/references";
import { cleanTermName, hasWordCharacter } from "../domain/terms";
import { CommandPalette } from "./command-palette";
import { ShortcutsDialog } from "./shortcuts-dialog";
import type { SearchResult } from "../application/search";
import { matchesShortcut, shortcut, shortcutLabel } from "../editor/shortcuts";
import type { LoadResult, WorkspaceStorage } from "../application/workspace-storage";
import { useMediaQuery } from "../../../shared/presentation/use-media-query";
import { usePersistentWorkspace, type SaveStatus } from "./use-persistent-workspace";
import { activeProject, builtLanguageOf, featuresOf, languageOf, openFeatureOf, type Workspace } from "../application/workspace";
import type { WorkspaceAction } from "../application/workspace-reducer";

const SIDEBAR_ID = "project-sidebar";
const PANEL_ID = "language-panel";
/** At these widths a panel sits beside the editor; below them it covers the workspace. */
const SIDEBAR_DOCK_QUERY = "(min-width: 960px)";
const PANEL_DOCK_QUERY = "(min-width: 1200px)";
const LANGUAGE_LABEL = "Ubiquitous Language";
const INSPECT_SHORTCUT = shortcutLabel(shortcut("inspect-term"))!;
const UNDO_SHORTCUT = shortcutLabel(shortcut("undo"))!;
const NO_SELECTION: EditorSelection = { from: 0, to: 0, text: "" };

interface ProposalSource {
  featureId: FeatureId;
  text: string;
}

type PendingDelete =
  | { kind: "project"; id: ProjectId; trigger: HTMLElement }
  | { kind: "feature"; id: FeatureId; trigger: HTMLElement };

/**
 * A change to a project's VocabularyFile, planned and waiting for the author's confirmation,
 * because it changes a file in their repository.
 */
interface PendingWrite {
  project: Project;
  file: string;
  title: string;
  note: string;
  edit: LanguageEdit;
  steps: readonly PlannedWrite[];
  done: string;
  afterSave?: () => void;
}

/** One argument as a shell would need it written. */
function shellWord(word: string): string {
  return /^[\w@%+=:,./-]+$/u.test(word) ? word : `'${word.replace(/'/g, "'\\''")}'`;
}

/**
 * Reads every project's VocabularyFile, and again whenever it changes on disk. A read that
 * finishes after a later one started is dropped, so the language shown is always the newest.
 */
type VocabularyRepository = UbiquitousLanguageRepository<RecordedVocabulary, VocabularyChange>;

function useVocabularies(
  repository: VocabularyRepository,
  projects: readonly Project[],
  dispatch: (action: WorkspaceAction) => void,
) {
  const key = projects.map((p) => `${p.id}\u0000${p.path}`).join("\n");
  const latest = useRef(projects);
  latest.current = projects;
  useEffect(() => {
    const stops = latest.current.map((project) => {
      let reading = 0;
      let active = true;
      const read = async () => {
        const seq = ++reading;
        dispatch({ type: "vocabulary/loading", projectId: project.id });
        const loaded = await repository.load(project);
        if (!active || seq !== reading) return;
        dispatch(
          loaded.ok
            ? { type: "vocabulary/loaded", projectId: project.id, recorded: loaded.value }
            : { type: "vocabulary/failed", projectId: project.id, message: loaded.message },
        );
      };
      void read();
      const stopWatching = repository.watch(project, () => void read());
      return () => {
        active = false;
        stopWatching();
      };
    });
    return () => stops.forEach((stop) => stop());
  }, [key, repository, dispatch]);
}

/** The rules arclint enforces in the active project's folder, read when the folder changes. */
function useRules(loadRules: ProjectRulesSource, path: ProjectPath | null): { kind: "loading" } | { kind: "problem"; message: string } | { kind: "loaded"; rules: readonly ArcLintRule[] } {
  const [state, setState] = useState<{ path: ProjectPath | null; view: ReturnType<typeof useRules> }>({ path: null, view: { kind: "loading" } });
  useEffect(() => {
    if (path === null) return;
    let active = true;
    void loadRules(path).then((answer) => {
      if (!active) return;
      setState({ path, view: answer.ok ? { kind: "loaded", rules: answer.value } : { kind: "problem", message: answer.message } });
    });
    return () => {
      active = false;
    };
  }, [loadRules, path]);
  return state.path === path ? state.view : { kind: "loading" };
}

function vocabularyStatus(ws: Workspace, projectId: ProjectId, onCreate: () => void): VocabularyStatus {
  const state = ws.vocabularies[projectId];
  if (!state || state.kind === "loading") return { kind: "loading" };
  if (state.kind === "problem") return { kind: "problem", message: state.message };
  const { file, document } = state.built.source;
  if (!file.found || document === null) return { kind: "missing", file: file.file, format: file.format, onCreate };
  return { kind: "ready" };
}

/** The occurrence the association dialog is open for. */
interface ReferenceTarget {
  featureId: FeatureId;
  from: number;
  to: number;
}

/** The Rule line the place rule dialog is open for. */
interface RuleTarget extends RuleLine {
  featureId: FeatureId;
}

const timeFormat = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" });

type StatusText = { text: string; tone: "quiet" | "busy" | "error" };

function describeLoad(load: LoadResult): StatusText {
  switch (load.kind) {
    case "restored":
      return { text: `Restored · saved ${timeFormat.format(new Date(load.savedAt))}`, tone: "quiet" };
    case "seeded":
      return { text: "New workspace", tone: "quiet" };
    case "unreadable":
      return { text: "Saved data unreadable · started fresh", tone: "error" };
  }
}

function statusText(status: SaveStatus): StatusText {
  switch (status.kind) {
    case "loaded":
      return describeLoad(status.load);
    case "pending":
      return { text: "Saving…", tone: "busy" };
    case "saved":
      return { text: `Saved in this browser · ${timeFormat.format(new Date(status.savedAt))}`, tone: "quiet" };
    case "failed":
      return { text: "Not saved: browser storage unavailable", tone: "error" };
  }
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** The rule reference that covers exactly a Rule line's text, when the rule is placed. */
function placedRuleReference(feature: Feature, line: RuleLine): TermReference | undefined {
  return feature.references.find((r) => r.from === line.from && r.to === line.to && r.reading.kind === "rule");
}

export interface AuthoringWorkspaceProps {
  /** The folder BWrite was started in; the first project's path, and every new project's default. */
  launchRoot: ProjectPath;
  /** Every folder BWrite may read, the launch root first. */
  roots: readonly string[];
  repository: VocabularyRepository;
  /** Where the Workspace is kept between visits. */
  storage: WorkspaceStorage;
  /** Reads the architecture rules that bind a Project. */
  rulesSource: ProjectRulesSource;
}

export function AuthoringWorkspace({ launchRoot, roots, repository, storage, rulesSource }: AuthoringWorkspaceProps) {
  const { workspace, dispatch, status } = usePersistentWorkspace(launchRoot, storage);
  useVocabularies(repository, workspace.projects, dispatch);
  const project = activeProject(workspace);
  const projectId = project?.id ?? null;
  const feature = project ? openFeatureOf(workspace, project.id) : null;
  const language = project ? languageOf(workspace, project.id) : null;
  const latestWorkspace = useRef(workspace);
  latestWorkspace.current = workspace;

  const { features } = workspace;
  const projectFeatures = useMemo(() => (projectId ? featuresOf(features, projectId) : []), [features, projectId]);
  const projectName = project?.name ?? "";

  // Keyed on the language, so title and text edits keep the same vocabulary identity.
  const editorVocabulary = useMemo<EditorVocabulary | null>(() => {
    if (!language) return null;
    const terms = new Map<TermId, EditorTerm>(
      language.terms.map((t) => [
        t.id,
        {
          id: t.id,
          name: t.name,
          definition: t.definition,
          status: t.status,
          kind: t.classification?.kind ?? null,
          containers: language.qualifiedName(t.id).containers,
        },
      ]),
    );
    return {
      languageName: `${LANGUAGE_LABEL} · ${projectName}`,
      acceptedTerms: language.acceptedTerms(),
      terms,
      referenceCue: (reference) => referenceCue(reference, language),
      readingWord: (reference) => readingWord(reference, language),
      describeReference: (reference) => describeReference(reference, language),
    };
  }, [language, projectName]);

  const referenceTargets = useMemo<ReferenceTargets>(
    () => (language?.file ? new Map(language.terms.map((t) => [t.id, new Set(t.rules.map((r) => r.key))])) : null),
    [language],
  );

  const sidebarDocked = useMediaQuery(SIDEBAR_DOCK_QUERY);
  const panelDocked = useMediaQuery(PANEL_DOCK_QUERY);

  const editorRef = useRef<FeatureEditorHandle>(null);
  const sidebarToggleRef = useRef<HTMLButtonElement>(null);
  const panelToggleRef = useRef<HTMLButtonElement>(null);
  const focusTitleOnOpen = useRef(false);
  const [selection, setSelection] = useState<EditorSelection>(NO_SELECTION);
  const [menu, setMenu] = useState<SelectionMenuRequest | null>(null);
  const [proposalSource, setProposalSource] = useState<ProposalSource | null>(null);
  const [referenceTarget, setReferenceTarget] = useState<ReferenceTarget | null>(null);
  const [ruleTarget, setRuleTarget] = useState<RuleTarget | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(() => window.matchMedia(SIDEBAR_DOCK_QUERY).matches);
  const [sidebarFocusRequest, setSidebarFocusRequest] = useState<SidebarFocusRequest>(null);
  const [renaming, setRenaming] = useState<RenameTarget>(null);
  const [panelOpen, setPanelOpen] = useState(() => window.matchMedia(PANEL_DOCK_QUERY).matches);
  const [panelTab, setPanelTab] = useState<PanelTab>("accepted");
  const [panelSelection, setPanelSelection] = useState<TermId | null>(null);
  /** The TermId each moved term's details were opened under, by its current TermId. */
  const detailKeys = useRef(new Map<TermId, TermId>());
  const [panelFocusRequest, setPanelFocusRequest] = useState(0);
  const [recentTermId, setRecentTermId] = useState<TermId | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const [pendingWrite, setPendingWrite] = useState<PendingWrite | null>(null);
  const [afterSave, setAfterSave] = useState<{ run: () => void } | null>(null);
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const rules = useRules(rulesSource, project?.path ?? null);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const toastSeq = useRef(0);
  const [commandDialog, setCommandDialog] = useState<"search" | "shortcuts" | null>(null);
  const [searchDestination, setSearchDestination] = useState<SearchResult | null>(null);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      for (const id of ["search", "shortcuts"] as const) {
        if (matchesShortcut(event, shortcut(id))) {
          event.preventDefault();
          event.stopPropagation();
          setCommandDialog(id);
          return;
        }
      }
    };
    window.addEventListener("keydown", handleKey, true);
    return () => window.removeEventListener("keydown", handleKey, true);
  }, []);

  const sidebarOverlay = sidebarOpen && !sidebarDocked;
  const panelOverlay = panelOpen && !panelDocked && project !== null;

  // State that belongs to one feature or one project is reset when it changes.
  const featureId = feature?.id ?? null;
  const [shownFeatureId, setShownFeatureId] = useState(featureId);
  if (shownFeatureId !== featureId) {
    setShownFeatureId(featureId);
    setSelection(NO_SELECTION);
    setMenu(null);
  }
  const [shownProjectId, setShownProjectId] = useState(projectId);
  if (shownProjectId !== projectId) {
    setShownProjectId(projectId);
    setPanelSelection(null);
    setRecentTermId(null);
  }

  const notify = useCallback((text: string, tone: ToastMessage["tone"] = "info", action?: ToastMessage["action"]) => {
    toastSeq.current += 1;
    setToast({ id: toastSeq.current, text, tone, action });
  }, []);
  const dismissToast = useCallback(() => setToast(null), []);

  useEffect(() => {
    if (status.kind !== "loaded") return;
    const load = status.load;
    if (load.kind === "unreadable") {
      notify(
        load.backupKey
          ? `Saved data could not be read (${load.reason}). A copy was kept in browser storage as “${load.backupKey}”.`
          : `Saved data could not be read (${load.reason}).`,
        "error",
      );
    }
    // Only the initial load result is reported here.
  }, []);

  useEffect(() => {
    if (status.kind === "failed") notify(`Changes could not be saved: ${status.reason}`, "error");
  }, [status, notify]);

  useEffect(() => {
    document.title = project ? `${project.name} · BWrite` : "BWrite";
  }, [project?.name]);

  // A panel that was docked would otherwise turn into an overlay covering the editor.
  useEffect(() => {
    if (!sidebarDocked) setSidebarOpen(false);
  }, [sidebarDocked]);
  useEffect(() => {
    if (!panelDocked) setPanelOpen(false);
  }, [panelDocked]);

  useEffect(() => {
    if (!focusTitleOnOpen.current || !featureId) return;
    focusTitleOnOpen.current = false;
    document.getElementById("feature-title")?.focus();
  }, [featureId]);

  const isSidebarDocked = () => window.matchMedia(SIDEBAR_DOCK_QUERY).matches;
  const isPanelDocked = () => window.matchMedia(PANEL_DOCK_QUERY).matches;

  /** Opens the sidebar. As an overlay it covers the workspace, so it takes focus and the other overlay closes. */
  const openSidebar = (focus: ItemKind = "project") => {
    setSidebarOpen(true);
    if (isSidebarDocked()) return;
    if (!isPanelDocked()) setPanelOpen(false);
    setSidebarFocusRequest((r) => ({ seq: (r?.seq ?? 0) + 1, kind: focus }));
  };

  const closeSidebar = () => {
    setSidebarOpen(false);
    setRenaming(null);
    sidebarToggleRef.current?.focus();
  };

  const openPanel = (termToShow: TermId | null = panelSelection) => {
    setMenu(null);
    setPanelOpen(true);
    setPanelSelection(termToShow);
    if (!isPanelDocked() && !isSidebarDocked()) setSidebarOpen(false);
    // Details opened from the editor and overlays take focus; a docked list leaves it in place.
    if (termToShow || !isPanelDocked()) setPanelFocusRequest((n) => n + 1);
  };

  const closePanel = () => {
    setPanelOpen(false);
    panelToggleRef.current?.focus();
  };

  const closeOverlays = () => {
    if (sidebarOverlay) closeSidebar();
    if (panelOverlay) closePanel();
  };

  const canPropose = selection.from !== selection.to && hasWordCharacter(selection.text);
  const canAssociate = feature !== null && isReferenceRange(feature.body, selection.from, selection.to);
  const cursorRuleLine = feature ? ruleLineAt(feature.body, selection.from) : null;
  const canPlaceRule =
    feature !== null && cursorRuleLine !== null && cursorRuleLine.text.length > 0 && !placedRuleReference(feature, cursorRuleLine);

  const openTerm = useCallback((termId: TermId) => {
    setMenu(null);
    setPanelOpen(true);
    setPanelSelection(termId);
    if (!window.matchMedia(PANEL_DOCK_QUERY).matches && !window.matchMedia(SIDEBAR_DOCK_QUERY).matches) {
      setSidebarOpen(false);
    }
    setPanelFocusRequest((n) => n + 1);
  }, []);

  const chooseSearchResult = (result: SearchResult) => {
    setCommandDialog(null);
    setMenu(null);
    setProposalSource(null);
    setReferenceTarget(null);
    setRuleTarget(null);
    setPendingDelete(null);
    setSearchDestination(result);
    dispatch({ type: "project/selected", projectId: result.projectId });
    if (result.category === "features") dispatch({ type: "feature/selected", featureId: result.featureId });
  };

  useEffect(() => {
    if (!searchDestination || projectId !== searchDestination.projectId) return;
    if (searchDestination.category === "features" && featureId !== searchDestination.featureId) return;
    const result = searchDestination;
    // Focus after the destination editor has completed its mount, including StrictMode's
    // setup cycle. Its CodeMirror view is created in an effect.
    const frame = requestAnimationFrame(() => {
      setSearchDestination(null);
      if (result.category === "terms" || result.category === "rules") {
        openTerm(result.termId);
        setPanelTab(language?.term(result.termId)?.status === "proposed" ? "proposed" : "accepted");
      } else {
        if (!window.matchMedia(SIDEBAR_DOCK_QUERY).matches) setSidebarOpen(false);
        if (!window.matchMedia(PANEL_DOCK_QUERY).matches) setPanelOpen(false);
        if (result.category === "features") editorRef.current?.select(result.from, result.from);
        else if (editorRef.current) editorRef.current.focus();
        else sidebarToggleRef.current?.focus();
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [searchDestination, projectId, featureId, language, openTerm]);

  // Projects

  const handleCreateProject = () => setNewProjectOpen(true);

  const createProject = (name: string, path: ProjectPath) => {
    dispatch({ type: "project/created", projectId: newProjectId(), name, path });
    setSidebarOpen(true);
    if (!isSidebarDocked() && !isPanelDocked()) setPanelOpen(false);
  };

  // Writing the VocabularyFile

  const featureTitle = (id: FeatureId) => latestWorkspace.current.features.find((f) => f.id === id)?.title ?? null;

  /** Keeps the panel on the term it shows, in the same details, when a change gives that term a new TermId. */
  const followRetargets = (retargets: readonly (readonly [TermId, TermId])[]) => {
    if (retargets.length === 0) return;
    const moved = new Map(retargets);
    for (const [from, to] of retargets) detailKeys.current.set(to, detailKeys.current.get(from) ?? from);
    setPanelSelection((shown) => (shown === null ? null : (moved.get(shown) ?? shown)));
    setRecentTermId((recent) => (recent === null ? null : (moved.get(recent) ?? recent)));
  };

  /**
   * Brings the project's sources in step with `after`, a language one command made. Proposed
   * terms BWrite keeps itself change at once; a change to the VocabularyFile is planned first
   * and waits for the author to confirm the steps.
   */
  const write = async (
    target: Project,
    after: UbiquitousLanguage,
    request: { title: string; note: string; done: string; afterSave?: () => void },
  ): Promise<void> => {
    const built = builtLanguageOf(latestWorkspace.current, target.id);
    if (!built) {
      notify("This project's vocabulary file has not been read yet.", "error");
      return;
    }
    const edit = languageEdit(built, after, featureTitle);
    if (edit.changes.length === 0) {
      dispatch({ type: "vocabulary/local", projectId: target.id, localProposals: edit.localProposals, retargets: edit.retargets });
      followRetargets(edit.retargets);
      request.afterSave?.();
      notify(request.done, "success");
      return;
    }
    const planned = await repository.plan(target, edit.changes);
    if (!planned.ok) {
      notify(planned.message, "error");
      return;
    }
    setPendingWrite({ project: target, file: built.source.file.file, ...request, edit, steps: planned.value });
  };

  const finishWrite = async (confirmed: boolean) => {
    const pending = pendingWrite!;
    setPendingWrite(null);
    if (!confirmed) return;
    const saved = await repository.save(pending.project, pending.edit.changes);
    if (!saved.ok) {
      notify(saved.message, "error");
      return;
    }
    dispatch({
      type: "vocabulary/loaded",
      projectId: pending.project.id,
      recorded: saved.value,
      localProposals: pending.edit.localProposals,
      retargets: pending.edit.retargets,
    });
    followRetargets(pending.edit.retargets);
    if (pending.afterSave) setAfterSave({ run: pending.afterSave });
    notify(pending.done, "success");
  };

  // Runs once the language read back after a save is the one the editor and the panel see.
  useEffect(() => {
    if (!afterSave) return;
    setAfterSave(null);
    afterSave.run();
  }, [afterSave, workspace]);

  const createVocabularyFile = async () => {
    if (!project) return;
    const state = workspace.vocabularies[project.id];
    if (state?.kind !== "loaded") return;
    const created = await repository.create(project, state.built.source.file.format);
    if (!created.ok) {
      notify(created.message, "error");
      return;
    }
    dispatch({ type: "vocabulary/loaded", projectId: project.id, recorded: created.value });
    notify(`Created ${created.value.file.file} in ${project.path}.`, "success");
  };

  const handleRenameProject = (id: ProjectId, raw: string): string | undefined => {
    const renamed = workspace.projects.find((p) => p.id === id)?.rename(raw);
    if (!renamed) return undefined;
    if (!renamed.ok) return renamed.error.message;
    dispatch({ type: "project/renamed", projectId: id, name: raw });
    return undefined;
  };

  const handleSelectProject = (id: ProjectId) => {
    if (id !== projectId) dispatch({ type: "project/selected", projectId: id });
  };

  // Features

  const handleCreateFeature = () => {
    if (!project) return;
    focusTitleOnOpen.current = true;
    dispatch({ type: "feature/created", projectId: project.id, featureId: newFeatureId() });
    if (!isSidebarDocked()) setSidebarOpen(false);
  };

  const handleSelectFeature = (id: FeatureId) => {
    dispatch({ type: "feature/selected", featureId: id });
    if (!isSidebarDocked()) {
      setSidebarOpen(false);
      requestAnimationFrame(() => editorRef.current?.focus());
    }
  };

  // Deletion and removal

  const finishDelete = (confirmed: boolean) => {
    const target = pendingDelete!;
    setPendingDelete(null);
    if (!confirmed) {
      if (target.trigger.isConnected) target.trigger.focus();
      return;
    }
    if (target.kind === "project") dispatch({ type: "project/deleted", projectId: target.id });
    else dispatch({ type: "feature/deleted", featureId: target.id });
    setSidebarFocusRequest((r) => ({ seq: (r?.seq ?? 0) + 1, kind: target.kind }));
  };

  const deleteDialog = (): { title: string; confirmLabel: string; body: ReactNode } | null => {
    if (!pendingDelete) return null;
    if (pendingDelete.kind === "project") {
      const doomed = workspace.projects.find((p) => p.id === pendingDelete.id);
      if (!doomed) return null;
      const featureCount = featuresOf(workspace.features, doomed.id).length;
      const localCount = workspace.localProposals[doomed.id]?.length ?? 0;
      return {
        title: `Delete project “${doomed.name}”?`,
        confirmLabel: "Delete project",
        body: (
          <p>
            This removes {plural(featureCount, "feature", "features")}
            {localCount > 0 ? ` and ${plural(localCount, "proposed term", "proposed terms")} kept in this browser` : ""} from
            this browser. Its vocabulary file in {doomed.path} stays as it is. It cannot be undone.
          </p>
        ),
      };
    }
    const doomed = workspace.features.find((f) => f.id === pendingDelete.id);
    if (!doomed) return null;
    return {
      title: `Delete feature “${doomed.title.trim() || UNTITLED_FEATURE}”?`,
      confirmLabel: "Delete feature",
      body: (
        <p>
          Its text and domain associations are removed from this browser and cannot be recovered. Terms are not
          affected, and terms proposed from it keep their proposal.
        </p>
      ),
    };
  };

  // Proposals

  const openProposalForm = () => {
    setMenu(null);
    if (!feature) return;
    if (!canPropose) {
      notify("Select a word or phrase in the feature body to propose it as a term.");
      editorRef.current?.focus();
      return;
    }
    setProposalSource({ featureId: feature.id, text: selection.text });
  };

  const submitProposal = (name: string, definition: string, classification: Classification | null): ProposalOutcome | null => {
    const source = proposalSource!;
    const problems = language!.proposalProblems({ name, definition, classification });
    if (problems.name || problems.definition) return { problems, refusal: null };
    if (!language!.file) return { problems: {}, refusal: "This project's vocabulary file has not been read yet." };
    if (language!.file.holdsProposals && !language!.file.found) {
      return { problems: {}, refusal: `Create ${language!.file.file} first: this project has no vocabulary file yet.` };
    }
    const termId = termIdFor(language!.contextOf(classification)?.name, cleanTermName(name));
    const proposal = termProposalOf(source.featureId, source.text, new Date());
    const draft = { name, definition, classification };
    const proposed = language!.propose(draft, termId, proposal);
    if (!proposed.ok) return { problems: {}, refusal: proposed.error.message };
    const kept = language!.file.holdsProposals ? language!.file.file : "this browser, until it is recorded";
    void write(project!, proposed.value, {
      title: `Propose “${cleanTermName(name)}” in ${language!.file.file}?`,
      note: "The term is added as proposed. It is not recognized in features until it is recorded as accepted.",
      done: `Proposed “${cleanTermName(name)}”, kept in ${kept}. It stays proposed and is not highlighted as an accepted term.`,
      afterSave: () => {
        setPanelTab("proposed");
        setPanelSelection(null);
        setRecentTermId(termId);
        if (!panelOpen) openPanel(null);
      },
    });
    return null;
  };

  // Classification

  const classify = (termId: TermId, classification: Classification | null): string | null => {
    const classified = language!.classify(termId, classification);
    if (!classified.ok) return classified.error.message;
    const term = language!.term(termId)!;
    void write(project!, classified.value, {
      title: `Classify “${term.name}” in ${language!.file?.file ?? "the vocabulary file"}?`,
      note: "The term's kind and its place in the model change.",
      done: `Classified “${term.name}”.`,
    });
    return null;
  };

  const record = (termId: TermId): string | null => {
    const term = language!.term(termId);
    if (!term) return "That term is no longer in this Ubiquitous Language.";
    const recorded = language!.record(termId, term.classification);
    if (!recorded.ok) return recorded.error.message;
    void write(project!, recorded.value, {
      title: `Record “${term.name}” in ${language!.file!.file}?`,
      note: "The term becomes an accepted term of the vocabulary, recognized by name in every feature.",
      done: `Recorded “${term.name}” in ${language!.file!.file}.`,
      afterSave: () => setPanelTab("accepted"),
    });
    return null;
  };

  const removeRule = (termId: TermId, rule: PlacedRule) => {
    const term = language!.term(termId);
    const removed = language!.removeRule(termId, rule.key);
    if (!term || !removed.ok) {
      notify(removed.ok ? "That term is no longer in this Ubiquitous Language." : removed.error.message, "error");
      return;
    }
    const stating = projectFeatures.filter((f) => f.ruleReferences(termId, rule.key).length > 0);
    const lines = stating.reduce((n, f) => n + f.ruleReferences(termId, rule.key).length, 0);
    const targetProject = project!;
    void write(targetProject, removed.value, {
      title: `Remove ${ruleLabel(rule)} “${rule.key}” from ${term.name}?`,
      note: `Its statement leaves the Ubiquitous Language. ${
        lines === 0
          ? "No Rule line states it now."
          : `${plural(lines, "Rule line", "Rule lines")} in ${plural(stating.length, "feature", "features")} that state it stop being tied to it.`
      } The text of every feature stays as written.`,
      done: `Removed ${ruleLabel(rule)} “${rule.key}”. The text of every feature stays as written.`,
      afterSave: () => dispatch({ type: "rule/untied", projectId: targetProject.id, termId, ruleKey: rule.key }),
    });
  };

  // Associations

  const openReferenceForm = (target?: TermReference) => {
    setMenu(null);
    if (!feature) return;
    const range = target ?? selection;
    if (!isReferenceRange(feature.body, range.from, range.to)) {
      notify("Select a word or phrase on one line of the feature to associate it with a domain concept.");
      editorRef.current?.focus();
      return;
    }
    setReferenceTarget({ featureId: feature.id, from: range.from, to: range.to });
  };

  const applyReference = (draft: ReferenceDraft | null, wording: string | null) => {
    const target = referenceTarget!;
    editorRef.current?.applyReference(target.from, target.to, draft, wording);
    if (!draft) notify("Association removed. The text is unchanged.");
    else if (wording !== null) notify(`Text replaced with “${wording}”. ${UNDO_SHORTCUT} restores it.`, "success");
  };

  // Rules

  const openRuleForm = (pos: number = selection.from) => {
    setMenu(null);
    if (!feature || !language) return;
    const line = ruleLineAt(feature.body, pos);
    if (!line) {
      notify("Put the cursor on a line that starts with “Rule:” to place that rule on a term.");
      editorRef.current?.focus();
      return;
    }
    if (line.text.length === 0 || !hasWordCharacter(line.text)) {
      notify("Write the rule after “Rule:” first.");
      editorRef.current?.focus();
      return;
    }
    const placed = placedRuleReference(feature, line);
    if (placed) {
      const term = language.term(placed.termId);
      const rule = language.rule(placed.termId, ruleKeyOf(placed)!);
      notify(
        `This Rule is already placed as ${rule ? ruleLabel(rule) : "a rule"} “${ruleKeyOf(placed)}” of ${term?.name ?? "a term"}. Remove it from that term's details to place it again.`,
      );
      editorRef.current?.focus();
      return;
    }
    setRuleTarget({ ...line, featureId: feature.id });
  };

  const placeRule = (termId: TermId, rule: PlacedRule): PlacementOutcome | null => {
    const target = ruleTarget!;
    const placed = language!.placeRule(termId, rule);
    if (!placed.ok) return { reason: placed.error.message, concerns: placed.error.concerns };
    const termName = language!.term(termId)?.name;
    void write(project!, placed.value, {
      title: `Place ${ruleLabel(rule)} “${rule.key}” on ${termName}?`,
      note: `“${rule.statement}”`,
      done: `Placed ${ruleLabel(rule)} “${rule.key}” on ${termName}. ${UNDO_SHORTCUT} unties the line; the rule stays recorded.`,
      afterSave: () => editorRef.current?.placeRule(target.from, target.to, termId, rule),
    });
    return null;
  };

  /**
   * Asked by the editor before a step ties a Rule line to a rule, including a redo. The rule is
   * placed in the VocabularyFile before the line is tied, so a step ties only a rule the
   * language holds; undoing a step unties the line and leaves the file as it is.
   */
  const ruleRefusal = useCallback((change: RuleChange): string | null => {
    if (change.kind === "removed") return null;
    const ws = latestWorkspace.current;
    const projectOfEditor = activeProject(ws);
    if (!projectOfEditor) return "There is no project to place the rule in.";
    return languageOf(ws, projectOfEditor.id).rule(change.termId, change.rule.key)
      ? null
      : "That rule is no longer in this Ubiquitous Language.";
  }, []);

  const handleInspectMiss = () => {
    if (feature && ruleLineAt(feature.body, selection.from)) openRuleForm(selection.from);
    else notify("Place the cursor inside a highlighted term or association to inspect it.");
  };

  const occurrencesOf = (termId: TermId): Occurrence[] => {
    if (!feature || !language) return [];
    const text = feature.body;
    return resolveUsages(text, language.acceptedTerms(), feature.references)
      .filter((m) => m.termId === termId)
      .map((m) => {
        const lineStart = text.lastIndexOf("\n", m.from - 1) + 1;
        const lineEndIndex = text.indexOf("\n", m.to);
        const lineEnd = lineEndIndex === -1 ? text.length : lineEndIndex;
        return {
          from: m.from,
          to: m.to,
          line: lineNumberAt(text, m.from),
          before: text.slice(lineStart, m.from).trimStart(),
          text: text.slice(m.from, m.to),
          after: text.slice(m.to, lineEnd).trimEnd(),
          association: m.kind === "reference" ? describeReference(m.reference, language) : null,
        };
      });
  };

  const statementsOf = (termId: TermId, ruleKey: string): RuleStatement[] =>
    projectFeatures.flatMap((f) =>
      f.ruleReferences(termId, ruleKey).map((r) => ({
        featureId: f.id,
        featureTitle: f.title.trim() || UNTITLED_FEATURE,
        line: lineNumberAt(f.body, r.from),
        from: r.from,
        to: r.to,
        inOpenFeature: f.id === featureId,
      })),
    );

  const jumpTo = (from: number, to: number) => {
    if (!isPanelDocked()) setPanelOpen(false);
    editorRef.current?.select(from, to);
  };

  const saveStatus = statusText(status);
  const dialog = deleteDialog();
  const proposedCount = language?.proposedTerms().length ?? 0;

  return (
    <div className="bw-app">
      <header className="bw-topbar">
        <button
          ref={sidebarToggleRef}
          type="button"
          className="bw-icon-button bw-topbar__toggle"
          aria-label="Projects and features"
          title={sidebarOpen ? "Hide projects and features" : "Show projects and features"}
          aria-expanded={sidebarOpen}
          aria-controls={SIDEBAR_ID}
          onClick={() => (sidebarOpen ? closeSidebar() : openSidebar())}
        >
          <SidebarIcon />
        </button>
        <div className="bw-brand">
          <Logo />
          <span className="bw-brand__app" aria-hidden="true">
            BWrite
          </span>
          <span className="bw-brand__divider" aria-hidden="true">
            /
          </span>
          <span
            className={`bw-brand__project${project ? "" : " is-empty"}`}
            data-testid="active-project"
            title={project?.description || undefined}
          >
            {project ? project.name : "No project"}
          </span>
        </div>
        <div className="bw-topbar__commands">
          <button type="button" className="bw-button bw-button--quiet" title={`Search all projects (${shortcutLabel(shortcut("search"))})`} onClick={() => setCommandDialog("search")}>Search</button>
          <button type="button" className="bw-button bw-button--quiet" title={`Display shortcuts (${shortcutLabel(shortcut("shortcuts"))})`} onClick={() => setCommandDialog("shortcuts")}>Shortcuts</button>
        </div>
        <button
          ref={panelToggleRef}
          type="button"
          className="bw-button bw-button--quiet bw-topbar__language"
          aria-expanded={panelOpen && project !== null}
          aria-controls={PANEL_ID}
          disabled={!project}
          onClick={() => (panelOpen ? closePanel() : openPanel())}
        >
          <LanguageIcon />
          <span className="bw-topbar__language-label">{LANGUAGE_LABEL}</span>
          {proposedCount > 0 && (
            <span className="bw-badge bw-badge--proposed" aria-label={`${proposedCount} proposed`}>
              {proposedCount}
            </span>
          )}
        </button>
      </header>

      <div className="bw-body">
        <Sidebar
          id={SIDEBAR_ID}
          open={sidebarOpen}
          overlay={!sidebarDocked}
          projects={workspace.projects}
          activeProjectId={projectId}
          features={projectFeatures}
          openFeatureId={featureId}
          renaming={renaming}
          onRenamingChange={setRenaming}
          focusRequest={sidebarFocusRequest}
          onCreateProject={handleCreateProject}
          onSelectProject={handleSelectProject}
          onRenameProject={handleRenameProject}
          onDeleteProject={(id, trigger) => setPendingDelete({ kind: "project", id, trigger })}
          onCreateFeature={handleCreateFeature}
          onSelectFeature={handleSelectFeature}
          onRenameFeature={(id, title) => dispatch({ type: "feature/retitled", featureId: id, title: cleanFeatureTitle(title) })}
          onDeleteFeature={(id, trigger) => setPendingDelete({ kind: "feature", id, trigger })}
          onClose={closeSidebar}
        />

        <main className="bw-workspace">
          {!project ? (
            <EmptyState
              title="No projects yet"
              body="A project is the product you are describing. It holds its own features and its own Ubiquitous Language."
              action="New project"
              onAction={handleCreateProject}
            />
          ) : !feature || !editorVocabulary ? (
            <EmptyState
              title={`No features in ${project.name}`}
              body="Create a feature to start writing scenarios in this project's Ubiquitous Language."
              action="New feature"
              onAction={handleCreateFeature}
            />
          ) : (
            <EditorCard
              key={feature.id}
              feature={feature}
              project={project}
              editorRef={editorRef}
              editorVocabulary={editorVocabulary}
              referenceTargets={referenceTargets}
              terms={language?.terms ?? []}
              canPropose={canPropose}
              canAssociate={canAssociate}
              canPlaceRule={canPlaceRule}
              saveStatus={saveStatus}
              onTitleChange={(title) => dispatch({ type: "feature/retitled", featureId: feature.id, title })}
              onEdit={(body, references) => dispatch({ type: "feature/edited", featureId: feature.id, body, references })}
              onSelectionChange={setSelection}
              onOpenTerm={openTerm}
              onEditReference={openReferenceForm}
              onPlaceRuleAt={openRuleForm}
              onInspectMiss={handleInspectMiss}
              onRequestSelectionMenu={setMenu}
              onPropose={openProposalForm}
              onAssociate={() => openReferenceForm()}
              onPlaceRule={() => openRuleForm()}
              ruleRefusal={ruleRefusal}
              onRuleRefused={(reason) => notify(`The rule was not placed. ${reason}`, "error")}
            />
          )}
        </main>

        {project && language && (
          <VocabularyPanel
            id={PANEL_ID}
            open={panelOpen}
            overlay={!panelDocked}
            projectName={project.name}
            language={language}
            fileLabel={language.file ? `Vocabulary: ${language.file.file} (${language.file.format})` : null}
            status={vocabularyStatus(workspace, project.id, () => void createVocabularyFile())}
            questions={builtLanguageOf(workspace, project.id)?.source.document?.questions ?? []}
            rules={rulesView(rules, language)}
            tab={panelTab}
            selection={panelSelection}
            detailKey={panelSelection === null ? null : (detailKeys.current.get(panelSelection) ?? panelSelection)}
            focusRequest={panelFocusRequest}
            recentTermId={recentTermId}
            featureTitleById={(id) => workspace.features.find((f) => f.id === id)?.title ?? null}
            occurrencesOf={occurrencesOf}
            statementsOf={statementsOf}
            onTabChange={setPanelTab}
            onSelect={setPanelSelection}
            onJumpTo={jumpTo}
            onClassify={classify}
            onRecord={record}
            onRemoveRule={(termId, rule) => removeRule(termId, rule)}
            onClose={closePanel}
          />
        )}

        {(sidebarOverlay || panelOverlay) && <div className="bw-scrim" aria-hidden="true" onClick={closeOverlays} />}
      </div>

      {menu && (
        <SelectionMenu
          x={menu.x}
          y={menu.y}
          onPropose={openProposalForm}
          onAssociate={() => openReferenceForm()}
          onPlaceRule={canPlaceRule ? () => openRuleForm() : undefined}
          onDismiss={() => {
            setMenu(null);
            editorRef.current?.focus();
          }}
        />
      )}

      {proposalSource && feature && project && language && (
        <ProposalDialog
          initialName={cleanTermName(proposalSource.text)}
          sourceText={proposalSource.text}
          featureTitle={feature.title}
          projectName={project.name}
          language={language}
          onSubmit={submitProposal}
          onClosed={() => {
            setProposalSource(null);
            editorRef.current?.focus();
          }}
        />
      )}

      {referenceTarget && feature && language && referenceTarget.featureId === feature.id && (
        <ReferenceDialog
          body={feature.body}
          from={referenceTarget.from}
          to={referenceTarget.to}
          existing={
            feature.references.find((r) => r.from === referenceTarget.from && r.to === referenceTarget.to) ?? null
          }
          replaced={overlappingReferences(feature.references, referenceTarget.from, referenceTarget.to).filter(
            (r) => r.from !== referenceTarget.from || r.to !== referenceTarget.to,
          )}
          language={language}
          undoShortcut={UNDO_SHORTCUT}
          onApply={applyReference}
          onClosed={() => {
            setReferenceTarget(null);
            editorRef.current?.focus();
          }}
        />
      )}

      {ruleTarget && feature && language && ruleTarget.featureId === feature.id && (
        <PlaceRuleDialog
          ruleText={ruleTarget.text}
          line={ruleTarget.line}
          language={language}
          replaced={overlappingReferences(feature.references, ruleTarget.from, ruleTarget.to).map((r) =>
            feature.body.slice(r.from, r.to),
          )}
          undoShortcut={UNDO_SHORTCUT}
          onPlace={placeRule}
          onClosed={() => {
            setRuleTarget(null);
            editorRef.current?.focus();
          }}
        />
      )}

      {pendingWrite && (
        <ConfirmDialog title={pendingWrite.title} confirmLabel="Apply" onClosed={(confirmed) => void finishWrite(confirmed)}>
          <p>{pendingWrite.note}</p>
          <p>
            This changes <code>{pendingWrite.file}</code> in {pendingWrite.project.path}, a file in your repository, in these
            steps:
          </p>
          <ol className="bw-plan-steps" data-testid="planned-steps">
            {pendingWrite.steps.map((step, index) => (
              <li key={index}>
                {step.description}
                {step.command && <code>arclint {step.command.map(shellWord).join(" ")}</code>}
              </li>
            ))}
          </ol>
        </ConfirmDialog>
      )}

      {newProjectOpen && (
        <NewProjectDialog
          initialName={nextAvailableName(UNTITLED_PROJECT, workspace.projects.map((p) => p.name))}
          launchRoot={launchRoot}
          roots={roots}
          onCreate={createProject}
          onClosed={() => setNewProjectOpen(false)}
        />
      )}

      {commandDialog === "shortcuts" && <ShortcutsDialog onClosed={() => setCommandDialog(null)} />}
      {commandDialog === "search" && <CommandPalette workspace={workspace} onChoose={chooseSearchResult} onClosed={() => setCommandDialog(null)} />}
      {pendingDelete && dialog && (
        <ConfirmDialog title={dialog.title} confirmLabel={dialog.confirmLabel} onClosed={finishDelete}>
          {dialog.body}
        </ConfirmDialog>
      )}

      <Toast message={toast} onDismiss={dismissToast} />
    </div>
  );
}

/** The Rules tab's view: arclint's rules for a folder set up for arclint, an empty state for BWrite's format. */
function rulesView(rules: ReturnType<typeof useRules>, language: UbiquitousLanguage): RulesView {
  if (rules.kind !== "loaded") return rules;
  const format = language.file?.format ?? (rules.rules.length > 0 ? "arclint" : "bwrite");
  return { kind: "loaded", format, rules: rules.rules };
}

function EmptyState(props: { title: string; body: string; action: string; onAction(): void }) {
  return (
    <section className="bw-empty" aria-labelledby="empty-title">
      <h1 id="empty-title" className="bw-empty__title">
        {props.title}
      </h1>
      <p className="bw-empty__body">{props.body}</p>
      <button type="button" className="bw-button bw-button--primary" onClick={props.onAction}>
        {props.action}
      </button>
    </section>
  );
}

interface EditorCardProps {
  feature: Feature;
  project: Project;
  editorRef: RefObject<FeatureEditorHandle | null>;
  editorVocabulary: EditorVocabulary;
  referenceTargets: ReferenceTargets;
  terms: readonly DomainTerm[];
  canPropose: boolean;
  canAssociate: boolean;
  canPlaceRule: boolean;
  saveStatus: StatusText;
  onTitleChange(title: string): void;
  onEdit(body: string, references: TermReference[], ruleChanges: RuleChange[]): void;
  onSelectionChange(selection: EditorSelection): void;
  onOpenTerm(termId: TermId): void;
  onEditReference(reference: TermReference): void;
  onPlaceRuleAt(pos: number): void;
  onInspectMiss(): void;
  onRequestSelectionMenu(request: SelectionMenuRequest): void;
  onPropose(): void;
  onAssociate(): void;
  onPlaceRule(): void;
  ruleRefusal(change: RuleChange): string | null;
  onRuleRefused(reason: string): void;
}

/** One feature's editor. It is keyed by feature ID, so each feature gets its own editor state and undo history. */
function EditorCard(props: EditorCardProps) {
  const { feature, editorRef, saveStatus } = props;
  return (
    <section className="bw-editor-card" aria-label="Feature editor">
      <div className="bw-editor-card__head">
        <div className="bw-editor-card__label-row">
          <label className="bw-eyebrow" htmlFor="feature-title">
            Feature
          </label>
          <span className="bw-feature-id" title="Stable feature ID. It does not change when the feature is renamed.">
            <span aria-hidden="true">ID </span>
            <code data-testid="feature-id" aria-label={`Feature ID ${feature.id}`}>
              {feature.id}
            </code>
          </span>
        </div>
        <TitleField
          id="feature-title"
          value={feature.title}
          onChange={props.onTitleChange}
          onCommit={() => editorRef.current?.focus()}
        />
      </div>

      <div className="bw-toolbar">
        <span id="feature-body-label" className="bw-eyebrow">
          Notes, statements, scenarios, and rules
        </span>
        <div className="bw-toolbar__actions">
          <button
            type="button"
            className="bw-button bw-button--small"
            onClick={() => {
              if (!editorRef.current?.inspectAtCursor()) props.onInspectMiss();
            }}
          >
            Inspect term <kbd>{INSPECT_SHORTCUT}</kbd>
          </button>
          <button
            type="button"
            className="bw-button bw-button--small"
            aria-disabled={!props.canPropose}
            onClick={props.onPropose}
          >
            Propose selected term
          </button>
          <button
            type="button"
            className="bw-button bw-button--small"
            aria-disabled={!props.canAssociate}
            onClick={props.onAssociate}
          >
            Associate selection
          </button>
          <button
            type="button"
            className="bw-button bw-button--small"
            aria-disabled={!props.canPlaceRule}
            onClick={props.onPlaceRule}
          >
            Place rule
          </button>
        </div>
        <span className={`bw-save-status bw-save-status--${saveStatus.tone}`} data-testid="save-status">
          <span className="bw-save-status__dot" aria-hidden="true" />
          {saveStatus.text}
        </span>
      </div>

      <FeatureEditor
        ref={editorRef}
        initialText={feature.body}
        initialReferences={feature.references}
        vocabulary={props.editorVocabulary}
        targets={props.referenceTargets}
        terms={props.terms}
        labelledBy="feature-body-label"
        describedBy="feature-body-hint"
        onEdit={props.onEdit}
        onSelectionChange={props.onSelectionChange}
        onOpenTerm={props.onOpenTerm}
        onEditReference={props.onEditReference}
        onPlaceRuleAt={props.onPlaceRuleAt}
        onNoTermAtCursor={props.onInspectMiss}
        onRequestSelectionMenu={props.onRequestSelectionMenu}
        ruleRefusal={props.ruleRefusal}
        onRuleRefused={props.onRuleRefused}
      />

      <p id="feature-body-hint" className="bw-hint">
        Write freely: notes, standalone Given/When/Then statements, Scenarios, and Rules can sit side by side.
        Highlighted words are accepted terms in {props.project.name}'s {LANGUAGE_LABEL}; the lettered badge to the
        left of a word names its kind, a dashed badge marks a proposed term, and an underlined word was associated
        explicitly. Hover one, or put the cursor in it and press{" "}
        {INSPECT_SHORTCUT}. Select text and right-click to propose a term or associate that one occurrence with a
        domain concept. On a line that starts with “Rule:”, press {INSPECT_SHORTCUT} or choose Place rule to place that
        rule on a term.
      </p>
    </section>
  );
}
