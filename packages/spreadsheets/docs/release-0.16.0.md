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

## Staging receipts

Both versions were accepted by npm on 2026-11-02 with public access and the
intended `latest` tag:

| Package | Stage ID |
| --- | --- |
| `peculiar-sheets@0.16.0` | `e930e6f4-996c-44be-84b8-dfff86442c64` |
| `peculiar-sheets-ironcalc@0.16.0` | `31720d48-2fa5-41ff-a974-5b9fddf61d87` |

Downloaded staged tarballs match the local release artifacts byte for byte:

- Core SHA-256: `531aa5c87bf93a363c450bd84abcf327cc9e20f8e7533124179d5a7552301b2c`
- Adapter SHA-256: `a228d3e956d4e122252160dc83c64a461169dba199ff621d881051d43f7fb307`

The public registry still reports `0.15.0` as `latest` for both packages.
Check each stage's current validation status before approval. The token must
grant access to these two unscoped package names explicitly; access to only the
`@peculiarnewbie` or `@ue-shed` scopes does not cover them.
