# Plan 004: Make row metrics sparse for large grids

> **Executor instructions**: Follow each step and update Plan 004 in `plans/README.md` after all verification gates pass.
>
> **Drift check (run first)**: `git diff --stat 6def943..HEAD -- packages/spreadsheets/src/grid/rowMetrics.ts packages/spreadsheets/src/grid/rowMetrics.test.ts packages/spreadsheets/src/grid/Grid.tsx`

## Status

- **Priority:** P2
- **Effort:** M
- **Risk:** MED
- **Depends on:** `plans/001-grid-coordination-test-seam.md`
- **Category:** perf
- **Planned at:** commit `6def943`, 2026-07-11

## Why this matters

The grid uses virtualization but eagerly creates height and offset arrays for every row whenever row metrics recompute. A single custom row height or sorted order can therefore allocate and scan millions of rows. Preserve exact scrolling and offset behavior while giving the default-height case O(1) memory and sparse override work.

## Current state

- `packages/spreadsheets/src/grid/rowMetrics.ts:16-30` allocates `heights` and `offsets` with `rowCount` entries and loops over all rows.
- `packages/spreadsheets/src/grid/Grid.tsx:322-347` recomputes metrics reactively and invokes `rowVirtualizer.measure()` on every new snapshot.
- `packages/spreadsheets/src/grid/rowMetrics.test.ts` covers default heights, overrides, offsets, totals, and offset-to-row mapping; retain all results.

Current allocation behavior:

```ts
const heights: number[] = new Array(rowCount);
const offsets: number[] = new Array(rowCount);
for (let row = 0; row < rowCount; row++) {
  offsets[row] = runningTop;
  const nextHeight = getRowHeightOverride(visualRow(row)) ?? defaultRowHeight;
  heights[row] = nextHeight;
  runningTop += nextHeight;
}
```

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Row metrics tests | `bun test packages/spreadsheets/src/grid/rowMetrics.test.ts` | all pass |
| Library tests | `bun test packages/spreadsheets/src` | all tests pass |
| Typecheck | `pnpm typecheck` | exit 0 |

## Scope

**In scope:**

- `packages/spreadsheets/src/grid/rowMetrics.ts`
- `packages/spreadsheets/src/grid/rowMetrics.test.ts`
- `packages/spreadsheets/src/grid/Grid.tsx` only if the row-metric input contract must become a sparse override iterable/map

**Out of scope:**

- Public row sizing prop shape (`Record<number, number>` currently) and visible scroll behavior.
- Replacing TanStack Virtual or changing virtualizer overscan.
- Workbook row operations and sort semantics.

## Steps

### Step 1: Add boundary and scale characterization tests

Expand `rowMetrics.test.ts` to cover no overrides, first/middle/last sparse overrides, negative/out-of-bounds offsets, and offsets exactly on boundaries. Add a large-row-count test that asserts the default path does not materialize row-count-sized public arrays; if `heights`/`offsets` are currently public only because of the internal `RowMetricsSnapshot` type, remove or hide them rather than preserving an accidental internal API.

**Verify:** `bun test packages/spreadsheets/src/grid/rowMetrics.test.ts` → all existing and new tests pass before optimization.

### Step 2: Implement a constant-height fast path and sparse override representation

Change the builder input so Grid can provide only actual height overrides, not a callback that forces probing every visual row. For zero overrides, compute top, total height, and row-at-offset with arithmetic. For overrides, use a sorted sparse representation with prefix deltas and binary search (or an equivalently bounded algorithm) so operations do not allocate arrays proportional to all rows.

Maintain these exact semantics: `getRowTop(0) === 0`, out-of-range top returns total height, offset below zero maps to row 0, and offset at/above total maps to the final row.

**Verify:** row metrics tests pass; `pnpm typecheck` exits 0.

### Step 3: Adapt Grid without changing consumers

Update the `rowMetrics` memo in `Grid.tsx` to pass row-height overrides keyed by visual row. Verify view sorting maps stable row IDs to the correct visual override. Keep the existing `rowVirtualizer.measure()` effect; optimize it only with a measured reason in a future change.

**Verify:** `bun test packages/spreadsheets/src` → all tests pass.

## Done criteria

- [x] A grid with no custom row heights uses O(1) row-metric storage regardless of row count.
- [x] Sparse custom heights produce identical heights, tops, totals, and row lookup results to existing tests.
- [x] Row height overrides remain attached to stable row IDs after view sorting.
- [x] No public prop or controller signature changes.
- [x] `bun test packages/spreadsheets/src` and `pnpm typecheck` pass.
- [x] Plan 004 is marked DONE.

## STOP conditions

- Existing consumers import `RowMetricsSnapshot.heights` or `.offsets` from a public path.
- A sparse algorithm changes pixel boundary behavior in the existing test cases.
- Maintaining O(log n) lookup requires a dependency or a public API change.

## Maintenance notes

Treat row metrics as a data-structure boundary. Add a test whenever a new sizing feature changes the mapping between visual rows, stable row IDs, and pixel offsets.
