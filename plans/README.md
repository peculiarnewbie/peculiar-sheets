# Implementation Plans

Generated on 2026-07-11 against commit `6def943`. Execute the patch phase first, release it, then begin the major phase. Each executor must read its plan fully, honor STOP conditions, and update this index when complete.

## Execution order & status

| Phase | Plan | Title | Priority | Effort | Depends on | Status |
|---|---|---|---|---|---|---|
| Patch | 001 | Establish Grid coordination test seams | P1 | M | — | DONE |
| Patch | 002 | Commit undo and redo only after formula synchronization | P1 | M | 001 | DONE |
| Patch | 003 | Synchronize batch mutations without replacing full sheets | P1 | M | 001 | DONE |
| Patch | 004 | Make row metrics sparse for large grids | P2 | M | 001 | DONE |
| Major | 005 | Make workbook structural operations atomic | P1 | M | 001 | DONE |
| Major | 006 | Replace workbook-wide structural snapshots with scoped history | P2 | L | 005 | DONE |

## Release gates

- **Patch:** Plans 001–004 are complete; `pnpm typecheck` and `bun test packages/spreadsheets/src` pass; all public exports and documented `SheetController` signatures remain unchanged.
- **Major:** Plan 005 is complete before Plan 006 begins. Document any changed failure semantics or `WorkbookStructuralChange` payload/timing in the package README and release notes before publishing.

## Dependency notes

- Plan 001 provides a narrow, testable internal coordination seam used by Plans 002 and 003; it must not change public props or controller methods.
- Plan 005 establishes rollback semantics. Plan 006 may optimize history storage only after it can prove that same atomic outcome.
- Plans 003 and 004 are intentionally independent of workbook structural changes and belong in the patch release.

## Findings considered and rejected

- Shrinking columns retain hidden trailing cells temporarily: not planned separately because subsequent reconciliation clears them before they become visible; treat as an implementation detail when touching reconciliation, not a release blocker.
- Broadly splitting `Grid.tsx`: rejected as an aesthetic refactor. Extract only the coordination seam required for tests.
- Replacing every `find`/`indexOf`: rejected pending profiling; present call sites are usually visible-row or one-off paths.

## External distribution prep

- [023 formula-free core prep](023-formula-free-mit-core-prep.md) — dependency split landed on `feature/023-formula-free-mit-core`; MIT authorization + npm publication evidence still required before any UE Shed consumer upgrade.
