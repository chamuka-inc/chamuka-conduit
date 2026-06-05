import { z } from 'zod'
import { ActionName, EndUserId, IdempotencyKey } from './ids'

/** A request to execute one action for one end-user (FR-4). */
export const ExecuteRequest = z.object({
  action: ActionName,
  endUserId: EndUserId,
  args: z.record(z.string(), z.unknown()),
  idempotencyKey: IdempotencyKey.optional(),
})
export type ExecuteRequest = z.infer<typeof ExecuteRequest>

/**
 * The envelope every successful action returns (FD-3). `data` is the schema-validated
 * normalized projection; `raw` is the provider's untouched response (the escape hatch).
 */
export const ExecuteResult = z.object({
  data: z.unknown(),
  raw: z.unknown(),
})
export type ExecuteResult = z.infer<typeof ExecuteResult>
