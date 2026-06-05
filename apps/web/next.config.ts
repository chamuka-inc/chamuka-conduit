import type { NextConfig } from 'next'

// The @conduit/* workspace packages expose TypeScript source directly (the internal-packages
// pattern — no build step), so Next must transpile them rather than expecting prebuilt JS.
const nextConfig: NextConfig = {
  transpilePackages: [
    '@conduit/contracts',
    '@conduit/core',
    '@conduit/catalog',
    '@conduit/identity',
    '@conduit/credvault-client',
    '@conduit/provider-invoker',
    '@conduit/store',
  ],
}

export default nextConfig
