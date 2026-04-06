# Pane-Based Performance Plan

## Summary

The `/large` dataset is currently `10,000 x 20`, or `200,000` cells total. As raw CSV, that dataset is about `1,288,890` bytes, which is `1.289 MB` decimal or `1.229 MiB`.

The current bottleneck is no longer primarily Solid reactivity. The recent traces show that the remaining cost is dominated by browser renderer work: `Layout`, `Paint`, `PrePaint`, and `Layerize`. The next step is to replace the current sticky-heavy DOM architecture with a pane-based grid shell that reduces scroll-time layout and paint cost while keeping the current DOM editing model.

Default direction:

- Keep DOM rendering for now
- Do not move to canvas yet
- Use canvas only as a fallback phase if the pane refactor still misses targets

## Performance Targets

Targets are measured on a normal work laptop, with production preview used for release acceptance.

- Initial mount to usable grid: `<= 1500ms`
- Scroll: no main-thread tasks over `100ms` during a 2-second manual scroll
- Scroll: p95 frame time `<= 32ms`, median `<= 16ms`
- Enter edit mode on a visible cell: `<= 150ms`
- Commit a plain-value edit on a visible cell: `<= 250ms`
- Total “scroll to row 500, enter edit, commit value” flow: `<= 2000ms` in production preview

Dev-mode e2e budgets stay broader and are used as regression guards, not release certification.

## Current Findings

- The original large stalls from Solid/global selection churn have been reduced.
- The harness no longer round-trips the full matrix through a signal for edits.
- Cells no longer subscribe directly to global selection state.
- Scroll traces still show renderer-side dominance: layout, paint, prepaint, and layerization.
- The remaining problem is DOM/CSS architecture, not raw data size.

## Chosen Architecture

### 1. Replace Sticky-Per-Cell Layout With Pane Layout

Current issue:

- The grid uses many `position: sticky` elements for headers, row gutters, and pinned cells.
- That creates expensive scroll-time layout and layerization.

New structure:

- One native scroll owner: the main body scroller
- Separate non-scrolling panes synced to that scroller

Planned panes:

- `top-left corner pane`
- `top header pane`
- `left row-gutter pane`
- `main body pane`
- `optional pinned-left pane`
- `single overlay pane` for selection, editor, search, and fill visuals

Scroll ownership:

- Only the main body pane owns native `scrollTop` and `scrollLeft`
- Header pane mirrors horizontal scroll using transform
- Gutter pane mirrors vertical scroll using transform
- Pinned-left pane mirrors vertical scroll using transform
- Overlay pane is anchored to the main body coordinate space

Decision:

- Remove per-cell sticky positioning from body cells
- Remove sticky positioning from pinned body cells
- Remove sticky positioning from header cells used for pinned columns
- Keep stickiness only if absolutely needed at the pane level, not per cell

Primary files:

- `packages/spreadsheets/src/grid/Grid.tsx`
- `packages/spreadsheets/src/grid/GridBody.tsx`
- `packages/spreadsheets/src/grid/GridHeader.tsx`
- `packages/spreadsheets/src/grid/SelectionOverlay.tsx`
- `packages/spreadsheets/src/sheet.css`

### 2. Keep Row Virtualization, Do Not Add Column Virtualization Yet

Decision:

- Keep row virtualization as the primary virtualization strategy
- Do not add column virtualization in this phase

Reason:

- The dataset is only 20 columns wide
- Horizontal virtualization would add complexity without addressing the current bottleneck

If future scenarios exceed roughly 100 visible columns, revisit column virtualization separately.

### 3. Split Render Layers By Responsibility

Main body:

- Render only visible rows plus overscan buffer
- Increase overscan from the current 3 rows to a larger buffer (start with 20 percent of viewport row count, measure, adjust)
- Add a fast-draw check: if the new scroll position still falls within the already-rendered overscan range, skip row re-rendering entirely and only update overlay positions
- Use one translated row container per visible row
- Position rows with `transform: translateY(...)`, not repeated `top` updates

Header:

- Render as a dedicated pane, horizontally translated from `scrollLeft`
- No body-cell sticky dependencies

Row gutter:

- Render as a dedicated pane, vertically translated from `scrollTop`
- No per-row sticky headers inside body rows

Pinned columns:

- Render as a dedicated pane for pinned-left columns only
- No sticky pinned cells inside the main body

Overlay:

- Keep selection, fill handle, editor, and search-current visuals in one overlay layer
- Do not reintroduce selection/focus state into each `GridCell`

### 3a. Recycle Row DOM Nodes During Scroll

Current issue:

- `@tanstack/solid-virtual` with `overscan: 3` unmounts and remounts Solid reactive scopes and DOM elements as rows enter and leave the viewport
- Each scroll tick that moves rows in or out triggers DOM node destruction and creation
- This is expensive in layout and GC pressure, even after the pane refactor removes sticky costs

Decision:

- Add a row DOM recycling layer so that row elements leaving the viewport are reused for rows entering the viewport, not destroyed and recreated

Reference implementations:

- ag-grid: row controllers are recycled — DOM elements stay mounted, only data bindings update. Old rows become "zombies" during exit animation, then get reclaimed by the pool.
- Handsontable: `NodesPool` class backed by a `Map` keyed on `(row, col)`. A `ViewDiffer` computes minimal DOM operations (append, insert-before, remove) instead of tearing down and rebuilding.

Implementation approach:

- Measure DOM node creation rate during a 2-second scroll on `/large` before and after the pane refactor
- If creation rate is high (many nodes created per frame), introduce a fixed-size pool of row container elements
- Pool size equals the visible row count plus overscan buffer
- When a row index leaves the viewport, its DOM container is returned to the pool and reassigned to a new row index entering the viewport
- The row container's children (cells) are updated in place rather than recreated
- If `@tanstack/solid-virtual` does not support this natively, evaluate wrapping it with a pooling adapter or replacing it with a custom virtualizer that supports recycling

Primary files:

- `packages/spreadsheets/src/grid/Grid.tsx` (virtualizer setup)
- `packages/spreadsheets/src/grid/GridBody.tsx` (row rendering)

## DOM And CSS Changes

### 4. Reduce Per-Cell DOM Cost

Decision:

- Remove the extra inner text span from cells unless required for a specific feature
- Render text directly in the cell container where possible

Current:

- Cell `div` plus inner `span`

New:

- Single `div` for most cells
- Keep dedicated overlay/editor DOM where needed

Additional changes:

- Keep `title` only if needed for UX, otherwise make it optional or remove for large-mode perf paths
- Avoid per-cell animation and transition during steady-state scrolling

### 5. Add Containment At Pane/Row Boundaries

Decision:

- Add containment to pane containers
- Add containment to row containers only where it does not break overlays or pane sync

Planned CSS:

- Panes: `contain: layout paint style`
- Main scroller shell: `contain: strict` only if verified not to break sizing/overlay math
- Rows: `contain: layout paint`

Do not apply containment to nodes that still depend on sticky descendants. The pane refactor is intended to eliminate that dependency.

### 6. Remove Non-Essential Scroll-Time Paint Work

Decision:

- Keep the current visual style, but simplify expensive scroll-time surfaces

Changes:

- No transitions on selection rectangles during scroll
- No hover-only effects that cause extra layer churn in steady-state scroll paths
- Keep outlines and highlight states only for active or selected cells, not broad background changes across many cells
- Ensure pinned panes and overlay panes have stable backgrounds to avoid repaint blending penalties

## Data Model Decisions

### 7. Keep The Core Data Model As `CellValue[][]` For This Dataset Size

Decision:

- Do not redesign the store around chunked sparse structures in this phase

Reason:

- `200,000` plain-value cells and `~1.3MB` CSV-equivalent data are not the bottleneck
- The traces do not justify a data-structure rewrite yet

Keep:

- Current store shape
- Current formula bridge architecture
- Current edit and selection semantics

Already-fixed behavior that stays:

- No full-matrix signal round-trip in the e2e harness
- No per-cell subscription to global selection state

## Measurement And Perf Harness

### 8. Add Production-Mode Perf Verification

Decision:

- Add a dedicated production preview perf run in addition to the current dev-mode flow

New perf workflow:

1. Build app
2. Serve production preview
3. Run one perf path against `/large`
4. Collect:
   - total wall-clock flow time
   - long-task count via `PerformanceObserver`
   - worst task duration
   - DOM node count in steady state
   - visible-row count
   - optional trace capture for manual inspection

New helper behavior:

- Expose small perf stats from the page on `window.__PERF_STATS__`
- Capture scroll-start and scroll-end timestamps
- Capture long tasks above `50ms`

### 9. Keep Existing E2E Budgets As Regression Guards

Decision:

- Keep the large e2e timing assertions
- Treat them as guardrails only

Existing large test should continue to assert:

- Row visible budget
- Enter-edit budget
- Commit-edit budget
- Total flow budget

Add one more test:

- Sustained scroll smoke test

That test should assert:

- Row visibility remains correct after scroll
- No missing rows
- No duplicate visible row indices
- No stale editor or overlay artifacts after scroll
- No excessive DOM node creation during sustained scroll (node creation rate stays below threshold)

## Implementation Order

### Phase 1. Measurement And Baseline Lock

1. Preserve the current large e2e timing assertions
2. Add production preview perf runner
3. Add in-page long-task collection
4. Record baseline numbers before the renderer refactor

Deliverable:

- Reproducible before/after metrics on the same machine class

### Phase 2. Pane Refactor

1. Refactor `Grid` into a pane shell with one scroll owner
2. Split header, gutter, main body, pinned-left, and overlay rendering paths
3. Remove sticky-per-cell and sticky-per-row-header behavior
4. Sync panes via scroll offsets from the main scroller
5. Increase overscan buffer and add fast-draw skip logic to avoid unnecessary re-renders during small scrolls
6. Add row DOM recycling so row containers leaving the viewport are reused, not destroyed
7. Keep existing editing and selection behavior unchanged

Deliverable:

- Functional parity with the current grid
- Materially lower layout and layerization work in traces

### Phase 3. DOM Simplification

1. Remove unnecessary nested text wrappers
2. Add containment to panes and rows
3. Strip non-essential transitions from scrolling surfaces
4. Re-measure

Deliverable:

- Reduced paint and prepaint work
- Lower DOM node count and lower layerization

### Phase 4. Escalation Gate

If production targets are still missed after Phase 3:

- Introduce a hybrid renderer:
  - canvas for main body cells
  - DOM for headers, editor, selection overlay, context menu, formula bar
- Hide it behind a new render mode prop
- Default to `auto`
- `auto` picks hybrid mode only for large datasets or when explicitly enabled

This phase is not the default path. It is the fallback if the DOM pane renderer still misses targets.

## Public APIs / Interfaces / Types

### No Required Public API Change In Phases 1-3

Planned API status:

- No breaking changes
- Existing `Sheet` props stay intact
- Existing controller API stays intact

### Optional Phase-4 API If Needed

If hybrid rendering becomes necessary, add:

- `renderMode?: "auto" | "dom" | "hybrid-canvas"`

Default:

- `"auto"`

Behavior:

- `"dom"` forces pane-based DOM renderer
- `"hybrid-canvas"` forces canvas body renderer
- `"auto"` chooses based on dataset/profile heuristics

## Test Cases And Scenarios

### Functional Scenarios

Must continue passing:

- Basic cell selection
- Keyboard navigation
- Double-click to edit
- Direct typing edit
- Undo and redo
- Autofill
- Readonly cells
- Formula updates
- Row-header selection
- Column-header selection

### Renderer-Specific Scenarios

Add explicit tests for:

- Header remains horizontally aligned while scrolling body
- Row gutter remains vertically aligned while scrolling body
- Pinned-left pane stays aligned with main rows
- Selection overlay aligns with visible cell after scroll
- Cell editor overlay aligns with edited cell after scroll
- Search-current highlight aligns after scroll
- Fill handle aligns after scroll
- No duplicated visible rows during rapid scroll
- No blank gaps between panes during rapid scroll

### Perf Scenarios

Measure on the baseline laptop:

- Initial mount on `/large`
- Scroll to row 500
- 2-second continuous wheel scroll
- Enter edit on a visible row
- Commit plain value edit
- Return to top and verify data integrity

## Acceptance Criteria

The work is complete when:

- Traces show scrolling is no longer dominated by sticky-driven layerization
- Production preview hits the performance targets listed above
- Existing spreadsheet behavior remains correct
- `/large` stays visually aligned during scroll and edit
- No regressions in formulas, autofill, or readonly behavior

## Assumptions And Defaults

- Dataset under discussion is the current `/large` route: `10,000 x 20`, `200,000` cells, about `1.289 MB` CSV-equivalent
- The current laptop is the baseline machine class
- Success is judged primarily in production preview, not dev server
- We are optimizing for “nice to use” with the current spreadsheet UX, not just synthetic benchmark wins
- We are not introducing a canvas renderer unless the pane-based DOM refactor still misses targets
- We are not adding column virtualization in the first implementation phase because width is not the current problem
