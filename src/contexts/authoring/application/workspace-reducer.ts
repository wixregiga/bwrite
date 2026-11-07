import { Feature } from "../domain/feature";
import { type FeatureId } from "../domain/feature-id";
import { ruleKeyOf, type TermReference } from "../domain/term-reference";
import type { TermId } from "../domain/term-id";
import { Project } from "../domain/project";
import { type ProjectId } from "../domain/project-id";
import type { ProjectPath } from "../domain/project-path";
import { RefusalError } from "../domain/refusal";
import { buildLanguage, type RecordedVocabulary } from "./language-document";
import type { VocabularyTerm } from "./vocabulary-document";
import { languageOf, type VocabularyState, type Workspace } from "./workspace";

/**
 * Every change to the workspace. Each one that changes a project or feature is carried out by
 * that aggregate's command; a command it refuses leaves the workspace as it was, so callers
 * check the command first when they need to show the reason. A project's language changes
 * only by reading its VocabularyFile again, or, for the proposed terms BWrite keeps itself,
 * through `vocabulary/local`.
 */
export type WorkspaceAction =
  | { type: "project/created"; projectId: ProjectId; name: string; path: ProjectPath }
  | { type: "project/renamed"; projectId: ProjectId; name: string }
  | { type: "project/selected"; projectId: ProjectId }
  | { type: "project/deleted"; projectId: ProjectId }
  | { type: "feature/created"; projectId: ProjectId; featureId: FeatureId }
  | { type: "feature/selected"; featureId: FeatureId }
  | { type: "feature/retitled"; featureId: FeatureId; title: string }
  /** One editor step: the text and its references, which change together. */
  | { type: "feature/edited"; featureId: FeatureId; body: string; references: readonly TermReference[] }
  | { type: "feature/deleted"; featureId: FeatureId }
  | { type: "vocabulary/loading"; projectId: ProjectId }
  /**
   * The project's VocabularyFile as read. `localProposals`, when given, replaces BWrite's own
   * proposed terms for the project; `retargets` moves TermReferences to the new TermId of terms
   * a saved change moved to another bounded context.
   */
  | {
      type: "vocabulary/loaded";
      projectId: ProjectId;
      recorded: RecordedVocabulary;
      localProposals?: readonly VocabularyTerm[];
      retargets?: readonly (readonly [TermId, TermId])[];
    }
  | { type: "vocabulary/failed"; projectId: ProjectId; message: string }
  /** A change only to the proposed terms BWrite keeps itself. */
  | {
      type: "vocabulary/local";
      projectId: ProjectId;
      localProposals: readonly VocabularyTerm[];
      retargets: readonly (readonly [TermId, TermId])[];
    }
  /** Unties every occurrence that states a rule, in every feature of the project, once the rule left the file. */
  | { type: "rule/untied"; projectId: ProjectId; termId: TermId; ruleKey: string };

/** The item that takes a removed item's place: the next one, or the previous one at the end. */
function neighbor<T>(items: readonly T[], removedIndex: number): T | null {
  return items[Math.min(removedIndex, items.length - 1)] ?? null;
}

function withoutKey<V>(record: Readonly<Record<string, V>>, key: string): Record<string, V> {
  const next = { ...record };
  delete next[key];
  return next;
}

/** The project's language built from `recorded` and `localProposals`, or why it cannot be. */
function vocabularyState(
  projectId: ProjectId,
  recorded: RecordedVocabulary,
  localProposals: readonly VocabularyTerm[],
): VocabularyState {
  try {
    return {
      kind: "loaded",
      built: buildLanguage(projectId, { file: recorded.file, document: recorded.document, localProposals }),
    };
  } catch (error) {
    if (!(error instanceof RefusalError)) throw error;
    return { kind: "problem", message: `${recorded.file.file} cannot be used: ${error.message}` };
  }
}

/** Moves the project's TermReferences from each old TermId to its new one. */
function retarget(ws: Workspace, projectId: ProjectId, retargets: readonly (readonly [TermId, TermId])[]): Workspace {
  if (retargets.length === 0) return ws;
  const moved = new Map(retargets);
  const features = ws.features.map((f) => {
    if (f.projectId !== projectId || !f.references.some((r) => moved.has(r.termId))) return f;
    const references = f.references.map((r) => (moved.has(r.termId) ? { ...r, termId: moved.get(r.termId)! } : r));
    const edited = f.edit(f.body, references);
    if (!edited.ok) throw new Error(`Feature ${f.id} refused retargeted references: ${edited.error.message}`);
    return edited.value;
  });
  return { ...ws, features };
}

function withVocabulary(
  ws: Workspace,
  projectId: ProjectId,
  recorded: RecordedVocabulary,
  localProposals: readonly VocabularyTerm[],
  retargets: readonly (readonly [TermId, TermId])[],
): Workspace {
  const kept = recorded.file.holdsProposals ? [] : localProposals;
  const next: Workspace = {
    ...ws,
    localProposals: kept.length > 0 ? { ...ws.localProposals, [projectId]: kept } : withoutKey(ws.localProposals, projectId),
    vocabularies: { ...ws.vocabularies, [projectId]: vocabularyState(projectId, recorded, kept) },
  };
  return retarget(next, projectId, retargets);
}

export function workspaceReducer(ws: Workspace, action: WorkspaceAction): Workspace {
  switch (action.type) {
    case "project/created": {
      const project = new Project({ id: action.projectId, name: action.name, description: "", goals: [], path: action.path });
      return { ...ws, projects: [...ws.projects, project], activeProjectId: project.id };
    }

    case "project/renamed": {
      const project = ws.projects.find((p) => p.id === action.projectId);
      const renamed = project?.rename(action.name);
      if (!renamed?.ok) return ws;
      return { ...ws, projects: ws.projects.map((p) => (p.id === action.projectId ? renamed.value : p)) };
    }

    case "project/selected":
      if (!ws.projects.some((p) => p.id === action.projectId)) return ws;
      return { ...ws, activeProjectId: action.projectId };

    case "project/deleted": {
      const index = ws.projects.findIndex((p) => p.id === action.projectId);
      if (index < 0) return ws;
      const projects = ws.projects.filter((p) => p.id !== action.projectId);
      return {
        ...ws,
        projects,
        features: ws.features.filter((f) => f.projectId !== action.projectId),
        localProposals: withoutKey(ws.localProposals, action.projectId),
        vocabularies: withoutKey(ws.vocabularies, action.projectId),
        activeProjectId:
          ws.activeProjectId === action.projectId ? (neighbor(projects, index)?.id ?? null) : ws.activeProjectId,
        openFeatureIds: withoutKey(ws.openFeatureIds, action.projectId),
      };
    }

    case "feature/created": {
      if (!ws.projects.some((p) => p.id === action.projectId)) return ws;
      const feature = new Feature({ id: action.featureId, projectId: action.projectId, title: "", body: "", references: [] });
      return {
        ...ws,
        features: [...ws.features, feature],
        activeProjectId: feature.projectId,
        openFeatureIds: { ...ws.openFeatureIds, [feature.projectId]: feature.id },
      };
    }

    case "feature/selected": {
      const feature = ws.features.find((f) => f.id === action.featureId);
      if (!feature) return ws;
      return {
        ...ws,
        activeProjectId: feature.projectId,
        openFeatureIds: { ...ws.openFeatureIds, [feature.projectId]: feature.id },
      };
    }

    case "feature/retitled": {
      const retitled = ws.features.find((f) => f.id === action.featureId)?.retitle(action.title);
      if (!retitled?.ok) return ws;
      return { ...ws, features: ws.features.map((f) => (f.id === action.featureId ? retitled.value : f)) };
    }

    case "feature/edited": {
      const feature = ws.features.find((f) => f.id === action.featureId);
      if (!feature) return ws;
      const language = languageOf(ws, feature.projectId);
      // A rule reading of a term still in the language, whose rule left it, no longer means anything.
      // A reference whose term left the language stays, and shows that its term is gone.
      const references = action.references.filter(
        (r) => language.term(r.termId) === undefined || language.resolves({ termId: r.termId, ruleKey: ruleKeyOf(r) }),
      );
      const edited = feature.edit(action.body, references);
      // The editor keeps references fitted to its text, so a refusal here is a defect, never a choice.
      if (!edited.ok) throw new Error(`Feature ${feature.id} refused an edit: ${edited.error.message}`);
      return { ...ws, features: ws.features.map((f) => (f.id === feature.id ? edited.value : f)) };
    }

    case "feature/deleted": {
      const feature = ws.features.find((f) => f.id === action.featureId);
      if (!feature) return ws;
      const siblings = ws.features.filter((f) => f.projectId === feature.projectId);
      const remaining = siblings.filter((f) => f.id !== feature.id);
      const wasOpen = ws.openFeatureIds[feature.projectId] === feature.id;
      const next = wasOpen ? neighbor(remaining, siblings.indexOf(feature)) : null;
      // Proposed terms keep their source feature ID; the panel reports a deleted source.
      return {
        ...ws,
        features: ws.features.filter((f) => f.id !== feature.id),
        openFeatureIds: !wasOpen
          ? ws.openFeatureIds
          : next
            ? { ...ws.openFeatureIds, [feature.projectId]: next.id }
            : withoutKey(ws.openFeatureIds, feature.projectId),
      };
    }

    case "vocabulary/loading":
      if (!ws.projects.some((p) => p.id === action.projectId)) return ws;
      // A language already read stays shown while its file is read again.
      if (ws.vocabularies[action.projectId]?.kind === "loaded") return ws;
      return { ...ws, vocabularies: { ...ws.vocabularies, [action.projectId]: { kind: "loading" } } };

    case "vocabulary/loaded":
      if (!ws.projects.some((p) => p.id === action.projectId)) return ws;
      return withVocabulary(
        ws,
        action.projectId,
        action.recorded,
        action.localProposals ?? ws.localProposals[action.projectId] ?? [],
        action.retargets ?? [],
      );

    case "vocabulary/failed":
      if (!ws.projects.some((p) => p.id === action.projectId)) return ws;
      return {
        ...ws,
        vocabularies: {
          ...ws.vocabularies,
          [action.projectId]: { kind: "problem", message: action.message },
        },
      };

    case "vocabulary/local": {
      const state = ws.vocabularies[action.projectId];
      if (state?.kind !== "loaded") return ws;
      const { file, document } = state.built.source;
      return withVocabulary(ws, action.projectId, { file, document }, action.localProposals, action.retargets);
    }

    case "rule/untied": {
      const features = ws.features.map((f) => {
        if (f.projectId !== action.projectId || f.ruleReferences(action.termId, action.ruleKey).length === 0) return f;
        const untied = f.removeRuleReferences(action.termId, action.ruleKey);
        return untied.ok ? untied.value : f;
      });
      return { ...ws, features };
    }
  }
}
