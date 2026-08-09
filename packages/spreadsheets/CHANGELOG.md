# Changelog

All notable changes to `peculiar-sheets` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.12.4] - 2026-08-10

### Fixed

- Retry virtualizer attachment in the next macrotask so a lazy route or Suspense
  lifecycle teardown later in the mount turn cannot leave a visible grid with no
  rendered rows or cells.
- Reproduce the host lifecycle ordering in the production-bundle regression test.

## [0.12.3] - 2026-08-09

### Fixed

- Own row and column virtualizer attachment cleanup at the Grid component boundary so lazy Solid route and Suspense effect lifecycles cannot detach observation from a viewport that remains mounted.
- Detect a live viewport with stale TanStack window, rectangle, or observer state and reattach it before taking the next virtual-item snapshot.
- Cover a formula-enabled Sheet beneath a lazy TanStack Solid route, Suspense transition, and flex-sized container through the Vite production bundle.

## [0.12.2] - 2026-08-09

### Fixed

- Explicitly attach and measure both virtualizers after the scroll viewport mounts, then seed row and column snapshots in the same mount turn. Formula-enabled sheets no longer depend on a later resize, scroll, HMR, or host update to render their initial cells.
- Cover the formula clean-mount path through a Vite production bundle across two fresh documents before editing and evaluating `=1+2`.

## [0.12.1] - 2026-08-09

### Fixed

- Keep row and column virtual-item snapshots reactive during formula-engine initialization, including with SolidJS 1.9.14 and `@tanstack/solid-virtual` 3.13.35, so formula-enabled sheets render on a clean mount.
- Declare the backward-compatible theme defaults through `:where(.se-grid)` so a host class passed through `Sheet.class` overrides `--ps-*` variables regardless of stylesheet order.

## [0.12.0] - 2026-08-09

### Added

- First-class instance theming through documented `--ps-*` CSS custom properties, with the existing dark appearance retained as `.se-grid` defaults.
- `SheetCustomization.getRowClass(rowIndex, context)` for styling a rendered row, its row header, and its visible cells using stable identity and focus/selection/editor state.
- `SheetProps.emptyState` JSX slot with the existing `No data` fallback.
- `SheetProps.ariaLabel`, focused-cell `aria-activedescendant`, cell selection/read-only state, labeled editors, active-row states, forced-color focus fallbacks, and reduced-motion handling.
- A host-themed showcase sheet demonstrating focused-row styling without internal selector overrides.

### Changed

- Tab and Shift+Tab now leave the sheet at the trailing/leading cell instead of clamping focus inside the grid. In-grid Tab movement remains one column at a time and does not wrap rows.
- Enter and Shift+Enter now move vertically after every inline edit commit, including formula text.

### Fixed

- Apply the existing `Sheet class` prop to the actual `.se-grid` root.
- Enforce sheet-level read-only mode in the central edit-entry path, including imperative and formula-bar entry.
- Apply focused, selected, editing, and active-row DOM/CSS states to rendered virtual cells rather than relying only on the selection overlay.
- Remove host-specific example selectors from the reusable package stylesheet.

## [0.11.1] - Unreleased

### Performance

- Replace quadratic controlled row-identity reconciliation with one batched host replacement.
- Preserve the sparse fast path for stable row identities and cell-only updates.

### Fixed

- Normalize selection, editing state, row revisions, sizing metadata, and history after wholesale host replacement.

## [0.11.0] - Unreleased

### Changed

- **Breaking (dependency graph):** `hyperformula` is no longer a production or peer dependency of `peculiar-sheets`. The packed core installs without HyperFormula.
- Formula evaluation remains available through the optional duck-typed `formulaEngine` / workbook APIs. Hosts that need HyperFormula must install it directly.
- Added an engine-neutral `FormulaEngine` contract and kept direct HyperFormula instances source-compatible through `adaptHyperFormula`.
- Added the separately installed `peculiar-sheets-ironcalc` adapter as the recommended formula path, including asynchronous WASM initialization, typed value reads, batched recalculation, row operations, subscriptions, and disposal.
- Package description and keywords no longer imply a bundled formula engine.
- Added `pnpm --filter peculiar-sheets pack:check` to reject packed manifests that reintroduce HyperFormula as a production or peer dependency.

### Migration from 0.10.x

- Formula-free hosts can upgrade without application-code changes.
- Formula hosts can install `peculiar-sheets-ironcalc@0.11.1` and initialize it before rendering. Existing HyperFormula hosts can instead add `hyperformula@^3.0.0` directly; their component and coordinator calls remain valid.

### License note

- The copyright holder has authorized the formula-free `peculiar-sheets` core under MIT.
- HyperFormula remains GPL/commercial licensed and is not part of the core distribution.

## [0.10.1] - 2026-07-16

### Added

- `WorkbookStructuralRollbackError` when structural rollback itself fails (`engineInconsistent: true`)
- Optional `FormulaEngineConfig.onEngineContentChanged` so workbook integrations can invalidate engine-content snapshot caches after bridge writes

### Changed

- Failed workbook structural ops (`insertRows`, `deleteRows`, `setRowOrder`) and failed undo/redo restores are atomic: engine sheets, caches, and history stay unchanged, and subscribers do not receive a `WorkbookStructuralChange`
- Internal undo/redo history retains only sheets whose serialized content changed; public `WorkbookStructuralChange.snapshots` remains an all-registered-sheet payload
- Structural happy path serializes each registered sheet once; rollback capture reuses confirmed caches instead of a second full-workbook serialize

## [0.10.0] - 2026-07-16

### Added

- `SheetController.setCellValues(writes)` for bulk host cell updates that share one formula sync, store update, undo entry, and `batch-edit` operation
- Exported `CellWrite` type for the batch write API
- Browser benchmark suite (`apps/benchmarks`, `benchmarks/run.ts`) comparing peculiar-sheets with AG Grid and Handsontable across mount, scroll, and write scenarios

### Changed

- Grid lifecycle diagnostics and row-revision / search reactivity coverage for the batch write path

## [0.9.1] - 2026-07-11

### Fixed

- Harden `setCells` rollback so failed batch formula sync does not leave partial engine/store state; keep batch error details internal
- Make undo/redo commit only after formula synchronization succeeds (atomic history + engine)

### Performance

- Sync mutation batches without rewriting the full sheet into HyperFormula
- Make row metrics sparse so large grids do not allocate dense height maps up front

### Changed

- Extract a Grid mutation coordination seam used by transactional history and batch sync paths

## [0.9.0] - 2026-06-11

### Added

- Workbook coordinator deepened into discrete modules for registry, history, and structural engine coordination

### Changed

- Replace non-null assertions with explicit guards and branded errors across internal boundaries
