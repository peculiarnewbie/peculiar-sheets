# Solid rc.9 release: 0.14.0

Prepared for Solid `2.0.0-rc.9`. No publication or release tagging is performed
as part of this migration. Core, the IronCalc adapter, and the private workspace
HyperFormula adapter are versioned `0.14.0`.

## Runtime compatibility

Core requires exactly `solid-js@2.0.0-rc.9` and `@solidjs/web@2.0.0-rc.9`.
The compiler, Babel plugin, and signals overrides match rc.9. The Vite plugin is
`3.0.0-next.44`. The test application's `@tanstack/solid-router@2.0.0-rc.7` is
a separate package version and is unchanged. IronCalc does not import Solid and
adds `^0.14.0` to its existing core peer ranges. HyperFormula remains private;
its `workspace:^` core peer resolves to `^0.14.0` when packed.

The rc.9 compiler emits `_$$<event>` properties consumed by rc.9's delegated
dispatcher. The rc.7 distribution emitted `$$<event>` and its handlers were
invisible to that dispatcher. Upgrade the package and remove the consumer
patch that renames these assignments. The pack gate rejects legacy keys.

## Synchronous commands and batched rendering

The [rc.9 signals release](https://github.com/solidjs/solid/releases/tag/%40solidjs%2Fsignals%402.0.0-rc.9)
deliberately changes when reads see writes (A28, commit `8ff4803`). Rc.7's
`latest()` pulled its shadow computation current in the middle of a turn.
Rc.9 hides an unflushed write from plain reads, `latest()`, `isPending()`, and
new derivations until the flush carries it. Functional setters and store drafts
still compose on the writer's pending value. This is a semantics change,
not evidence of a Solid bug.

Minimal reproduction under the browser runtime:

```ts
const [value, setValue] = createSignal(0);
setValue(1);
latest(value); // rc.7: 1; rc.9: 0
setValue(previous => previous + 1); // composes on 1 in both versions
flush();
latest(value); // 2
```

Installed-source evidence in `@solidjs/signals/dist/prod`:

- rc.7 `core/verdict.js:310`, especially `:317`: `latestRead` performs the
  mid-turn pull with `markHeap` / `prepareComputed`.
- rc.9 `core/verdict.js:108` and `:413`: verdicts and `latestRead` answer for
  the last flushed world; `:436` documents removal of the mid-turn pull.
- rc.9 `core/core.js:1239` and `:1261`: the shared unflushed-value read rule.
- rc.9 `core/core.js:1602`: functional setters compose on the pending value.

The sheet keeps imperative command values locally alongside their notification
signals. Untracked command reads see these values immediately; tracked render
reads subscribe to the signal and follow Solid's flushed frame. Cell arrays
remain synchronous as in `0.13.0`. No per-command global flush is introduced.
Dimensions, stable row IDs and allocation counters, pending row guards,
selection, history, sizing, and editor text/caret/reference insertion therefore
compose in the same turn. Selection and reference eligibility command getters
read their sources directly rather than an unflushed memo.

The reported failures depend on these command reads:

| Failing coverage | Value read before the carrying flush |
| --- | --- |
| Autofill history | Newly pushed history entry and the next undo/redo plan |
| Row insertion/deletion and grid resizing | Dimensions, current row IDs, and allocation counters |
| Resize history | Newly pushed history entry and restored width/height maps |
| Identity reconciliation | Pending-row guard, dimensions, IDs, and preserved/reset history |
| Row operation history with formulas | Successive history plans and dimensions used to apply inverse row operations |
| Same-turn controller editing | Newly opened edit mode and current editor text/caret |

Existing unit and component assertions are retained. Additional component
coverage checks chained structural commands with one render notification and
editing through delegated keyboard/input handlers. The rc.9 declarations still
export `Loading`, compute/apply `createEffect`, `onSettled`, `createProjection`,
and `mapArray`; the latter two have no direct workspace callers.

## Verification before publication

Builds, tests, typechecks, and Biome were not executed during sandboxed source
inspection. Run these checks before publishing:

```sh
pnpm install --frozen-lockfile
pnpm run test
pnpm run test:solid2
pnpm run build:lib
pnpm run typecheck:lib
pnpm run typecheck:solid2
pnpm --filter solid-sheet-www exec tsc --noEmit -p tsconfig.json
pnpm --filter @peculiarnewbie/e2e exec tsc --noEmit -p tsconfig.json
pnpm --filter peculiar-sheets-ironcalc typecheck
pnpm --filter peculiar-sheets-hyperformula typecheck
pnpm run format:check
pnpm run lint
pnpm run pack:check
pnpm run test:consumer
```

The library's public component/controller APIs and stylesheet import are unchanged.
The prior [Solid 2 migration notes](./solid-2-release.md) describe `0.13.0`'s
rc.7 toolchain and the original Solid 1 migration.
