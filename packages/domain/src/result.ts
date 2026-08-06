/**
 * An outcome that may have failed in an expected way.
 *
 * The financial engines deal in outcomes that are not exceptional: a duplicate
 * was detected, a rule did not match, a statement could not be attributed to an
 * account. Throwing for those makes the caller's control flow invisible to the
 * compiler and easy to forget. `Result` makes the failure part of the signature,
 * so every call site has to decide what to do about it.
 *
 * Genuine faults — a lost database connection, a bug — still throw.
 */
export type Result<TValue, TError> =
  { readonly ok: true; readonly value: TValue } | { readonly ok: false; readonly error: TError };

export function ok<TValue>(value: TValue): Result<TValue, never> {
  return { ok: true, value };
}

export function err<TError>(error: TError): Result<never, TError> {
  return { ok: false, error };
}

export function isOk<TValue, TError>(
  result: Result<TValue, TError>,
): result is { ok: true; value: TValue } {
  return result.ok;
}

export function isErr<TValue, TError>(
  result: Result<TValue, TError>,
): result is { ok: false; error: TError } {
  return !result.ok;
}

export function mapResult<TValue, TNext, TError>(
  result: Result<TValue, TError>,
  transform: (value: TValue) => TNext,
): Result<TNext, TError> {
  return result.ok ? ok(transform(result.value)) : result;
}

/** Unwraps, or throws. Only for call sites that have already checked. */
export function unwrap<TValue, TError>(result: Result<TValue, TError>): TValue {
  if (!result.ok) {
    throw new Error(`Unwrapped a failed Result: ${JSON.stringify(result.error)}`);
  }
  return result.value;
}

export function unwrapOr<TValue, TError>(result: Result<TValue, TError>, fallback: TValue): TValue {
  return result.ok ? result.value : fallback;
}
