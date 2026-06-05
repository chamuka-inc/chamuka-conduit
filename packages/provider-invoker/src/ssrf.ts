// The SSRF guard (FR-11), ported from credvault's validate_endpoint / is_global_ip
// (src/providers/mod.rs). Pure: no DNS resolution — like credvault, it judges the host literally
// (an allowlisted hostname, or an IP literal classified conservatively). conduit adds a per-action
// providerHosts allowlist on top of credvault's https + non-routable-IP rules.

import type { Result } from '@conduit/contracts'
import { ok, err, conduitError } from '@conduit/contracts'

type Ipv4 = readonly [number, number, number, number]

/** Parse "a.b.c.d" into four octets, or null if it is not a dotted-quad IPv4 literal. */
function parseIpv4(host: string): Ipv4 | null {
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(host)
  if (m === null) return null
  const octets: Ipv4 = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])]
  return octets.every((o) => o <= 255) ? octets : null
}

/** Parse an IPv6 literal (with `::` compression) into eight 16-bit segments, or null. */
function parseIpv6(host: string): number[] | null {
  if (!host.includes(':')) return null
  const halves = host.split('::')
  if (halves.length > 2) return null
  const toGroups = (part: string) => (part === '' ? [] : part.split(':'))
  const head = toGroups(halves[0] ?? '')
  const tail = halves.length === 2 ? toGroups(halves[1] ?? '') : null
  let groups: string[]
  if (tail === null) {
    groups = head
  } else {
    const missing = 8 - head.length - tail.length
    if (missing < 1) return null
    groups = [...head, ...Array<string>(missing).fill('0'), ...tail]
  }
  if (groups.length !== 8) return null
  const segments: number[] = []
  for (const g of groups) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null
    segments.push(parseInt(g, 16))
  }
  return segments
}

function isNonGlobalIpv4(o: Ipv4): boolean {
  const [a, b, c, d] = o
  const isPrivate = a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
  const isLoopback = a === 127
  const isLinkLocal = a === 169 && b === 254 // includes 169.254.169.254 cloud metadata
  const isBroadcast = a === 255 && b === 255 && c === 255 && d === 255
  const isDocumentation =
    (a === 192 && b === 0 && c === 2) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113)
  const isUnspecifiedOrThisNetwork = a === 0 // 0.0.0.0 and the whole 0.0.0.0/8 block
  return (
    isPrivate ||
    isLoopback ||
    isLinkLocal ||
    isBroadcast ||
    isDocumentation ||
    isUnspecifiedOrThisNetwork
  )
}

/** The IPv6 loopback ::1 — all-zero segments but for a trailing 1. */
function isLoopbackIpv6(seg: number[]): boolean {
  return seg.slice(0, 7).every((s) => s === 0) && seg[7] === 1
}

function isNonGlobalIpv6(seg: number[]): boolean {
  const head = seg[0] ?? 0
  const isUnspecified = seg.every((s) => s === 0)
  const isUniqueLocal = (head & 0xfe00) === 0xfc00 // fc00::/7
  const isLinkLocal = (head & 0xffc0) === 0xfe80 // fe80::/10
  return isUnspecified || isLoopbackIpv6(seg) || isUniqueLocal || isLinkLocal
}

/**
 * True only for a public, routable IP literal. Returns false for non-routable literals
 * (loopback/private/link-local/metadata/broadcast/documentation/unspecified/ULA) and for any
 * string that is not an IP literal at all. Mirror of credvault's is_global_ip.
 */
export function isGlobalIp(host: string): boolean {
  const v4 = parseIpv4(host)
  if (v4 !== null) return !isNonGlobalIpv4(v4)
  const v6 = parseIpv6(host)
  if (v6 !== null) return !isNonGlobalIpv6(v6)
  return false
}

function isLoopbackHost(host: string): boolean {
  if (host.toLowerCase() === 'localhost') return true
  const v4 = parseIpv4(host)
  if (v4 !== null) return v4[0] === 127
  const v6 = parseIpv6(host)
  if (v6 !== null) return isLoopbackIpv6(v6)
  return false
}

function isIpLiteral(host: string): boolean {
  return parseIpv4(host) !== null || parseIpv6(host) !== null
}

const refuse = (message: string) => err(conduitError('validation_error', message))

/**
 * Validate a rendered request's target before any socket opens (FR-11). The host must be on the
 * action's allowlist, the scheme https (http tolerated only for a loopback host, dev convenience),
 * and an IP-literal host must be globally routable. Fails closed.
 */
export function validateTarget(rawUrl: string, providerHosts: readonly string[]): Result<void> {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return refuse(`rendered request URL is not valid: ${rawUrl}`)
  }
  // URL.hostname brackets IPv6 literals (`[fd00::1]`); compare and classify the bare host.
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase()

  const allowed = providerHosts.some((h) => h.replace(/^\[|\]$/g, '').toLowerCase() === host)
  if (!allowed) {
    return refuse(`host '${host}' is not on the action's providerHosts allowlist`)
  }

  const loopback = isLoopbackHost(host)
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    return refuse(`host '${host}' must be reached over https (got ${url.protocol})`)
  }

  if (isIpLiteral(host) && !loopback && !isGlobalIp(host)) {
    return refuse(`host '${host}' is a non-routable address; internal endpoints are refused`)
  }

  return ok(undefined)
}
