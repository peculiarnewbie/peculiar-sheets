# Plan 003: Synchronize batch mutations without replacing full sheets

> **Executor instructions**: Follow each step, run each verification command, and update Plan 003 in `plans/README.md` when complete.
>
> **Drift check (run first)**: `git diff --stat 6def943..HEAD -- packages/spreadsheets/src/grid/Grid.tsx packages/spreadsheets/src/formula/bridge.ts packages/spreadsheets/src/formula/bridge.test.ts packages/spreadsheets/src/workbook/hf-interface.ts`

## Status

- **Priority:** P1
- **Effort:** M
- **Risk:** MED
- **Depends on:** `plans/001-grid-coordination-test-seam.md`
- **Category:** perf
- **Planned at:** commit `6def943`, 2026-07-11

## Why this matters

Pasting, autofilling, deleting a range, and mutation-only undo/redo can touch a handful of cells but currently clone and normalize the full grid before calling HyperFormula `setSheetContent`. On large sheets this creates O(all cells) allocations for O(changed cells) work. Add an internal batch bridge operation that updates only changed cells while preserving formula normalization, Result-based failure handling, revision updates, and existing public behavior.

## Current state

- `packages/spreadsheets/src/grid/Grid.tsx:904-925` clones `props.store.cells`, applies every pending mutation, then calls `formulaBridge.syncAll`.
- `packages/spreadsheets/src/formula/bridge.ts:274-317` maps every row and cell before calling `hf.setSheetContent`.
- `packages/spreadsheets/src/formula/bridge.ts:320-365` already provides the single-cell `setCell` result/error/trace pattern to extend.

Current expensive path:

```ts
function syncMutationsToFormulaEngine(mutations: CellMutation[]) {
  return didApplyFormulaBridgeOperation(
    props.formulaBridge.syncAll(buildCellsAfterMutations(mutations)),
  );
}
```

Structural inserts, deletes, row order changes, and explicit full resyncs intentionally use `syncAll`; do not change them in this patch.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Formula bridge tests | `bun test packages/spreadsheets/src/formula/bridge.test.ts` | all pass |
| Library tests | `bun test packages/spreadsheets/src` | all tests pass |
| Typecheck | `pnpm typecheck` | exit 0 |

## Scope

**In scope:**

- `packages/spreadsheets/src/formula/bridge.ts`
- `packages/spreadsheets/src/formula/bridge.test.ts`
- `packages/spreadsheets/src/workbook/hf-interface.ts` only if the bridge type needs an existing HyperFormula batch API
- `packages/spreadsheets/src/grid/Grid.tsx`
- Plan 001 coordination tests if they verify batch paths

**Out of scope:**

- Public formula engine config, package exports, and HyperFormula version changes.
- Workbook coordinator structural synchronization and history (Plans 005–006).
- Changing individual edit behavior, which should remain on `setCell` unless batching provides a demonstrably equivalent path.

## Steps

### Step 1: Confirm the supported HyperFormula batch-write API and model it internally

Inspect the installed HyperFormula types and its existing use in this repo. Prefer one engine call that accepts a contiguous range/matrix; when mutations are disjoint, group them into the smallest safe contiguous ranges or use individual `setCellContents` calls. Do not invent an API or bypass TypeScript with `any`.

Extend the internal bridge interface with `setCells` / `applyMutations` returning the same `FormulaBridgeOperationResult` style as `setCell`. Normalize repeated-leading-equals values exactly as `setCell` does. Ensure any expected engine failure is wrapped in a specific tagged error and traced.

**Verify:** `pnpm typecheck` → exit 0 with no unsafe casts added to production code.

### Step 2: Add bridge-level regression and allocation-shape tests

Extend the mock engine in `formula/bridge.test.ts` to record full-sheet writes and cell/range writes. Test that a batch of formulas and literals produces correct display values, bumps the revision once per successful batch, normalizes formulas, and does not call `setSheetContent`. Test a failing batch returns an error Result without claiming success.

**Verify:** `bun test packages/spreadsheets/src/formula/bridge.test.ts` → all tests pass.

### Step 3: Replace Grid mutation-only full sync calls

Route `syncMutationsToFormulaEngine` and `syncAlreadyAppliedMutationsToFormulaEngine` through the new bridge batch operation. Remove `buildCellsAfterMutations` only if no other live code needs it. Keep `syncAllToFormulaEngine` unchanged for structural operations and recovery.

**Verify:** `rg -n "syncAll\(buildCellsAfterMutations" packages/spreadsheets/src/grid` → no matches; full library test suite passes.

### Step 4: Add a deterministic scale guard

Add a unit test with a large in-memory matrix and a one- or few-cell batch. Assert the mock records no full-sheet write and receives only the expected changed cells/ranges. Do not assert elapsed milliseconds in CI.

**Verify:** `bun test packages/spreadsheets/src/formula/bridge.test.ts` → all tests pass including the scale guard.

## Done criteria

- [ ] Mutation-only batch paths never call `setSheetContent`.
- [ ] Full/structural synchronization still calls `syncAll` and retains current behavior.
- [ ] Formula normalization, revision semantics, and Result/trace error behavior are tested.
- [ ] `bun test packages/spreadsheets/src` and `pnpm typecheck` pass.
- [ ] Plan 003 is marked DONE.

## STOP conditions

- The installed HyperFormula version lacks a typed safe API for the proposed batch mechanism.
- Correct batching requires changing the public `FormulaEngineConfig` shape or adding a dependency.
- A batch failure can leave some engine cells changed without a workable recovery path; report this together with the exact engine behavior.

## Maintenance notes

Keep the public bridge full-sync capability as the recovery and structural-operation path. New Grid features that create multiple cell mutations must use the batch bridge rather than rebuilding `store.cells`.
