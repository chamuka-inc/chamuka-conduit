// In-memory state for the Authorization Server: registered clients (DCR) and outstanding
// authorization codes. Per-instance and ephemeral — acceptable for v1 (the same operability posture
// the SAD takes for the rate-limit store); a shared/durable store is a later increment. Auth codes
// are single-use: takeCode deletes on read so a replayed code cannot be exchanged twice.

import { randomBytes, randomUUID } from 'node:crypto'
import type { McpTokenClaims } from './tokens'

export interface RegisteredClient {
  readonly clientId: string
  readonly redirectUris: readonly string[]
  readonly clientName?: string
}

export interface AuthCodeRecord {
  readonly clientId: string
  readonly redirectUri: string
  readonly codeChallenge: string
  readonly resource: string
  readonly scope: string
  readonly claims: McpTokenClaims
  readonly expiresAtMs: number
}

export class OAuthStore {
  readonly #clients = new Map<string, RegisteredClient>()
  readonly #codes = new Map<string, AuthCodeRecord>()

  registerClient(input: { redirectUris: readonly string[]; clientName?: string }): RegisteredClient {
    const client: RegisteredClient = {
      clientId: `cdt-mcp-${randomUUID()}`,
      redirectUris: input.redirectUris,
      clientName: input.clientName,
    }
    this.#clients.set(client.clientId, client)
    return client
  }

  getClient(clientId: string): RegisteredClient | undefined {
    return this.#clients.get(clientId)
  }

  issueCode(record: AuthCodeRecord): string {
    const code = randomBytes(32).toString('base64url')
    this.#codes.set(code, record)
    return code
  }

  /** Read and remove an authorization code; undefined if unknown (or already used). */
  takeCode(code: string): AuthCodeRecord | undefined {
    const record = this.#codes.get(code)
    if (record === undefined) return undefined
    this.#codes.delete(code)
    return record
  }
}
