import type { ActionCatalog } from '@conduit/contracts'
import { loadCatalog } from './load'
import seed from './seed/github.json'

/**
 * Load the seed catalog bundled with conduit. The JSON is the shipped production artifact; it
 * passes through the same fail-fast loader as any operator-supplied catalog (FR-1).
 */
export function loadSeedCatalog(): ActionCatalog {
  return loadCatalog(seed)
}
