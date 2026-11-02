# Release preparation: 0.16.0

Prepared on 2026-11-02 from the dependency upgrade at `a453084`. Both public
packages are versioned `0.16.0` and target npm's `latest` tag when approved.
At preparation time, npm lists `0.15.0` as the latest published version of both
packages. This release is submitted for staged review; staging does not publish
it or move the public `latest` tags.

## Changes

- Upgrade Solid's runtime, web runtime, signals, compiler, and Babel plugin to
  exactly `2.0.0-rc.20`, with Vite plugin `3.0.0-next.55`. Consumers must upgrade
  the three runtime peers together.
- Refresh other dependencies, including TypeScript 7, Vite 8.3, HyperFormula
  3.5, and IronCalc WASM 0.9.1. Update the IronCalc row-movement API.
- Preserve virtual row DOM across measurement updates, accept readonly effect
  snapshots, and explicitly read imperative measurement snapshots without tracking.
- Ship stylesheet declarations for TypeScript 7 side-effect import checking.

The component, controller, and stylesheet import APIs remain unchanged. The core
stays formula-free and MIT licensed. The IronCalc adapter remains independent of
Solid and admits core `0.11.x` through `0.16.x`. The workspace HyperFormula adapter
is private and is not staged. See [the rc.20 migration notes](./solid-rc20-upgrade.md).

## Validation

The dependency upgrade passed 219 unit tests, 7 Solid component tests, 100
production browser tests, and 24 packed-consumer browser checks on Windows.
Workspace builds, source and component typechecks, formatting, lint, frozen
installation, and both package gates passed. Release preparation rebuilds and
checks the packages, validates the final tarballs with npm's staging dry run,
and verifies an isolated consumer install.

The development-only large-grid scroll timing check exceeds its existing 400 ms
budget with Solid's development diagnostics. The full production browser suite
passes the unchanged performance budget. TypeScript 7 declaration emission still
produces tsdown's experimental API warning; package and isolated-consumer checks
pass. Existing application chunk-size and Stagehand/Zod peer warnings remain.

## Artifacts

The git-ignored `dist/releases/` directory contains:

- `peculiar-sheets-0.16.0.tgz`
- `peculiar-sheets-ironcalc-0.16.0.tgz`
- `release-0.16.0.json`, recording tarball SHA-256/SHA-512 hashes, source commit,
  package contents, and npm staging receipts.

Regenerate the packages from the repository root before submitting changed bytes:

```sh
pnpm build:lib
pnpm --filter peculiar-sheets-ironcalc build
pnpm pack:check
pnpm test:consumer
pnpm -C packages/peculiar-sheets-ironcalc pack --pack-destination ../../dist/releases
```

pnpm packing resolves workspace metadata before upload. Stage these exact tarballs
using a stage-only token supplied through temporary npm configuration:

```sh
npm stage publish ./dist/releases/peculiar-sheets-0.16.0.tgz --access public --tag latest
npm stage publish ./dist/releases/peculiar-sheets-ironcalc-0.16.0.tgz --access public --tag latest
```

Review each returned stage with `npm stage view <stage-id>` and download it with
`npm stage download <stage-id>` to compare its bytes with the local artifact.
The maintainer can then approve the core first and the adapter second with
`npm stage approve <stage-id>` or through npm's Staged Packages UI. Approval
requires the maintainer's 2FA; it is separate from this preparation and staging.
