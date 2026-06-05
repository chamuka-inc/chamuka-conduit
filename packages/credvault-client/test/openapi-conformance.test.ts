import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parse as parseYaml } from 'yaml'
import { z } from 'zod'
import { CredvaultCredential } from '@conduit/contracts'
import { toAccessToken, errorForResponse } from '../src/mapping'

// Conformance gate. conduit's only coupling to credvault is its HTTP API; this pins that boundary to
// credvault's *published* OpenAPI (vendored verbatim alongside this test as `credvault.openapi.yaml`,
// re-synced with `scripts/sync-credvault-openapi.sh`). credvault's spec is the source of truth — these
// assertions fail if conduit's hand-written contract/mapping drifts from it, OR if a spec re-sync
// changes the shape conduit relies on. Runs fully offline (no credvault needed), unlike `live.test.ts`.
//
// Scope is deliberately the one operation conduit calls: GET /v1/credentials/{provider}.

const CREDENTIALS_PATH = '/v1/credentials/{provider}'

// Validate-and-extract exactly the slice of the spec conduit depends on (no type-lying casts).
const SpecSlice = z.object({
  paths: z.object({
    [CREDENTIALS_PATH]: z.object({
      get: z.object({
        operationId: z.string(),
        parameters: z.array(z.unknown()),
        responses: z.record(z.string(), z.unknown()),
      }),
    }),
  }),
  components: z.object({
    schemas: z.object({
      AccessToken: z.object({
        required: z.array(z.string()),
        properties: z.record(z.string(), z.unknown()),
        example: z.record(z.string(), z.unknown()),
      }),
      Error: z.object({
        required: z.array(z.string()),
        properties: z.object({ code: z.object({ enum: z.array(z.string()) }) }),
        example: z.record(z.string(), z.unknown()),
      }),
    }),
  }),
})

const specPath = fileURLToPath(new URL('../credvault.openapi.yaml', import.meta.url))
const spec = SpecSlice.parse(parseYaml(readFileSync(specPath, 'utf8')))
const operation = spec.paths[CREDENTIALS_PATH].get
const accessToken = spec.components.schemas.AccessToken
const errorSchema = spec.components.schemas.Error

const InlineParam = z.object({
  name: z.string(),
  in: z.string(),
  required: z.boolean().optional(),
})

describe('@conduit/credvault-client conforms to credvault OpenAPI — GET /v1/credentials/{provider}', () => {
  it('targets the operation conduit actually calls (operationId + required external_user_id query)', () => {
    expect(operation.operationId).toBe('getCredentials')
    // The client builds `/v1/credentials/${provider}?external_user_id=...`; that query param must be
    // a required query parameter on this operation.
    const externalUserId = operation.parameters
      .map((p) => InlineParam.safeParse(p))
      .flatMap((r) => (r.success ? [r.data] : []))
      .find((p) => p.name === 'external_user_id')
    expect(externalUserId).toBeDefined()
    expect(externalUserId?.in).toBe('query')
    expect(externalUserId?.required).toBe(true)
  })

  it('CredvaultCredential matches the spec AccessToken schema (same required fields)', () => {
    const contractFields = Object.keys(CredvaultCredential.shape).sort()
    expect(contractFields).toEqual([...accessToken.required].sort())
    expect(contractFields).toEqual(Object.keys(accessToken.properties).sort())
  })

  it("accepts the spec's AccessToken example and projects it onto an AccessToken", () => {
    expect(CredvaultCredential.safeParse(accessToken.example).success).toBe(true)
    const token = toAccessToken(accessToken.example)
    expect(token).not.toBeNull()
    expect(token?.accessToken).toBe(accessToken.example['access_token'])
    expect(token?.tokenType).toBe(accessToken.example['token_type'])
  })

  it('honors the spec nullability of expires_at', () => {
    expect(CredvaultCredential.safeParse({ ...accessToken.example, expires_at: null }).success).toBe(
      true,
    )
    // a non-string, non-null expires_at breaks the spec's `type: [string, "null"]`
    expect(CredvaultCredential.safeParse({ ...accessToken.example, expires_at: 123 }).success).toBe(
      false,
    )
  })

  it('error envelope shape matches the spec Error schema, and branched codes exist in its enum', () => {
    expect([...errorSchema.required].sort()).toEqual(['code', 'message'])
    // mapping.ts special-cases this code on a 404; if credvault renamed it the 404 branch would
    // silently misroute, so assert it still exists in the spec's code enum.
    expect(errorSchema.properties.code.enum).toContain('unknown_provider')
  })

  it('maps every non-2xx status the spec documents for this operation onto a ConduitError', () => {
    const documented = Object.keys(operation.responses)
      .map(Number)
      .filter((status) => status >= 400)
    expect(documented).toContain(503) // sanity: we actually read the spec's statuses
    for (const status of documented) {
      const error = errorForResponse(status, errorSchema.example)
      expect(typeof error.code).toBe('string') // never throws; always a closed-taxonomy code
    }
  })

  it('pins the intended mapping for the documented statuses', () => {
    const body = (code: string) => ({ code, message: 'x' })
    expect(errorForResponse(400, body('validation')).code).toBe('validation_error')
    expect(errorForResponse(404, body('not_connected')).code).toBe('not_connected')
    expect(errorForResponse(404, body('unknown_provider')).code).toBe('validation_error')
    expect(errorForResponse(409, body('needs_reauth')).code).toBe('not_connected')
    expect(errorForResponse(503, body('refresh_failed')).code).toBe('provider_error')
  })
})
