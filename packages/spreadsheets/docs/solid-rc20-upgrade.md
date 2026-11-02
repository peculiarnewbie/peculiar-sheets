# Solid rc.20 upgrade (upcoming 0.16.0)

The development branch targets exactly `solid-js@2.0.0-rc.20`,
`@solidjs/web@2.0.0-rc.20`, and `@solidjs/signals@2.0.0-rc.20`. Upgrade these
packages together. The core, IronCalc adapter, and private HyperFormula adapter
are prepared as `0.16.0`; publication is a separate step.

The [Solid releases](https://github.com/solidjs/solid/releases) and published npm
manifests were checked on 2026-11-02. Matching compiler and Babel overrides stay
on rc.20; Vite consumers use `@solidjs/vite-plugin@3.0.0-next.55`. That plugin
replaces `hot: false` with `refresh: false`. The test application uses
`@tanstack/solid-router@2.0.0-rc.10` and component tests use
`@solidjs/testing-library@1.0.0-rc.2`.

The public Sheet and controller APIs remain unchanged. Effect application values
are readonly in the newer runtime. Virtual rows now use stable index keys and
reactive item accessors, preserving their DOM across measurement updates. Reads
of measurement snapshots in imperative callbacks explicitly use `untrack`.
Synchronous command state continues to compose before Solid's render flush.

Other workspace dependencies are refreshed, including IronCalc WASM `0.9.1`
(whose row API is now `moveRows`), HyperFormula `3.5.0`, and TypeScript `7.0.2`.
The stylesheet export includes a declaration for TypeScript 7's side-effect
import checking. The isolated Vite consumer also includes `vite/client` types.
Stagehand stays on its supported v3 line at `3.7.3`; v4 replaces
the browser API and requires a separate test-harness migration.

Run the checks from the repository root:

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm test:solid2
pnpm typecheck
pnpm typecheck:solid2
pnpm build
pnpm format:check
pnpm lint
pnpm pack:check
pnpm test:consumer
```

For browser tests on PowerShell, use headless mode and the production bundle:

```powershell
$env:E2E_HEADLESS = "true"
pnpm e2e:production
```

`pnpm e2e` still exercises the development bundle. Solid rc.20's development
diagnostics add substantial overhead to the large-grid test; its existing
400 ms scroll budget should be evaluated against the production bundle.
The detach-recovery test waits for Solid's queued flush before inspecting the
DOM, then checks that resizing restores both virtualizers and their cells.

`test:consumer` prints a temporary directory with an isolated npm install of the
core tarball. Its lockfile must contain exactly one copy of each rc.20 runtime.
The browser checks exposed as `window.__PACKED_CHECKS__.run()` include delegated
editing, paste, undo/redo, row DOM reuse with updated measurements, and observer
cleanup after unmount and remount.

Verified on Windows on 2026-11-02: all 219 unit tests, 7 component tests, 100
production browser tests, and 24 packed-consumer browser checks pass. Frozen
installation, workspace and component-test typechecks, all workspace builds,
formatting, lint, and both package gates pass. The packed consumer installs one
copy of each rc.20 runtime and builds with TypeScript 7. The development-only
large-grid timing check exceeded its 400 ms budget; the production run passes
the unchanged budget.

The prior [rc.9 release notes](./solid-rc9-release.md) describe the published
`0.15.0` release and its synchronous command-state migration.
