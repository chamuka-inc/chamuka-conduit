/**
 * Raised when a durable store operation cannot complete as contracted — e.g. a second write under
 * an idempotency key already taken (the exactly-once guard, NFR-DUR-2), or a failed migration. It
 * carries no row data or secrets, only enough for an operator to locate the fault.
 */
export class StoreError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'StoreError'
  }
}
