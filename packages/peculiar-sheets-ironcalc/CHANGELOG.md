# Changelog

## 0.14.0 - Unreleased

- Admit `peculiar-sheets@^0.14.0`, built for Solid `2.0.0-rc.9`, and update the
  packed-manifest compatibility gate. Retain the existing core peer ranges;
  the adapter remains runtime-neutral and does not import Solid.

## 0.13.0

- Explicitly admit `peculiar-sheets@^0.13.0` (Solid 2), retaining compatibility
  with core `0.11.x` and `0.12.x`.
- Keep the adapter runtime-neutral and core as a peer; validate the packed manifest
  and JavaScript. Upgrade the build and document Solid 2 engine ownership.
- Prepare the regular release on the `latest` npm tag; no publication has been performed.

## 0.11.1

- Replace leaked `workspace:*` Peculiar Sheets metadata with the public `0.11.x` peer range.
- Add a packed-manifest gate that rejects workspace protocols and dependency-boundary drift.

## 0.11.0

- Initial IronCalc WASM formula-engine adapter for Peculiar Sheets.
