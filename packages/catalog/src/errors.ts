/**
 * Raised when a catalog fails to load. FR-1: an invalid catalog fails fast at load, never at
 * first request. The message names the offending action and defect so the operator can fix the
 * catalog data without reading conduit's source.
 */
export class CatalogError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'CatalogError'
  }
}
