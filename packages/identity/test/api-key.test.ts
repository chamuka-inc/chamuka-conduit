import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import { generateApiKey, hashApiKey, API_KEY_PREFIX } from '../src/index'

// The key posture mirrors credvault's tenants (src/auth.rs): a prefixed, high-entropy key minted
// from a CSPRNG, of which only the SHA-256 (base64url) digest is ever stored or indexed (NFR-SEC-1).

describe('generateApiKey', () => {
  it('mints a prefixed, 256-bit, url-safe key', () => {
    const key = generateApiKey()
    expect(key.startsWith(API_KEY_PREFIX)).toBe(true)
    const entropy = key.slice(API_KEY_PREFIX.length)
    // base64url of 32 bytes -> 43 chars, no padding, url-safe alphabet only.
    expect(entropy).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(Buffer.from(entropy, 'base64url')).toHaveLength(32)
  })

  it('is unique across calls', () => {
    const keys = new Set(Array.from({ length: 100 }, () => generateApiKey()))
    expect(keys.size).toBe(100)
  })
})

describe('hashApiKey', () => {
  it('is the SHA-256 base64url digest of the key (same posture as credvault token_hash)', () => {
    const key = 'cdt_example-key'
    const expected = createHash('sha256').update(key).digest('base64url')
    expect(hashApiKey(key)).toBe(expected)
    expect(hashApiKey(key)).toMatch(/^[A-Za-z0-9_-]{43}$/) // 32-byte digest, unpadded
  })

  it('is deterministic and collision-free for distinct keys', () => {
    expect(hashApiKey('a')).toBe(hashApiKey('a'))
    expect(hashApiKey('a')).not.toBe(hashApiKey('b'))
  })

  it('never returns the plaintext key', () => {
    const key = generateApiKey()
    expect(hashApiKey(key)).not.toBe(key)
  })
})
