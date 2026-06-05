// @conduit/core — the Executor (FR-4), conduit's execution heart. Orchestrates the per-request
// pipeline (resolve action → validate args → idempotency → broker token → render + invoke →
// normalize → audit) over the frozen ports, returning a Result on the closed error taxonomy (FR-5)
// rather than throwing. Compile-time deps are only @conduit/contracts and @conduit/provider-invoker's
// pure renderRequest; the resolver/invoker/store/catalog impls reach it through injected ports, so no
// cycle is expressible. Also exports the pure utilities the pipeline is built from.

export { Executor } from './executor'
export type { ExecutorPorts, ExecutorOptions } from './executor'
export { ArgsValidator } from './validate-args'
export { normalize } from './normalize'
