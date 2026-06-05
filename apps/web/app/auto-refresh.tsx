'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

// A leaf client component that periodically re-runs the dashboard's Server Component query via
// router.refresh(). This keeps the audit read server-side (no audit HTTP endpoint, no client data
// layer) while making the operator view tick over on its own. It's smart polling, not push.
export function AutoRefresh({ intervalMs }: { intervalMs: number }) {
  const router = useRouter()
  useEffect(() => {
    const id = setInterval(() => router.refresh(), intervalMs)
    return () => clearInterval(id)
  }, [router, intervalMs])
  return null
}
