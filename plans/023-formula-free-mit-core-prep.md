# Plan 023 upstream prep — owner and publication gate

Preparatory work on `feature/023-formula-free-mit-core` (2026-07-22).

## Verified in this worktree

- `peculiar-sheets@0.11.0` (unreleased) no longer declares `hyperformula` under `dependencies`.
- Optional formula APIs remain duck-typed in core; HyperFormula lives in the separately named GPL package `peculiar-sheets-hyperformula`.
- UE Shed's required surface (`Sheet`, `rowId`, operation/selection types, `peculiar-sheets/styles`) is preserved without installing HyperFormula.
- Packed-manifest gate: `pnpm --filter peculiar-sheets pack:check`.

## Not claimed / not done here

- **No MIT claim.** Package `license` remains `GPL-3.0-only`. This agent does not authorize copyright relicensing.
- **HyperFormula is not MIT.**
- **No publish, tag, push, or merge** was performed.
- **No npm formula-free MIT release exists yet** (`npm view peculiar-sheets@latest` still reports `GPL-3.0-only` with a HyperFormula production dependency as of the gate check).

## Owner action still required

1. Copyright holder explicitly authorizes an MIT license for the formula-free core code only.
2. Replace core `LICENSE` / `package.json#license` with MIT under that authorization (adapter stays GPL).
3. Publish a concrete formula-free core version (name/version decided by owner; likely `peculiar-sheets@>=0.11.0` or a dedicated core package name).
4. Publish evidence must show:
   - `npm view <core-package>@<version> license` → `MIT`
   - dependencies omit `hyperformula`
   - release notes identify the build as formula-free
5. Only after that evidence exists may UE Shed pin the exact published version, refresh its lockfile, add root MIT docs/checks, and mark Plan 023 DONE.

## UE Shed reminder

Do not update UE Shed to `0.11.0` (or any other version) until the published registry metadata satisfies the gate above.
