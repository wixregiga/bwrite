import { RefusalError } from "./refusal";

/**
 * The folder on disk that holds a Project's code and its recorded domain. BWrite runs inside
 * the Project, so the path is where BWrite was started unless the author names another folder
 * BWrite was given. Two are equal when they name the same folder.
 */
export type ProjectPath = string & { readonly brand: "ProjectPath" };

/**
 * The construction door of a ProjectPath: the folder as the author or the server named it,
 * trimmed, with trailing separators dropped so one folder has one spelling. The filesystem
 * root keeps its single separator.
 */
export function projectPathOf(value: string): ProjectPath {
  const trimmed = value.trim();
  if (trimmed.length === 0) throw new RefusalError("Enter the folder that holds the project.", "path");
  const withoutTrailing = trimmed.replace(/[\\/]+$/u, "");
  return (withoutTrailing.length === 0 ? trimmed.slice(0, 1) : withoutTrailing) as ProjectPath;
}
