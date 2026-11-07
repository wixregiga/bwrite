import type { FeatureId } from "../domain/feature-id";
import type { ProjectId } from "../domain/project-id";
import type { TermId } from "../domain/term-id";
import { languageOf, type Workspace } from "./workspace";

export type SearchCategory = "projects" | "features" | "terms" | "rules";
interface SearchResultBase {
  id: string;
  projectId: ProjectId;
  projectName: string;
  label: string;
  snippet: string;
  /** Offsets into the snippet, retaining the original spelling and whitespace. */
  highlight: { from: number; to: number };
  primary: boolean;
  prefix: boolean;
}
export type SearchResult = SearchResultBase & (
  | { category: "projects" }
  | { category: "features"; featureId: FeatureId; from: number; to: number; field: "title" | "body" }
  | { category: "terms"; termId: TermId; proposed: boolean }
  | { category: "rules"; termId: TermId; ruleKey: string }
);
export interface SearchGroup {
  category: SearchCategory;
  label: string;
  results: SearchResult[];
  more: number;
}
export const SEARCH_CATEGORIES: ReadonlyArray<{ category: SearchCategory; label: string }> = [
  { category: "projects", label: "Projects" }, { category: "features", label: "Features" },
  { category: "terms", label: "Domain terms" }, { category: "rules", label: "Placed rules" },
];
export const SEARCH_CATEGORY_LIMIT = 8;

export function normalizeSearchQuery(text: string): string {
  return text.trim().replace(/\s+/gu, " ").toLowerCase();
}

interface SearchMatch {
  text: string;
  from: number;
  to: number;
  primary: boolean;
  prefix: boolean;
  field: string;
}

/** Maps a normalized match back to UTF-16 document offsets, including collapsed whitespace. */
function matchText(text: string, query: string, primary: boolean, field: string): SearchMatch | null {
  let normalized = "";
  const starts: number[] = [];
  const ends: number[] = [];
  for (const match of text.matchAll(/\s+|[^\s]/gu)) {
    const raw = match[0];
    const whitespace = /^\s/u.test(raw);
    if (whitespace && (normalized.length === 0 || match.index + raw.length === text.length)) continue;
    const part = whitespace ? " " : raw.toLowerCase();
    normalized += part;
    for (let i = 0; i < part.length; i++) {
      starts.push(match.index);
      ends.push(match.index + raw.length);
    }
  }
  // Unicode case-insensitive matching also handles contextual forms such as Greek sigma.
  const literal = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const index = new RegExp(literal, "iu").exec(normalized)?.index ?? -1;
  return index < 0 ? null : {
    text, from: starts[index], to: ends[index + query.length - 1], primary, prefix: index === 0, field,
  };
}

function bestMatch(fields: ReadonlyArray<{ text: string; primary: boolean; field: string }>, query: string): SearchMatch | null {
  const matches = fields.map((f) => matchText(f.text, query, f.primary, f.field)).filter((m): m is SearchMatch => m !== null);
  matches.sort((a, b) => Number(b.primary) - Number(a.primary) || Number(b.prefix) - Number(a.prefix));
  return matches[0] ?? null;
}

function excerpt(match: SearchMatch): Pick<SearchResultBase, "snippet" | "highlight" | "primary" | "prefix"> {
  let start = Math.max(0, match.from - 55);
  let end = Math.min(match.text.length, match.to + 90);
  // Never split surrogate pairs at the edges of an excerpt.
  if (start > 0 && /[\uDC00-\uDFFF]/u.test(match.text[start])) start--;
  if (end < match.text.length && /[\uDC00-\uDFFF]/u.test(match.text[end])) end++;
  const leading = start ? "…" : "";
  return {
    snippet: leading + match.text.slice(start, end) + (end < match.text.length ? "…" : ""),
    highlight: { from: match.from - start + leading.length, to: match.to - start + leading.length },
    primary: match.primary, prefix: match.prefix,
  };
}

/** One best hit per item, ranked independently in each category across the whole workspace. */
export function searchWorkspace(workspace: Workspace, rawQuery: string, limit = SEARCH_CATEGORY_LIMIT): SearchGroup[] {
  if (!Number.isInteger(limit) || limit < 1) throw new RangeError("The search category limit must be a positive integer.");
  const query = normalizeSearchQuery(rawQuery);
  const groups = SEARCH_CATEGORIES.map((category): SearchGroup => ({ ...category, results: [], more: 0 }));
  if (!query) return groups;
  const add = (result: SearchResult) => groups.find((g) => g.category === result.category)!.results.push(result);
  for (const project of workspace.projects) {
    const context = { projectId: project.id, projectName: project.name };
    const match = bestMatch([
      { text: project.name, primary: true, field: "name" },
      { text: project.description, primary: false, field: "description" },
      ...project.goals.map((text) => ({ text, primary: false, field: "goal" })),
    ], query);
    if (match) add({ ...context, ...excerpt(match), id: JSON.stringify(["project", project.id]), category: "projects", label: project.name });
    for (const feature of workspace.features.filter((f) => f.projectId === project.id)) {
      const found = bestMatch([
        { text: feature.title, primary: true, field: "title" },
        { text: feature.body, primary: false, field: "body" },
      ], query);
      if (found) {
        const bodyMatch = found.field === "body" ? found : matchText(feature.body, query, false, "body");
        add({
          ...context, ...excerpt(found), id: JSON.stringify(["feature", feature.id]), category: "features",
          label: feature.title || "Untitled feature", featureId: feature.id,
          field: found.field as "title" | "body", from: bodyMatch?.from ?? 0, to: bodyMatch?.to ?? 0,
        });
      }
    }
    for (const term of languageOf(workspace, project.id).terms) {
      const found = bestMatch([
        { text: term.name, primary: true, field: "name" },
        { text: term.definition, primary: false, field: "definition" },
      ], query);
      if (found) add({
        ...context, ...excerpt(found), id: JSON.stringify(["term", project.id, term.id]), category: "terms",
        label: term.name, termId: term.id, proposed: term.status === "proposed",
      });
      for (const rule of term.rules) {
        const ruleMatch = bestMatch([
          { text: rule.operation ?? "", primary: false, field: "operation" },
          { text: rule.statement, primary: false, field: "statement" },
        ], query);
        if (ruleMatch) add({
          ...context, ...excerpt(ruleMatch), id: JSON.stringify(["rule", project.id, term.id, rule.key]), category: "rules",
          label: `${term.name}: ${rule.key}`, termId: term.id, ruleKey: rule.key,
        });
      }
    }
  }
  for (const group of groups) {
    group.results.sort((a, b) => Number(b.primary) - Number(a.primary)
      || Number(b.prefix) - Number(a.prefix)
      || Number(b.projectId === workspace.activeProjectId) - Number(a.projectId === workspace.activeProjectId)
      || a.label.localeCompare(b.label) || a.projectName.localeCompare(b.projectName) || a.id.localeCompare(b.id));
    group.more = Math.max(0, group.results.length - limit);
    group.results = group.results.slice(0, limit);
  }
  return groups;
}
