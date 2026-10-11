// The authoring context's public API: the workspace view an author writes Features in, and the
// ports its host provides. Adapters are chosen by the browser root, not here.

export { AuthoringWorkspace, type AuthoringWorkspaceProps } from "./ui/authoring-workspace";
export type { WorkspaceStorage } from "./application/workspace-storage";
export type { ProjectRulesSource } from "./application/project-rules";
