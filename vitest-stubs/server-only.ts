// Test stub for the `server-only` marker package. Its real entrypoint throws unless resolved under
// the React Server Component ("react-server") condition, which Vitest (plain Node) does not set, so
// vitest.config aliases `server-only` here — a no-op — to let server modules be unit-tested.
export {}
