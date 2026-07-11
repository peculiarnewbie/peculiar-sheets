# Plan 001: Establish a testable Grid mutation-coordination seam

> **Executor instructions**: Follow this plan step by step. Run every verification command before proceeding. If a STOP condition occurs, stop and report; do not improvise. When done, update Plan 001 in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 6def943..HEAD -- packages/spreadsheets/src/grid/Grid.tsx packages/spreadsheets/src/grid packages/spreadsheets/src/formula packages/spreadsheets/src/core`

## Status

- **Priority:** P1
- **Effort:** M
- **Risk:** MED
- **Depends on:** none
- **Category:** tests / tech-debt
- **Planned at:** commit `6def943`, 2026-07-11

## Why this matters

Grid owns ordering-sensitive workflows: it changes local history and cells, synchronizes HyperFormula, and emits host operations. Those workflows currently live inside a 2,669-line Solid component, so failure paths cannot be tested without rendering the component. Introduce the smallest internal, dependency-injected coordination seam needed to characterize and later fix synchronization failures; this is a prerequisite for the patch correctness and performance work, not a public refactor.

## Current state

- `packages/spreadsheets/src/grid/Grid.tsx` owns both mutation coordination and Solid DOM behavior.
- `packages/spreadsheets/src/core/state.ts` applies `undo()` / `redo()` synchronously and returns the mutations and row operation to synchronize.
- `packages/spreadsheets/src/formula/bridge.ts` represents expected engine failures as `ResultLike` and uses `withTraceContext`; match this internal convention.

Current orchestration at `Grid.tsx:2026-2042` is effectively:

```ts
const undoResult = props.store.undo();
if (undoResult) {
  if (undoResult.mutations.length > 0) {
    if (!syncAlreadyAppliedMutationsToFormulaEngine(undoResult.mutations)) break;
  }
  if (undoResult.rowChange) {
    if (!syncAllToFormulaEngine()) break;
  }
}
```

`Grid.tsx:960-965` similarly synchronizes a batch before applying it:

```ts
function applyBatchMutations(mutations: CellMutation[]) {
  if (mutations.length === 0) return;
  if (!syncMutationsToFormulaEngine(mutations)) return;
  applyMutations(props.store, mutations);
  props.onOperation?.({ type: "batch-edit", mutations });
}
```

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `pnpm typecheck` | exit 0, no errors |
| Library tests | `bun test packages/spreadsheets/src` | all tests pass |
| Focused tests | `bun test packages/spreadsheets/src/grid` | all grid tests pass |

## Scope

**In scope:**

- `packages/spreadsheets/src/grid/Grid.tsx`
- `packages/spreadsheets/src/grid/<new internal coordination module>.ts`
- `packages/spreadsheets/src/grid/<new coordination module>.test.ts`
- Type-only imports needed by those files

**Out of scope:**

- Public `SheetProps`, `SheetController`, and package exports.
- DOM event handling, selection behavior, workbook coordinator behavior, and formula bridge implementation.
- General-purpose splitting of `Grid.tsx`.

## Git workflow

- Branch: `advisor/001-grid-coordination-test-seam`
- Use the repository's recent concise conventional-style messages, e.g. `refactor: deepen workbook coordinator into discrete modules`.
- Do not push, publish, or modify lockfiles.

## Steps

### Step 1: Write characterization tests before extraction

Create a focused Bun test module next to the new coordinator. Define a minimal fake store/history adapter and fake formula synchronizer. Test the existing intended contract for a successful mutation undo and redo: state changes once, formula synchronization is called once with the final intended content, and the host operation is emitted only after synchronization succeeds.

Also write pending tests marked only by their expected final contract—not implementation details—for a synchronizer failure: local cells/history must remain at their pre-command values and no host operation is emitted. These tests are expected to be enabled by Plan 002; do not weaken them to match current broken behavior.

**Verify:** `bun test packages/spreadsheets/src/grid/<new coordination module>.test.ts` → baseline success tests pass; failure-contract tests are either skipped with an explicit Plan 002 TODO or the new seam already supports them without changing behavior elsewhere.

### Step 2: Extract only the non-DOM coordination dependency boundary

Move the narrow code that sequences a proposed history transition, formula synchronization, store commit, and `onOperation` callback into the new internal module. Pass dependencies as explicit functions/interfaces; do not import Solid primitives, DOM types, or component props into it. Keep adapter code in `Grid.tsx` so callers and component behavior remain unchanged.

Use `Result`/tagged errors for expected formula synchronization failures at the subsystem boundary, following `formula/bridge.ts`. The extracted module must not expose `Result` through a public component API.

**Verify:** `pnpm typecheck` → exit 0; `bun test packages/spreadsheets/src/grid/<new coordination module>.test.ts` → all enabled tests pass.

### Step 3: Prove no behavior was broadened

Run the full library suite. Inspect the package public entry point and confirm the new module is not exported from `src/index.ts`.

**Verify:** `bun test packages/spreadsheets/src` → all tests pass; `pnpm typecheck` → exit 0; `rg -n "<new coordination module name>" packages/spreadsheets/src/index.ts` → no matches.

## Test plan

- Model Result assertions after `packages/spreadsheets/src/formula/bridge.test.ts`.
- Cover success, formula-sync failure, callback suppression on failure, no-op history transition, and mutation versus structural transition routing.
- Preserve existing formula bridge, history, and E2E tests unchanged unless a type-only import needs adjustment.

## Done criteria

- [x] The new unit tests execute without mounting Solid or a browser.
- [x] `pnpm typecheck` exits 0.
- [x] `bun test packages/spreadsheets/src` exits 0.
- [x] `SheetProps`, `SheetController`, and `src/index.ts` public exports are unchanged.
- [x] Plan 001 is marked DONE in `plans/README.md`.

## STOP conditions

- The extraction requires changing a public controller signature or callback payload.
- The store cannot expose a proposed transition without mutating; record the exact API constraint for Plan 002 rather than adding hidden rollback logic here.
- The focused test requires a browser-only Solid effect to run.

## Maintenance notes

Future Grid command paths that change both local data and HyperFormula must use this seam. Reviewers should reject a second independent order of store mutation, formula synchronization, and host notification.
