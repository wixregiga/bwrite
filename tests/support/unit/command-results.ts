import { ProblemError } from "../../../src/contexts/authoring/application/problem";
import type { RefusalError, Result } from "../../../src/contexts/authoring/domain/refusal";

/** The value of a command that must succeed; fails the test with the refusal otherwise. */
export function unwrap<T>(result: Result<T, RefusalError>): T {
  if (!result.ok) throw new Error(`refused: ${result.error.message}`);
  return result.value;
}

/** The reason of a command that must be refused. */
export function refusalOf<T>(result: Result<T, RefusalError>): string {
  if (result.ok) throw new Error("expected a refusal, but the command succeeded");
  return result.error.message;
}

/** The ProblemError an adapter's operation must reject with; rethrows any other failure. */
export async function rejection(promise: Promise<unknown>): Promise<ProblemError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ProblemError) return error;
    throw error;
  }
  throw new Error("expected a refusal");
}
