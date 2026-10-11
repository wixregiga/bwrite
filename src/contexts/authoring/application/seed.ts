import { Feature } from "../domain/feature";
import { featureIdOf } from "../domain/feature-id";
import { Project } from "../domain/project";
import { projectIdOf } from "../domain/project-id";
import type { ProjectPath } from "../domain/project-path";
import type { Workspace } from "./workspace";

export const SEED_IDS = {
  project: projectIdOf("project-launch-folder"),
  feature: featureIdOf("feature-inspect-domain-vocabulary"),
} as const;

export const SEED_GHERKIN = `Feature: Inspect domain vocabulary while authoring
  Scenario: Inspect an accepted Domain Term
    Given a Feature contains an accepted Domain Term
    When the author inspects the Domain Term
    Then its definition is displayed
    And the author can open the term details`;

/** The last segment of a folder path: the name a project in that folder starts with. */
export function folderName(path: ProjectPath): string {
  const segments = path.split(/[\\/]/u).filter((s) => s.length > 0);
  return segments.at(-1) ?? path;
}

/**
 * The first-run workspace: one project in the folder BWrite was started in, whose
 * UbiquitousLanguage is that folder's VocabularyFile, with an example feature to write in.
 */
export function createSeedWorkspace(launchRoot: ProjectPath): Workspace {
  const project = new Project({
    id: SEED_IDS.project,
    name: folderName(launchRoot),
    description: "The project in the folder BWrite was started in.",
    goals: [],
    path: launchRoot,
  });
  return {
    projects: [project],
    features: [
      new Feature({
        id: SEED_IDS.feature,
        projectId: SEED_IDS.project,
        title: "Inspect domain vocabulary while authoring",
        body: SEED_GHERKIN,
        references: [],
      }),
    ],
    localProposals: {},
    activeProjectId: SEED_IDS.project,
    openFeatureIds: { [SEED_IDS.project]: SEED_IDS.feature },
    vocabularies: {},
  };
}
