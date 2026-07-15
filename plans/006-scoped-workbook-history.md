# Plan 006: Replace workbook-wide structural snapshots with scoped history

> **Executor instructions**: Complete Plan 005 first. Do not begin implementation until its atomic-failure tests pass. Update Plan 006 in `plans/README.md` when complete.
>
> **Drift check (run first)**: `git diff --stat 6def943..HEAD -- packages/spreadsheets/src/workbook/structural-engine.ts packages/spreadsheets/src/workbook/history.ts packages/spreadsheets/src/workbook/types.ts packages/spreadsheets/src/workbook/coordinator.ts packages/spreadsheets/src/workbook/*.test.ts packages/spreadsheets/README.md`

## Status

- **Priority:** P2
- **Effort:** L
- **Risk:** HIGH
- **Depends on:** `plans/005-atomic-workbook-structural-operations.md`
- **Category:** perf / migration
- **Planned at:** commit `6def943`, 2026-07-11

## Why this matters

Every structural operation currently rewrites all registered sheets, serializes all sheets twice, and retains full before/after cell matrices in history. Work and memory therefore scale with total workbook size rather than the affected operation. Reduce this cost without weakening Plan 005 atomicity or silently changing the public snapshot contract; because subscriber snapshots and undo behavior are externally observable, this is deliberately major-version work.

## Current state

- `packages/spreadsheets/src/workbook/structural-engine.ts:101-134` normalizes, writes, and clones each registered sheet before every operation.
- `structural-engine.ts:140-175` serializes and clones every sheet for each snapshot.
- `structural-engine.ts:269-283` builds full before and after snapshots and stores them through `onHistoryPush`.
- `packages/spreadsheets/src/workbook/history.ts` owns the undo/redo stack; inspect its current entry representation before designing deltas.
- `packages/spreadsheets/src/workbook/types.ts` defines `WorkbookStructuralChange` and its `snapshots` payload. It is public through `src/index.ts`; compatibility requires explicit versioned documentation.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Workbook tests | `bun test packages/spreadsheets/src/workbook` | all pass |
| Library tests | `bun test packages/spreadsheets/src` | all tests pass |
| Typecheck | `pnpm typecheck` | exit 0 |
| Build | `pnpm build:lib` | exits 0 and produces package output |

## Scope

**In scope:**

- `packages/spreadsheets/src/workbook/structural-engine.ts`
- `packages/spreadsheets/src/workbook/history.ts`
- `packages/spreadsheets/src/workbook/types.ts`
- `packages/spreadsheets/src/workbook/coordinator.ts`
- workbook tests and README/release documentation

**Out of scope:**

- Normal cell edit history, Grid batching, and row metrics.
- Changes to HyperFormula itself or a dependency upgrade.
- Implementing workbook tabs, rename, or column structure operations.

## Steps

### Step 1: Benchmark and specify the versioned public contract before coding

Create a deterministic benchmark or test helper that records engine calls and snapshot cell counts for a workbook with multiple sheets. Establish the current baseline for one row insert, delete, reorder, undo, and redo. Then write the target contract: whether `WorkbookStructuralChange.snapshots` keeps its current all-sheet shape, becomes opt-in, or changes to affected snapshots/deltas. If it changes, document the breaking migration precisely in the README and changelog before implementation.

Do not use elapsed wall-clock assertions as the primary gate; assert fewer full-sheet writes, serializations, and retained cell copies.

**Verify:** a committed test/benchmark records a baseline that fails if the optimized implementation regresses to all-sheet work for ordinary operations.

### Step 2: Design history as reversible operation deltas plus minimal restoration state

Replace full before/after history entries with a private reversible representation. It must record enough information to undo/redo inserts, deletes, and row reorders, including formula effects and every sheet whose content genuinely changes. Reuse Plan 005’s rollback snapshot only for the in-flight transaction; do not retain it as routine history unless benchmark evidence proves no smaller correct representation exists.

Keep explicit `Result` and tagged errors around engine reads/writes. Do not use `null` to represent an unavailable inverse.

**Verify:** isolated history tests show each operation can undo and redo repeatedly without drift.

### Step 3: Minimize engine synchronization and snapshot generation

Synchronize only sheets whose host-backed content changed since the last confirmed engine state. Serialize only the sheets needed for the public change contract and the reversible delta. Preserve exact cross-sheet formula correctness by testing a dependent summary sheet after data-sheet changes.

If the established v2 contract preserves all-sheet subscriber snapshots, generate that payload at the notification boundary without also retaining duplicate full snapshots in history. If that cost is still unacceptable, stop and report the measured conflict rather than silently changing the payload.

**Verify:** instrumented tests prove the history entry does not retain full before/after matrices for unaffected sheets, while public subscriber payloads match the documented v2 contract.

### Step 4: Re-run atomic failure matrix and publish migration notes

Run every Plan 005 failure injection after the optimization. Add tests for failure during delta application, inverse application, and public snapshot generation. Ensure rollback still restores every sheet and no listener sees partial state.

Update the README’s workbook section and release notes with the major-version migration instructions, changed history/snapshot guarantees, and any compatibility adapter if one is intentionally provided.

**Verify:** `bun test packages/spreadsheets/src`; `pnpm typecheck`; `pnpm build:lib` all succeed.

## Test plan

- Multi-sheet data + summary formula scenarios for insert, delete, reorder, undo, and redo.
- Engine-call/snapshot-size instrumentation for affected versus unaffected sheets.
- All Plan 005 injected failure points plus delta-specific failures.
- Public TypeScript compilation tests for any intentionally changed `WorkbookStructuralChange` contract.

## Done criteria

- [x] Structural history does not retain duplicate full before/after snapshots for unaffected sheets.
- [x] Measured engine writes and serializations scale with affected work wherever HyperFormula semantics allow it.
- [x] Cross-sheet formula display, undo/redo, and atomic rollback tests pass.
- [x] Any public snapshot/history contract change is documented as a major migration.
- [x] `bun test packages/spreadsheets/src`, `pnpm typecheck`, and `pnpm build:lib` pass.
- [x] Plan 006 is marked DONE.

## Measurement notes (post-review)

On a confirmed three-sheet workbook, a successful insert performs **3** `getSheetSerialized` calls (one public `after` pass), not 9. Confirmed rollback capture and cache-built `before` snapshots skip serialization. The scoped-history instrumentation test asserts both `setSheetContent` skips for clean sheets and `getSheetSerializedCalls === sheetCount`.

## STOP conditions

- Cross-sheet formulas require full workbook serialization to calculate a correct inverse and no smaller representation can be demonstrated.
- The proposed optimization alters the public `WorkbookStructuralChange` payload without an agreed v2 migration contract.
- Benchmark instrumentation shows that generating the retained public snapshot dominates all cost and consumers require the all-sheet payload unchanged.

## Maintenance notes

The major release should communicate this as a workbook-history contract change, not merely a performance improvement. Future structural operations must supply a reversible delta, an atomic rollback strategy, and instrumentation proving their affected-sheet scope.
