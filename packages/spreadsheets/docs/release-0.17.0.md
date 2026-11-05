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
