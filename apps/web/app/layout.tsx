import type { ReactNode } from 'react'

export const metadata = {
  title: 'conduit',
  description: 'conduit — the agent tool/action execution platform',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
