import { newId } from "./ids";
import { RefusalError } from "./refusal";

/** The identity of one Project; two are equal when they are the same identifier. */
export type ProjectId = string & { readonly brand: "ProjectId" };

export function projectIdOf(value: string): ProjectId {
  if (value.length === 0) throw new RefusalError("A project ID is never empty.");
  return value as ProjectId;
}

export function newProjectId(): ProjectId {
  return projectIdOf(newId("project"));
}
