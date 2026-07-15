# Plan 005: Make workbook structural operations atomic

> **Executor instructions**: Follow this plan step by step. Stop and report rather than broadening the public API. Update Plan 005 in `plans/README.md` on completion.
>
> **Drift check (run first)**: `git diff --stat 6def943..HEAD -- packages/spreadsheets/src/workbook/structural-engine.ts packages/spreadsheets/src/workbook/coordinator.ts packages/spreadsheets/src/workbook/*.test.ts packages/spreadsheets/src/workbook/hf-interface.ts`

## Status

- **Priority:** P1
- **Effort:** M
- **Risk:** HIGH
- **Depends on:** `plans/001-grid-coordination-test-seam.md`
- **Category:** bug / migration
- **Planned at:** commit `6def943`, 2026-07-11

## Why this matters

A workbook insert, delete, or reorder involves multiple engine writes, snapshot construction, history updates, and subscriber delivery. If any stage fails after the engine changes, current code returns an error but may leave a partially changed workbook without a history entry or emitted host snapshot. Major-version work must establish a clear contract: a failed structural operation leaves every registered sheet, runtime cache, history stack, and subscribers as though the operation never began.

## Current state

- `packages/spreadsheets/src/workbook/structural-engine.ts:101-138` synchronizes each registered sheet sequentially and mutates `lastKnownCells` as it goes.
- `structural-engine.ts:140-175` serializes every registered engine sheet and updates each runtime cache.
- `structural-engine.ts:269-283` syncs, snapshots, calls the engine mutation, snapshots again, pushes history, and emits a change without rollback between stages.
- `packages/spreadsheets/src/workbook/coordinator.test.ts:240-260` confirms snapshot errors are traced, but does not assert no engine state changed.

Current non-atomic flow:

```ts
yield* trySyncRegisteredSheetsToEngine(registry);
const before = yield* tryBuildSnapshots(registry);
yield* Result.try({ try: () => { apply(); }, catch: toStructuralError });
const after = yield* tryBuildSnapshots(registry);
onHistoryPush({ origin, before, after });
return Result.ok(applied(emitChange(origin, after)));
```

This repository uses `Result.gen`, `Result.try`, tagged errors, and trace events for orchestration. Match that pattern; never represent a failed rollback with `null` or swallow it.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Workbook tests | `bun test packages/spreadsheets/src/workbook/coordinator.test.ts` | all pass |
| Library tests | `bun test packages/spreadsheets/src` | all tests pass |
| Typecheck | `pnpm typecheck` | exit 0 |

## Scope

**In scope:**

- `packages/spreadsheets/src/workbook/structural-engine.ts`
- `packages/spreadsheets/src/workbook/coordinator.ts`
- `packages/spreadsheets/src/workbook/history.ts` only for internal rollback bookkeeping
- `packages/spreadsheets/src/workbook/hf-interface.ts`
- `packages/spreadsheets/src/workbook/coordinator.test.ts`
- Internal errors/trace files only when a precise rollback error type is required

**Out of scope:**

- Snapshot compression/delta history optimization (Plan 006).
- Public addition/removal of exported methods or callbacks.
- Row-metric and normal formula-bridge performance changes.

## Steps

### Step 1: Characterize atomic failure semantics with fault injection

Extend workbook tests with a controllable engine wrapper or method overrides. For each failure point—syncing a later sheet, initial snapshot construction, structural mutation, and after-snapshot construction—assert all sheets’ serialized contents equal their pre-operation contents, `canUndo`/`canRedo` remain unchanged, runtime caches are unchanged, and subscribers receive no structural change.

Use a two-sheet workbook with a cross-sheet formula so failures cannot be hidden by testing one sheet only.

**Verify:** `bun test packages/spreadsheets/src/workbook/coordinator.test.ts` → new failure tests fail against the old implementation in the expected way, then pass after the fix.

### Step 2: Capture a rollback-safe pre-operation state before mutation

Build a private full-workbook rollback snapshot before any engine or runtime cache mutation. Keep this distinct from any public change payload. Apply sync and structural work inside a Result-governed transaction. On failure, restore every engine sheet from the rollback snapshot and restore runtime `lastKnownCells`; do not push history or emit a listener event.

If restoration itself fails, return a tagged error containing the original operation failure and rollback failure context, and trace both. Do not claim an ordinary no-op.

**Verify:** all injected failure cases restore exact serialized sheet contents and have zero subscriber calls.

### Step 3: Preserve successful behavior and document the failure contract

Retain existing successful change snapshots, `Result` variants, undo/redo behavior, and trace fields where possible. Update `packages/spreadsheets/README.md` only if it describes an incompatible failed-operation behavior; add a release-note entry in the repository’s established release location, or report that no release-note convention exists.

**Verify:** full library test suite passes and successful insert/delete/reorder tests still assert cross-sheet formulas and emitted snapshots.

## Done criteria

- [x] No failed structural operation leaves any registered HyperFormula sheet or runtime cache changed.
- [x] Failed operations do not change history availability or emit `WorkbookStructuralChange`.
- [x] Rollback failure is explicit, tagged, and traced with original cause context.
- [x] Successful public result shape remains backward compatible unless the major-release decision explicitly documents a change.
- [x] `bun test packages/spreadsheets/src` and `pnpm typecheck` pass.
- [x] Plan 005 is marked DONE.

## STOP conditions

- HyperFormula cannot restore a serialized snapshot sufficiently to recreate formulas and values.
- A rollback needs input that `HyperFormulaWorkbookLike` does not expose and cannot be added internally without breaking consumer-provided engine typings.
- The desired public behavior for a rollback failure is ambiguous; report alternatives instead of selecting one.

## Maintenance notes

Plan 006 must preserve this transaction boundary. Any new structural operation must be registered in rollback capture and the fault-injection matrix before being exposed to consumers.
