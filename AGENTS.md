# AGENTS.md

## Internal Error Handling

Use `better-result` for internal orchestration and connected-state flows.

Do not use `better-result` as the default style for every function.

## Where To Use `better-result`

Use it in code that coordinates across subsystems, such as:

- UI state + workbook state
- workbook state + formula engine
- multi-step operations that can fail for expected runtime reasons
- logic where tracing and step-by-step debugging matter

Typical examples:

- formula/workbook bridges
- coordinator modules
- sync/reconciliation paths

## Where Not To Use It

Keep plain TypeScript for:

- pure transforms
- local state mutations with obvious control flow
- simple getters/setters
- hot-path utility code

Do not expose `Result`-heavy internals as the public component API unless there is a strong reason.

## Rules

- Throw only for programmer misuse or broken invariants.
- Use `Result` for expected runtime failures.
- Prefer `TaggedError` over generic string errors.
- Do not silently swallow errors in orchestration code. Wrap them with `Result.try` or `Result.tryPromise`.
- Do not use `null`/`false` to represent rich failure states when a `Result` would make the cause explicit.
- For intentional no-op outcomes, prefer `Ok(...)` with an explicit outcome over ambiguous `null`.

## Traceability

Use `Result.gen(...)` for multi-step workflows where short-circuiting and readable control flow help.

Use `tap`, `tapError`, or similar helpers at subsystem boundaries to emit structured debug traces.

The goal is consistent, inspectable internal logic, not blanket functional abstraction.
