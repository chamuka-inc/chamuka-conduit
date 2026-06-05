import { describe, it, expect } from 'vitest'
import { isGlobalIp, validateTarget } from '../src/index'

// The SSRF guard is conduit's port of credvault's validate_endpoint / is_global_ip
// (src/providers/mod.rs). These specs mirror the same vectors the Rust suite pins, plus the
// per-action allowlist that conduit adds on top (FR-11): a rendered request may only target a
// host on the ActionSpec's providerHosts, over https (http tolerated for loopback dev), and must
// never resolve to a non-routable IP literal (loopback/private/link-local/metadata/ULA).

describe('isGlobalIp (ported from credvault is_global_ip)', () => {
  it('rejects the internal IP-literal targets credvault refuses', () => {
    for (const bad of [
      '169.254.169.254', // cloud metadata (link-local)
      '10.0.0.5', // RFC1918
      '172.16.0.1', // RFC1918
      '192.168.1.1', // RFC1918
      '127.0.0.1', // loopback
      '0.0.0.0', // unspecified
      '255.255.255.255', // broadcast
      '192.0.2.1', // documentation (TEST-NET-1)
      'fd00::1', // IPv6 unique-local
      '::1', // IPv6 loopback
      '::', // IPv6 unspecified
      'fe80::1', // IPv6 link-local
    ]) {
      expect(isGlobalIp(bad), `${bad} must be non-global`).toBe(false)
    }
  })

  it('accepts public, routable addresses', () => {
    expect(isGlobalIp('140.82.112.3')).toBe(true) // api.github.com range
    expect(isGlobalIp('8.8.8.8')).toBe(true)
    expect(isGlobalIp('2606:4700:4700::1111')).toBe(true) // public IPv6
  })

  it('returns false for things that are not IP literals', () => {
    expect(isGlobalIp('api.github.com')).toBe(false)
    expect(isGlobalIp('not-an-ip')).toBe(false)
  })
})

describe('validateTarget (allowlist + scheme + SSRF)', () => {
  const hosts = ['api.github.com']

  it('accepts an https URL whose host is on the allowlist', () => {
    expect(validateTarget('https://api.github.com/user', hosts).ok).toBe(true)
  })

  it('rejects a host that is not on the action allowlist (fails closed)', () => {
    const r = validateTarget('https://evil.example.com/user', hosts)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('validation_error')
  })

  it('rejects plaintext http to a public host, allows it only for loopback (dev)', () => {
    expect(validateTarget('http://api.github.com/user', hosts).ok).toBe(false)
    expect(validateTarget('http://localhost:8000/x', ['localhost']).ok).toBe(true)
    expect(validateTarget('http://127.0.0.1:8000/x', ['127.0.0.1']).ok).toBe(true)
  })

  it('rejects an allowlisted IP literal that is internal (SSRF, defense in depth)', () => {
    // Even if an operator allowlists it, an internal IP target must fail closed.
    for (const bad of [
      'https://169.254.169.254/latest/meta-data/',
      'https://10.0.0.5/token',
      'https://192.168.1.1/token',
      'https://[fd00::1]/token',
    ]) {
      const url = new URL(bad)
      const r = validateTarget(bad, [url.hostname])
      expect(r.ok, `${bad} must be refused as SSRF`).toBe(false)
      if (!r.ok) expect(r.error.code).toBe('validation_error')
    }
  })

  it('rejects a malformed URL', () => {
    expect(validateTarget('not a url', hosts).ok).toBe(false)
  })
})
