# Release preparation: 0.14.0

Prepared on 2026-10-01 from `main` at `06e2fac`. Both public packages are
versioned `0.14.0` with the default npm tag `latest`. npm still lists `0.13.0`
as the latest published version of both packages at preparation time.
Publication is left to the maintainer; only dry runs were performed.

## Changes

- Align `peculiar-sheets` and `peculiar-sheets-ironcalc` at `0.14.0`, with current
  installation examples and changelogs.
- Add `@solidjs/signals@2.0.0-rc.7` as an exact core peer and development
  dependency. Solid rc.7 declares `^2.0.0-rc.7` for signals, which a clean npm
  installation now resolves to rc.13 without this peer constraint. The packed
  gate checks all three runtime peers; an isolated install verifies one shared
  rc.7 copy of `solid-js`, `@solidjs/web`, and `@solidjs/signals` without overrides.
- Extend the IronCalc core peer range to
  `^0.11.0 || ^0.12.0 || ^0.13.0 || ^0.14.0` and update its packed-manifest gate.

Component/controller APIs and runtime implementation are unchanged. The core
remains formula-free, and the IronCalc adapter remains independent of Solid.
See [the original Solid 2 migration guide](./solid-2-release.md) for application
migration and compiler configuration. The upstream dependency range can be
checked in [Solid rc.7's published manifest](https://registry.npmjs.org/solid-js/2.0.0-rc.7).

## Validation

Passed during preparation:

| Check | Result |
| --- | --- |
| `pnpm install --frozen-lockfile` | Lockfile consistent |
| `pnpm format:check` and `pnpm lint` | Changed source and manifests pass |
| `pnpm typecheck` and `pnpm typecheck:solid2` | Workspace source and component types pass |
| `pnpm test` | 219 tests pass, including real IronCalc WASM tests |
| `pnpm test:solid2` | 5 component tests pass |
| `pnpm build` | All workspace builds pass |
| `pnpm pack:check` | Core and adapter manifest/runtime gates pass |
| `pnpm test:consumer` | Fresh npm tarball install, deduplicated rc.7 runtime, typecheck and production build pass |
| Both tarballs installed in the isolated consumer | Shared core and Solid runtime; consumer build passes |
| Packed production consumer in headless Chromium | All 22 existing checks pass, with no page errors |
| `npm publish ... --dry-run --access public --tag latest` | Both tarballs pass |

The browser checks cover rendering, controlled updates, editing, navigation,
selection, clipboard, undo/redo, read-only behavior, virtualization, remounting,
and observer/listener cleanup. The T3 preview host was unavailable, so the existing
consumer checks ran with local Playwright and an installed Chromium executable.
The full Stagehand suite, Firefox/Safari, and browser IronCalc initialization
were not rerun. Existing app chunk-size, Vite config, and npm config warnings remain.

## Prepared artifacts

Tarballs are in the git-ignored `dist/releases/` directory at the repository root:

- `peculiar-sheets-0.14.0.tgz`
  SHA-256: `d8504eb45f1697be967a64a439c0d75cdba72603aad84596480bc72e1948114f`
- `peculiar-sheets-ironcalc-0.14.0.tgz`
  SHA-256: `f21708e43348c51e0479580fd0c55f621ce6d9a61404bc863b5837f0faa93f9e`

To regenerate after changing package source or packed documentation, run from
the repository root, then repeat the package and consumer checks:

```sh
pnpm build
pnpm pack:check
pnpm test:consumer
pnpm -C packages/peculiar-sheets-ironcalc pack --pack-destination ../../dist/releases
```

## Publish

From the repository root, publish the verified tarballs in this order:

```sh
npm publish ./dist/releases/peculiar-sheets-0.14.0.tgz --access public --tag latest
npm publish ./dist/releases/peculiar-sheets-ironcalc-0.14.0.tgz --access public --tag latest
```

Publishing the pnpm-packed artifacts preserves the resolved workspace metadata
that was checked and installed during preparation. Git commits, pushes, and
release tags are separate from npm publication.
