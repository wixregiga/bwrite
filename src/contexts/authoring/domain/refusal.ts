/**
 * Why the model refused an operation, in words an author can act on. Commands return it;
 * constructors throw it, because a value that breaks an invariant must never exist.
 */
export class RefusalError extends Error {
  override readonly name = "RefusalError";

  constructor(
    reason: string,
    /** The input the refusal is about, so a form can show it beside that field. */
    readonly concerns: string | null = null,
  ) {
    super(reason);
  }
}

/** The outcome of a command: the changed value, or the refusal that kept it unchanged. */
export type Result<T, E extends Error> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E };

export function success<T>(value: T): { readonly ok: true; readonly value: T } {
  return { ok: true, value };
}

export function failure<E extends Error>(error: E): { readonly ok: false; readonly error: E } {
  return { ok: false, error };
}

/** Runs a construction, turning a RefusalError it throws into a failed result. */
export function attempt<T>(build: () => T): Result<T, RefusalError> {
  try {
    return success(build());
  } catch (error) {
    if (error instanceof RefusalError) return failure(error);
    throw error;
  }
}
