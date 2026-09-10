# Solid 2 release: 0.13.0

Prepared on 2026-09-10. npm publication and release tagging remain separate,
explicit release steps; preparing or pushing these changes does not publish them.
Core and the optional IronCalc adapter both use `0.13.0`. Their default
publication tag is `latest`. The pre-1.0 minor bump marks the Solid 1 compatibility break.
This is a regular package release; its supported Solid runtime remains `2.0.0-rc.7`.

## Verified dependency set

Versions were checked against the npm registry's published manifests, not inferred
from the `latest` tag (Solid's `latest` still points to 1.x).

| Package | Exact version | Purpose |
| --- | --- | --- |
| `solid-js` | `2.0.0-rc.7` | Core peer and development runtime |
| `@solidjs/web` | `2.0.0-rc.7` | Web peer and JSX types/runtime |
| `@solidjs/signals` | `2.0.0-rc.7` | Runtime's transitive reactive engine |
| `@solidjs/compiler` | `2.0.0-rc.7` | Native JSX compilation of the published library |
| `@solidjs/babel-plugin` | `2.0.0-rc.7` | Vite integration's matching fallback |
| `@solidjs/vite-plugin` | `3.0.0-next.40` | Vite 8 integration admitting rc.7 |
| `vite` | `8.2.2` | Consumer and application builds |
| `tsdown` | `0.23.0` | Library JS and declaration bundles |
| `@solidjs/testing-library` | `1.0.0-beta.3` | Solid 2 DOM tests |
| `vitest` | `5.0.0` | Component test runner |
| `@tanstack/virtual-core` | `3.17.9` | Framework-neutral virtualization |
| `@tanstack/solid-router` | `2.0.0-rc.7` | Test application's lazy-route coverage only |
| `better-result` | `3.0.1` | Internal orchestration and tagged runtime failures |

The legacy `vite-plugin-solid@3.0.0-next.27` wrapper's tag was stale relative to
the renamed official package. Use `@solidjs/vite-plugin` above. The published
`@tanstack/solid-virtual@3.13.38` still requires Solid 1, so it is removed entirely.
Peers are intentionally exact: later RCs are not claimed as compatible without testing.

Primary references:

- [Official migration guide at the rc.7 package's git revision](https://github.com/solidjs/solid/blob/b1c4399ef726397581374bd9378d9e4596c83dba/documentation/solid-2.0/MIGRATION.md)
- [Official compiler usage](https://github.com/solidjs/solid/blob/b1c4399ef726397581374bd9378d9e4596c83dba/packages/compiler/README.md)
- [Runtime published manifest](https://registry.npmjs.org/solid-js/2.0.0-rc.7)
- [Web published manifest](https://registry.npmjs.org/@solidjs/web/2.0.0-rc.7)
- [Vite plugin published manifest](https://registry.npmjs.org/@solidjs/vite-plugin/3.0.0-next.40)
- [Testing library published manifest](https://registry.npmjs.org/@solidjs/testing-library/1.0.0-beta.3)

## Implementation and API

The tsdown transform calls the native Solid 2 compiler for every TSX module. Both
Solid packages stay external, with ordinary ESM imports in `dist/index.js`.
The packed gates validate the emitted JavaScript and declarations as well as peers.

Effects use compute/apply separation and return cleanup. Grid-owned virtualizer
observers, drag/paste listeners, debounce work, asynchronous search, and deferred
caret work are released or cancelled on disposal. Late asynchronous clipboard
reads are ignored after unmount; clipboard failures produce tagged internal traces.

Command cell data uses a synchronous plain array with reactive row/structural
revisions. This preserves same-turn workbook/history operations without flushing
the host application on every write or allocating a full store snapshot per cell.
Command signals use Solid 2 `latest` where an imperative read must see a pending
write. DOM notifications retain Solid 2's normal batching. A focused test verifies
that repeated writes to one row do not invalidate another row.

`Sheet`, its props and controller, and `peculiar-sheets/styles` retain their public
entry points. Custom renderers use Solid 2 JSX. DOM attributes now follow Solid 2
conventions, including string ARIA booleans, lowercase HTML attributes and class maps.

## UE Shed installation

Before publication, from the UE Shed project (adjust the tarball location):

```sh
pnpm add --save-exact /path/to/peculiar-sheets-0.13.0.tgz solid-js@2.0.0-rc.7 @solidjs/web@2.0.0-rc.7
pnpm add -D --save-exact @solidjs/vite-plugin@3.0.0-next.40 @solidjs/compiler@2.0.0-rc.7 vite@8.2.2
```

If using IronCalc, also install the companion `peculiar-sheets-ironcalc-0.13.0.tgz`.
After publication the corresponding exact version specs replace the tarball paths.

Remove the isolated Solid 1 runtime dependency, aliases and compatibility renderer
from UE Shed. Render directly within the existing Solid 2 root:

```tsx
import { Sheet } from "peculiar-sheets";
import "peculiar-sheets/styles";

// Inside an existing Solid 2 component:
<Sheet data={rows()} columns={columns} onOperation={handleOperation} />;
```

Use `import solid from "@solidjs/vite-plugin"` in Vite configuration, with
`plugins: [solid()]`. Set `jsxImportSource: "@solidjs/web"` and `jsx: "preserve"`.
DOM `render`, `hydrate`, and `JSX` imports move to `@solidjs/web`; reactive APIs stay
in `solid-js`. The package README includes a controlled-data example.

## Verification

```sh
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm typecheck:solid2
pnpm test
pnpm test:solid2
pnpm build
pnpm pack:check
pnpm test:consumer
```

The unit suite has 219 passing tests; five focused Solid 2 component tests cover
controlled updates, same-turn editing/history, row-granular invalidation, queued
focus disposal and asynchronous clipboard disposal.

`test:consumer` builds and packs the core into `dist/releases`, copies a minimal
consumer outside the workspace, installs using npm, checks the installed lockfile
for exactly one rc.7 copy of Solid/web/signals, and type-checks/builds that consumer.
It prints its temporary directory. Run `npm run preview` there and, in a browser,
execute `await window.__PACKED_CHECKS__.run()` (fresh document for each run).

The browser script checks 22 assertions: rendering, reactive data/columns,
editing/focus/Enter, arrow and extended selection, TSV paste, copy/cut, undo/redo,
read-only updates, 10,000-row virtualization, unmount/remount, observer release,
paste-listener removal and render-root disposal. Copy/cut use an in-memory
clipboard boundary; scrolling explicitly dispatches a scroll event because the
embedded browser can defer native scroll delivery while hidden. Input/keyboard
events are programmatically dispatched through the real DOM and compiled handlers.

All 22 checks passed against the packed production consumer before the metadata-only
rename to the regular `0.13.0` release. The `0.13.0` tarball was freshly installed,
type-checked and built in an isolated consumer with one Solid 2 runtime; its compiled
library JavaScript is byte-for-byte identical to that browser-tested build. Both
package checks, formatting, lint and all five Solid 2 tests were rerun successfully.
The same
22-check scenario also passed with the Solid 2 development runtime before the
final clipboard-disposal hardening; that last change has its own passing component
regression test and was included in the final production-consumer run.

The production e2e application was also checked for formula clean mount (`=1+2`
evaluates to `3`), lazy-route readiness and simulated late-detach recovery, and
cross-sheet recalculation/controlled host updates. The companion adapter tarball
installs alongside the core with deduplicated rc.7 peers and no Solid runtime import.

## Limits

- The grid's distributable is client DOM code, not an SSR/hydration build.
- Only rc.7 is supported. Formula engines/workbook bindings remain mount-time
  configuration; remount to replace them and dispose host-owned engines after Sheets.
- The historical `typecheck:all` target and direct e2e-app `tsc` report existing
  test/fixture typing debt (Bun declarations and unbranded numeric addresses). The
  supported workspace source typecheck, new component tests and packed consumer
  typecheck pass. These optional broad targets are not claimed as passing.
- The full legacy Stagehand suite, OS clipboard permissions, real pointer gestures,
  Firefox and Safari were not exercised. Formula browser checks use HyperFormula;
  IronCalc received unit, build, packing and installation checks, not browser WASM checks.
- Existing Stagehand/Zod peer and large showcase/benchmark chunk warnings remain.
  pnpm is the sole install lockfile; Bun executes tests/scripts only.

## Prepared artifacts

Local tarballs are in the git-ignored `dist/releases/` directory:

- `peculiar-sheets-0.13.0.tgz`
  SHA-256: `5976f36c831d871cff44fbfb6d776c0c24bf03c7605d6537650d26a1c27893f8`
- `peculiar-sheets-ironcalc-0.13.0.tgz`
  SHA-256: `e59c8a328dc788d24eaddee2080a82b22e35b741b8bd0b32a8cfa3dbf3afd6db`
