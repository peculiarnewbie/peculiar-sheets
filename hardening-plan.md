# Hardening Plan

## Goals

- Make invalid TypeScript states harder to represent.
- Keep public APIs stable unless a breaking change is explicitly chosen.
- Prefer small, verifiable slices over broad rewrites.
- Use `better-result` where orchestration failures need explicit causes, not as a blanket style.

## Recommended Order

1. Fix strict TypeScript drift

   Current plain `tsc` checks surface `exactOptionalPropertyTypes` issues that the package build does not block on. Fix these before adding new abstractions.

   - Avoid constructing `CellMutation` with `viewAddress: undefined` or `rowId: undefined`.
   - Avoid constructing `UndoRedoResult` with optional fields explicitly set to `undefined`.
   - Re-run package build and targeted tests after this slice.

2. Remove remaining runtime non-null assertions

   Keep test assertions as-is where useful, but reduce runtime `!` usage in production code.

   Focus areas:

   - `packages/spreadsheets/src/grid/Grid.tsx`: `workbookCoordinator()!` access.
   - `packages/spreadsheets/src/grid/Grid.tsx`: DOM refs such as `gridRef!`.
   - `packages/spreadsheets/src/grid/Grid.tsx`: computed rect reads such as `editCellRect()!`.

   Prefer local guards when absence is possible. Throw only for broken invariants.

3. Add typed e2e helper wrappers

   The shared e2e `Window` globals are now available to tests, but many test files still cast through `(window as any)`. Replace repeated casts with helper functions.

   Candidate helpers:

   - `getSheetController()`
   - `getWorkbookController(sheetKey)`
   - `getWorkbookData(sheetKey)`
   - `getWorkbookChanges()`

   This keeps test code readable and moves global shape assumptions into one typed place.

4. Add internal branded index and id types gradually

   Do not brand the public API first. Start inside the implementation where row/index mixups are most likely.

   Candidate brands:

   - `PhysicalRowIndex`
   - `VisualRowIndex`
   - `ColumnIndex`
   - `RowId`
   - `FormulaSheetId`

   Recommended first targets:

   - `packages/spreadsheets/src/grid/Grid.tsx` helper boundaries.
   - `packages/spreadsheets/src/core/state.ts` row id and physical row lookups.
   - `packages/spreadsheets/src/formula/bridge.ts` formula sheet ids.

5. Convert ambiguous orchestration-adjacent `null` results selectively

   Public UI helpers can stay simple, but internal subsystem boundaries should return explicit outcomes when the caller benefits from knowing why no action happened.

   Candidate areas:

   - workbook/controller lookup paths
   - row id to physical row lookup paths used during sync/reconciliation
   - undo/redo orchestration where `history-empty` is a meaningful no-op

   Use `OperationOutcome` / `ResultLike` only when the failure or no-op reason changes control flow or traceability.

6. Split `Grid.tsx` only around stable behavior seams

   Avoid extraction for aesthetics alone. Extract when a module has a clear boundary and tests can protect it.

   Candidate seams:

   - formula bridge sync helpers
   - edit/formula-bar state transitions
   - resize session helpers
   - sort state and row-order helpers

7. Add a reliable typecheck script

   Once existing strict TypeScript drift is resolved, add scripts that make type correctness easy to run locally and in CI.

   Candidate scripts:

   - `typecheck:lib`
   - `typecheck:e2e`
   - `typecheck`

   Keep source and test typechecks separate if test-only dependencies require different type environments.

## Verification

Run these after each implementation slice:

```sh
pnpm --filter peculiar-sheets build
pnpm --filter @peculiarnewbie/e2e build
```

Run targeted tests for touched behavior:

```sh
bun test packages/spreadsheets/src/core/history.test.ts
bun test packages/spreadsheets/src/formula/bridge.test.ts
bun test packages/spreadsheets/src/workbook/coordinator.test.ts
```

For browser behavior changes, run the e2e suite when the environment supports it:

```sh
bun run tests/e2e/run.ts
```

## Current Baseline Notes

- `pnpm --filter peculiar-sheets build` passes.
- `pnpm --filter @peculiarnewbie/e2e build` passes after the library build has produced `dist`.
- The library build currently emits an existing `tsdown` warning about an invalid `define` option.
- Plain `tsc` currently reports existing strictness issues, including `exactOptionalPropertyTypes` problems and test type environment gaps. Treat those as the first hardening slice.
