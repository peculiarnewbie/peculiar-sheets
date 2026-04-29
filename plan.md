# Plan — Public API improvements for v0.8.0

Based on consumer feedback from Electroswag's use of `peculiar-sheets`.
Six items, all targeted for the next release.

---

## 1. ✅ Export A1 parsing utilities

### What exists
`columnIndexToLetters` and `lettersToColumnIndex` are implemented in
`formula/references.ts` but not re-exported from `index.ts`. The internal
`parseA1Reference` exists in the same module but returns the full internal
`ParsedA1Reference` shape with absolute/relative flags.

### Done
- `columnIndexToLetters`, `lettersToColumnIndex`, and `parseA1Address` are all exported from `index.ts`.
- `parseA1Address` returns 0-indexed `{ row, col }` and `null` for unparseable input.

### Files
- `packages/spreadsheets/src/index.ts` — exports added
- `packages/spreadsheets/src/formula/references.ts` — `parseA1Address` exists

---

## 2. ✅ Export runtime validation helpers

### Why
The library owns the `CellValue` type contract, so it should own the runtime
guards. Consumers should be able to ask "does the library consider this valid?"
without reimplementing the check locally and risking divergence.

### Done
Module `src/core/validators.ts` exists with `isCellValue`, `isCellMatrix`,
`normalizeCellValue`, `normalizeCellMatrix`. All four exported from `index.ts`.

### Files
- `packages/spreadsheets/src/core/validators.ts` — exists
- `packages/spreadsheets/src/index.ts` — exports added

---

## 3. ✅ Allow `Promise<void>` on callbacks

### Why
Consumers (Electroswag) use `async` handlers for session-store writes and API
calls. The types should reflect real-world usage even if the Grid does not await
the returned promise.

### Done
All mutation/row callbacks in `SheetProps` already have `void | Promise<void>`
return types. The new `onOperation` callback (item 4) also uses this pattern.

### Files
- `packages/spreadsheets/src/types.ts` — updated

---

## 4. ✅ Unified `onOperation` callback (breaking change)

### Why
The current API had five separate callbacks for mutation/row events, forcing
consumers to wire up five handlers that often share the same orchestration
logic (command-log, session-store). A single discriminated union lets the
consumer write one `switch` statement.

### Done

Added `SheetOperation` discriminated union type in `types.ts`:

```typescript
type SheetOperation =
  | { type: "cell-edit"; mutation: CellMutation }
  | { type: "batch-edit"; mutations: CellMutation[] }
  | { type: "row-insert"; atIndex: number; count: number }
  | { type: "row-delete"; atIndex: number; count: number }
  | { type: "row-reorder"; mutation: RowReorderMutation };
```

**Removed** from `SheetProps`: `onCellEdit`, `onBatchEdit`, `onRowInsert`,
`onRowDelete`, `onRowReorder`.

**Replaced** with:

```typescript
onOperation?: (operation: SheetOperation) => void | Promise<void>
```

All ~21 call-sites in `Grid.tsx` updated.

Consumer changes:
- `packages/sheet-scenarios/src/mutationBuffer.ts` — `MutationBufferBindings`
  collapsed to single `onOperation` field with switch dispatch
- `apps/e2e/src/harness.tsx` — spreads `bindings.onOperation`
- `apps/e2e/src/routes/cross-sheet.tsx` — consolidated `handleCellEdit`/
  `handleBatchEdit` into `handleOperation`
- `apps/solid-sheet-www/src/demos/*.tsx` (5 files) — updated

### Files touched
- `packages/spreadsheets/src/types.ts` — added `SheetOperation`, updated `SheetProps`
- `packages/spreadsheets/src/index.ts` — exported `SheetOperation`
- `packages/spreadsheets/src/Sheet.tsx` — plumbed `onOperation`
- `packages/spreadsheets/src/grid/Grid.tsx` — updated `GridProps` and all call-sites
- `packages/sheet-scenarios/src/mutationBuffer.ts` — rewrote bindings with switch
- `apps/e2e/src/harness.tsx` — updated
- `apps/e2e/src/routes/cross-sheet.tsx` — updated
- `apps/solid-sheet-www/src/demos/*.tsx` — 5 files updated

---

## 5. ✅ Host-provided `rowIds` prop

### Why
`CellMutation` already carries `rowId?: RowId`, but the store auto-generates
synthetic row IDs (`rowId(0)`...`rowId(n-1)`). Consumers with domain-meaningful
row identity (data table row names, persisted session state) want mutations to
carry stable, cross-session row keys. Synthetic IDs drift across rehydration.

### Done

Added `rowIds?: readonly RowId[]` to `SheetProps`:

- When provided, `createSheetStore` uses these IDs instead of auto-generating.
  Duplicates throw. Length mismatch vs `data` throws.
- When omitted (current behavior), auto-generate as before.
- `nextRowId` counter initialises past the max of all provided IDs, so
  Grid-initiated row inserts generate fresh IDs even when host-provided
  `rowIds` are in use.
- `createReconciler` accepts optional `getRowIds` getter. When the host
  changes `rowIds`, the store adopts the new identity mapping via the new
  `adoptRowIds` method — no cell data is touched.
- Reconciler syncs `rowIds` after data reconciliation but before the
  `onExternalChange` callback, ensuring formula engine sees consistent state.

### Files
- `packages/spreadsheets/src/types.ts` — added `rowIds` to `SheetProps`
- `packages/spreadsheets/src/core/state.ts` — updated `createSheetStore`
  (validation, host ID adoption, counter seeding), added `adoptRowIds`
  method, updated `createReconciler` (rowIds tracking + sync)
- `packages/spreadsheets/src/Sheet.tsx` — plumbed `rowIds` prop through

---

## 6. ✅ Export tagged error classes

### Why
Currently `WorkbookCoordinatorError` (the union type) is exported, but the
concrete tagged error classes are not. Consumers doing error handling benefit
from `instanceof` checks and pattern matching on specific error types.

### Done
All 14 tagged error classes already exported from `index.ts`.

### Files
- `packages/spreadsheets/src/index.ts` — exports exist

---

## Out of scope

These suggestions from the original feedback are intentionally not included:

- **Scratch-sheet serialization helpers** — app-layer concern. The data format
  (`CellValue[][]` + `ColumnDef[]`) is intentionally simple; converting to/from
  sparse representations is a consumer-side helper.

- **Controlled mutation acceptance** (`beforeApplyOperation` /
  `mutationMode="controlled"`) — the library already provides the right
  primitives. The reconciler treats host `data` as authoritative. If a consumer
  rejects an edit (doesn't update their `data` prop), the store reverts on the
  next reconciliation cycle. The app owns rollback. Adding a gating hook would
  force latency on every keystroke for consumers who don't need it and
  complicates undo/redo semantics.

- **Effect interop** — don't add `effect` as a dependency or create a separate
  entrypoint unless there's concrete demand from multiple consumers.

---

## Status

| Item | Status |
|------|--------|
| 1. Export A1 parsing utilities | ✅ Done |
| 2. Export runtime validation helpers | ✅ Done |
| 3. Allow `Promise<void>` on callbacks | ✅ Done |
| 4. Unified `onOperation` callback | ✅ Done |
| 5. Host-provided `rowIds` prop | ✅ Done |
| 6. Export tagged error classes | ✅ Done |

All six items complete for v0.8.0.

## Migration notes for consumers

**Item 4** is the only breaking change. Migration:

```typescript
// Before
<Sheet
  onCellEdit={(m) => store.apply(m)}
  onBatchEdit={(ms) => store.applyAll(ms)}
  onRowInsert={(i, n) => store.insertRows(i, n)}
  onRowDelete={(i, n) => store.deleteRows(i, n)}
  onRowReorder={(m) => store.reorder(m)}
/>

// After
<Sheet
  onOperation={(op) => {
    switch (op.type) {
      case "cell-edit":   return store.apply(op.mutation);
      case "batch-edit":  return store.applyAll(op.mutations);
      case "row-insert":  return store.insertRows(op.atIndex, op.count);
      case "row-delete":  return store.deleteRows(op.atIndex, op.count);
      case "row-reorder": return store.reorder(op.mutation);
    }
  }}
/>
```
