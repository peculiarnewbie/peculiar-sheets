# Internal `better-result` Conventions

This package uses `better-result` for orchestration and connected-state flows, not for every function.

## Use `Result` for

- workbook and formula-engine coordination
- multi-step operations with runtime failure modes
- flows where explicit no-op vs error matters
- places where structured trace events improve debugging

## Keep Plain TypeScript for

- pure transforms
- selection and history math
- obvious local mutations
- render-path helpers that do not cross subsystem boundaries

## Semantics

- `throw`: programmer misuse or broken invariants
- `Ok({ kind: "applied", ... })`: operation completed
- `Ok({ kind: "noop", reason: ... })`: expected non-action
- `Err(TaggedError)`: runtime failure worth tracing

## Tracing

Important orchestration boundaries emit structured events through the internal trace sink in `src/internal/trace.ts`.

Trace events use:

- `module`
- `operation`
- `phase`
- `status`
- timestamp
- contextual payload

The sink is internal-only and defaults to a no-op.
