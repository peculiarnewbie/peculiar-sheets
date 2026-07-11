# Plan 002: Commit undo and redo only after formula synchronization

> **Executor instructions**: Follow this plan step by step and update Plan 002 in `plans/README.md` when complete.
>
> **Drift check (run first)**: `git diff --stat 6def943..HEAD -- packages/spreadsheets/src/grid/Grid.tsx packages/spreadsheets/src/grid packages/spreadsheets/src/core/state.ts packages/spreadsheets/src/formula/bridge.ts`

## Status

- **Priority:** P1
- **Effort:** M
- **Risk:** MED
- **Depends on:** `plans/001-grid-coordination-test-seam.md`
- **Category:** bug
- **Planned at:** commit `6def943`, 2026-07-11

## Why this matters

Undo and redo currently mutate local state and advance history before HyperFormula accepts the equivalent operation. A formula engine failure leaves the visual grid, formula results, and history stacks inconsistent. Make the command atomic from a consumer perspective: on failure, nothing changes and no callback fires; on success, current callback payloads and controller APIs stay exactly as they are.

## Current state

- `packages/spreadsheets/src/core/state.ts:767-835` mutates history, selection, rows, cells, and sizing during `undo()`.
- `packages/spreadsheets/src/core/state.ts:838-890` does the equivalent work for `redo()`.
- `packages/spreadsheets/src/grid/Grid.tsx:2026-2042` and `Grid.tsx:2059-2075` synchronize only afterward; the imperative controller duplicates this pattern at `Grid.tsx:2405-2459`.

The relevant current order is:

```ts
const result = props.store.undo();
if (result?.mutations.length) {
  if (!syncAlreadyAppliedMutationsToFormulaEngine(result.mutations)) break;
  props.onOperation?.({ type: "batch-edit", mutations: result.mutations });
}
```

Internal failures use `Result` and `TaggedError`; expected runtime synchronization failures must be traceable and must not be silently swallowed. Public component methods currently return `void`; preserve that API.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Focused coordination tests | `bun test packages/spreadsheets/src/grid/<coordination module>.test.ts` | all pass |
| Library tests | `bun test packages/spreadsheets/src` | all tests pass |
| Typecheck | `pnpm typecheck` | exit 0 |

## Scope

**In scope:**

- `packages/spreadsheets/src/core/state.ts`
- Plan 001 coordination module and tests
- `packages/spreadsheets/src/grid/Grid.tsx`
- Formula bridge test doubles only if needed for failure injection

**Out of scope:**

- Public prop/controller types and public `Result` exports.
- Workbook coordinator undo/redo; that belongs to Plan 005.
- Batch-write performance changes; that belongs to Plan 003.

## Steps

### Step 1: Add a prepare/commit or snapshot/restore transaction capability to the store

Choose the least invasive internal design that lets the coordinator obtain the intended undo/redo outcome without permanently mutating state before formula synchronization. Prefer an explicit prepare/commit operation over applying then manually reconstructing state. If the current history helpers make preparation impractical, capture every mutable store concern—cells, row IDs, dimensions, selection, sizing, and history—and restore all of them on failure.

Do not change the public `SheetStore` surface unless it is purely internal to this package; it is not exported from `src/index.ts`.

**Verify:** focused Plan 001 tests show a failed mutation undo/redo leaves cells, selection, and `canUndo`/`canRedo` exactly unchanged.

### Step 2: Route keyboard and imperative undo/redo through the transaction

Replace both command-handler and `SheetController` duplicate flows in `Grid.tsx` with the Plan 001 seam. Synchronize the full proposed state for structural changes and the proposed mutations for ordinary history entries. Only commit local state and emit `onOperation` after synchronization returns an applied Result.

Preserve existing successful callback types: `batch-edit`, `row-insert`, `row-delete`, `row-reorder`, column sizing, and row sizing. Do not emit partial callbacks if a later synchronization stage fails.

**Verify:** focused tests cover mutation undo, mutation redo, row-operation undo/redo, and formula synchronization failure for each path.

### Step 3: Add regression coverage for history-stack integrity

Add tests that inject a bridge failure, assert the original command remains available, then remove the failure and assert the same undo/redo succeeds once. Include an assertion that no `onOperation` callback occurred during the failed attempt.

**Verify:** `bun test packages/spreadsheets/src/grid/<coordination module>.test.ts` → all tests pass.

## Test plan

- Use Plan 001's fake synchronizer for deterministic failure injection.
- Add one mutation and one structural history case for both undo and redo.
- Assert cells, row IDs, selection, history availability, bridge call count, and emitted operations.

## Done criteria

- [ ] Formula sync failure causes no local store, history, selection, or callback change.
- [ ] A retry after clearing the injected failure succeeds normally.
- [ ] Keyboard and `SheetController` paths share the same internal coordination logic.
- [ ] `bun test packages/spreadsheets/src` and `pnpm typecheck` pass.
- [ ] Plan 002 is marked DONE.

## STOP conditions

- Atomicity requires changing `SheetController.undo` or `.redo` return types.
- A required engine operation cannot evaluate proposed state without committing it first and a complete rollback snapshot cannot be made internally.
- Any public callback payload must change to represent failure.

## Maintenance notes

This is a patch-compatible bug fix. Reviewers should specifically inspect that all mutable store fields, not just cell values, remain unchanged when synchronization fails.
