# Changelog

## 0.14.0 - Unreleased

- Explicitly admit `peculiar-sheets@^0.14.0`, retaining compatibility with core
  `0.11.x`, `0.12.x`, and `0.13.x`.
- Align the adapter version and installation documentation with core `0.14.0`.
- Keep the runtime implementation and IronCalc dependency unchanged from `0.13.0`.

## 0.13.0 - 2026-09-10

- Explicitly admit `peculiar-sheets@^0.13.0` (Solid 2), retaining compatibility
  with core `0.11.x` and `0.12.x`.
- Keep the adapter runtime-neutral and core as a peer; validate the packed manifest
  and JavaScript. Upgrade the build and document Solid 2 engine ownership.
- Publish the regular release on the `latest` npm tag.

## 0.11.1

- Replace leaked `workspace:*` Peculiar Sheets metadata with the public `0.11.x` peer range.
- Add a packed-manifest gate that rejects workspace protocols and dependency-boundary drift.

## 0.11.0

- Initial IronCalc WASM formula-engine adapter for Peculiar Sheets.
