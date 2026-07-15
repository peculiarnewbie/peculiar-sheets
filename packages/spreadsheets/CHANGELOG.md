# Changelog

All notable changes to `peculiar-sheets` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
