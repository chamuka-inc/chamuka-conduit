import { getServices, recentAuditEntries } from '@/lib/server/container'
import { AutoRefresh } from './auto-refresh'

const REFRESH_INTERVAL_MS = 4000

// Minimal read-only operator dashboard: the action catalog conduit exposes and the most recent
// execution audit records. A server component reading the same packages the surfaces use, so it
// proves the wiring without a separate read API; richer operator views are a later increment.

export const dynamic = 'force-dynamic'

const cell: React.CSSProperties = { padding: '6px 12px', borderBottom: '1px solid #e5e5e5', textAlign: 'left' }
const head: React.CSSProperties = { ...cell, borderBottom: '2px solid #ccc', fontWeight: 600 }
const mono: React.CSSProperties = { fontFamily: 'ui-monospace, monospace' }

export default async function DashboardPage() {
  const actions = getServices().catalog.list()
  const audit = await recentAuditEntries(20)

  return (
    <main style={{ maxWidth: 920, margin: '40px auto', padding: '0 20px', fontFamily: 'system-ui, sans-serif', color: '#1a1a1a' }}>
      <AutoRefresh intervalMs={REFRESH_INTERVAL_MS} />
      <h1 style={{ marginBottom: 4 }}>conduit</h1>
      <p style={{ color: '#666', marginTop: 0 }}>
        Agent tool/action execution — operator view{' '}
        <span style={{ color: '#999' }}>· live (auto-refreshing every {REFRESH_INTERVAL_MS / 1000}s)</span>
      </p>

      <section>
        <h2>Action catalog ({actions.length})</h2>
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead>
            <tr>
              <th style={head}>Action</th>
              <th style={head}>Provider</th>
              <th style={head}>Description</th>
            </tr>
          </thead>
          <tbody>
            {actions.map((action) => (
              <tr key={action.name}>
                <td style={{ ...cell, ...mono }}>{action.name}</td>
                <td style={cell}>{action.provider}</td>
                <td style={cell}>{action.description}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section style={{ marginTop: 36 }}>
        <h2>Recent executions ({audit.length})</h2>
        {audit.length === 0 ? (
          <p style={{ color: '#666' }}>No executions recorded yet.</p>
        ) : (
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <thead>
              <tr>
                <th style={head}>Started</th>
                <th style={head}>Tenant</th>
                <th style={head}>End user</th>
                <th style={head}>Action</th>
                <th style={head}>Outcome</th>
                <th style={head}>Latency</th>
              </tr>
            </thead>
            <tbody>
              {audit.map((row, i) => (
                <tr key={`${row.startedAt}-${i}`}>
                  <td style={cell}>{row.startedAt}</td>
                  <td style={{ ...cell, ...mono }}>{row.tenantId}</td>
                  <td style={cell}>{row.endUserId}</td>
                  <td style={{ ...cell, ...mono }}>{row.action}</td>
                  <td style={{ ...cell, color: row.outcome === 'ok' ? '#137333' : '#b3261e' }}>{row.outcome}</td>
                  <td style={cell}>{row.latencyMs} ms</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  )
}
