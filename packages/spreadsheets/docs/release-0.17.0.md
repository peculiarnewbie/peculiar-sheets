# Release preparation: 0.17.0

Prepared on 2026-11-05 from the performance branch `perf/benchmark-within-twenty-percent`.
Both public packages are versioned `0.17.0` and target npm's `latest` tag. At
preparation time, npm lists `0.16.0` as `latest` for both packages.

## Changes

- Rework rendering and storage for speed and memory: reused viewport rows and
  column slots, virtualized headers, shared cell geometry, lazily observed row
  revisions, compact owned rows, retained row geometry across controlled data
  replacements, fused distinct batch writes, and forward-only undo records.
- Promote the viewport to an accelerated scroll layer for native wheel input.
- Default plain-text cells use block layout with `se-cell--text`; the
  `.se-cell__text` span remains but uses `display: contents`. Consumers that put
  box styles on that span should move them to `.se-cell` or `.se-cell--text`.
- `onOperation` listeners receive detached mutation-record copies.
- Fix CRLF clipboard paste and focused-row reveal below the sticky header.

The component, controller, and stylesheet import APIs remain unchanged, as do the
exact Solid `2.0.0-rc.20` peers. The IronCalc adapter is unchanged apart from
admitting core `0.17.x`. The workspace HyperFormula adapter is private and is not
published.

## Validation

On Windows from a clean checkout of `66419ee`: frozen install, workspace build,
257 unit tests, 21 Solid component tests, all workspace and Solid typechecks,
both package gates, the isolated packed-consumer install, and 108 production
browser tests passed. `npm publish --dry-run` accepted both tarballs with public
access and the `latest` tag. The package gates extract tarballs with `tar`; run
them where `tar` resolves to Windows' `tar.exe`, because Git Bash's GNU `tar`
treats `C:` paths as remote hosts.

| Package | Bytes | SHA-256 |
| --- | ---: | --- |
| `peculiar-sheets@0.17.0` | 83742 | `123523b49b188907943fef1fafd7041c54e2b771ce1e564ecba3e0e28944e9ae` |
| `peculiar-sheets-ironcalc@0.17.0` | 5852 | `1a99ef35f81f7baaf3190a10a11f66f8d8c81b9f12dabe3d844e7a65a4b12644` |

## Artifacts

The git-ignored `dist/releases/` directory contains:

- `peculiar-sheets-0.17.0.tgz`
- `peculiar-sheets-ironcalc-0.17.0.tgz`
- `release-0.17.0.json`, recording tarball SHA-256/SHA-512 hashes, the source
  commit, and package contents.

Regenerate them from a clean checkout of the release commit:

```sh
pnpm install --frozen-lockfile
pnpm --filter peculiar-sheets-ironcalc build
pnpm pack:check
pnpm test:consumer
pnpm -C packages/peculiar-sheets-ironcalc pack --pack-destination ../../dist/releases
```

`pnpm test:consumer` rebuilds the core and packs it into `dist/releases/`. pnpm
packing resolves the adapter's `workspace:` metadata, so publish the tarballs
rather than running `npm publish` inside a package directory.

## Publish

Publish the core first, then the adapter (npm prompts for 2FA):

```sh
npm publish ./dist/releases/peculiar-sheets-0.17.0.tgz --access public --tag latest
npm publish ./dist/releases/peculiar-sheets-ironcalc-0.17.0.tgz --access public --tag latest
```

Confirm with `npm view peculiar-sheets dist-tags` and
`npm view peculiar-sheets-ironcalc dist-tags`.
