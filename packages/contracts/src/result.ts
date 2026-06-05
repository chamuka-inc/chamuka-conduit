import type { ConduitError } from './errors'

/**
 * Explicit success/failure value. The execution core returns `Result` rather than throwing,
 * so failure is part of the type at every contract boundary (ENGINEERING_DISCIPLINE.md:
 * no panics/throws across a contract boundary).
 */
export type Result<T, E = ConduitError> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E }

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value })
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error })
