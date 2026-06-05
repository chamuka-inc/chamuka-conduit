import { z } from 'zod'

// Opaque identifier types. Branding primitives prevents mixing them up at call sites
// (no primitive obsession — ENGINEERING_DISCIPLINE.md).

export const TenantId = z.string().min(1).brand<'TenantId'>()
export type TenantId = z.infer<typeof TenantId>

export const EndUserId = z.string().min(1).max(255).brand<'EndUserId'>()
export type EndUserId = z.infer<typeof EndUserId>

/** `<provider>.<verb>`, lowercase snake within each segment (FR-1). */
export const ActionName = z
  .string()
  .regex(/^[a-z0-9_]+\.[a-z0-9_]+$/, 'action name must be "<provider>.<verb>"')
  .brand<'ActionName'>()
export type ActionName = z.infer<typeof ActionName>

export const IdempotencyKey = z.string().min(1).max(255).brand<'IdempotencyKey'>()
export type IdempotencyKey = z.infer<typeof IdempotencyKey>
