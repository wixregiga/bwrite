import type { ProjectId } from "../../../src/contexts/authoring/domain/project-id";
import type { VocabularyFile } from "../../../src/contexts/authoring/domain/vocabulary-file";
import type { VocabularyDocument, VocabularyTerm } from "../../../src/contexts/authoring/application/vocabulary-document";
import type { Workspace } from "../../../src/contexts/authoring/application/workspace";
import { workspaceReducer } from "../../../src/contexts/authoring/application/workspace-reducer";

/**
 * The workspace after the project's VocabularyFile was read, through the same action the app
 * dispatches; fails the test when the document cannot be built.
 */
export function withVocabulary(
  ws: Workspace,
  projectId: ProjectId,
  file: VocabularyFile,
  document: VocabularyDocument | null,
  localProposals?: readonly VocabularyTerm[],
): Workspace {
  const next = workspaceReducer(ws, {
    type: "vocabulary/loaded",
    projectId,
    recorded: { file, document },
    ...(localProposals === undefined ? {} : { localProposals }),
  });
  const state = next.vocabularies[projectId];
  if (state?.kind !== "loaded") throw new Error(`the vocabulary was not built: ${JSON.stringify(state)}`);
  return next;
}
