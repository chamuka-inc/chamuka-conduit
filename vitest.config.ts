import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['packages/**/test/**/*.test.ts', 'apps/**/test/**/*.test.ts'],
    environment: 'node',
  },
  resolve: {
    alias: {
      // `server-only`'s real entrypoint throws outside a React Server Component; Vitest runs plain
      // Node, so map it to a no-op stub to let the server-only container/lib be unit-tested.
      'server-only': fileURLToPath(new URL('./vitest-stubs/server-only.ts', import.meta.url)),
    },
  },
})
