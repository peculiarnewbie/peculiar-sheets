# peculiar-sheets

A high-performance SolidJS spreadsheet component with a formula-free MIT core and optional formula
engines.

- `peculiar-sheets` — the grid, workbook coordination, and engine-neutral `FormulaEngine` contract
- `peculiar-sheets-ironcalc` — the recommended MIT/Apache-2.0 IronCalc WASM adapter
- HyperFormula — supported for existing applications through a source-compatible legacy adapter;
  applications install it directly under its GPLv3 or commercial license

## Installation

Formula-free:

```bash
npm install --save-exact peculiar-sheets@0.13.0 solid-js@2.0.0-rc.7 @solidjs/web@2.0.0-rc.7
```

Recommended formula support:

```bash
npm install --save-exact peculiar-sheets-ironcalc@0.13.0
```

IronCalc initializes asynchronously. Create the engine with
`createIronCalcFormulaEngine()`, wait for it to resolve, then pass it as
`formulaEngine={{ instance: engine }}` or to `createWorkbookCoordinator({ engine })`.

Existing direct HyperFormula configurations remain valid after adding it as an explicit dependency:

```bash
npm install --save-exact hyperformula@3.3.0
```

See [the package README](./packages/spreadsheets/README.md) for usage, migration, workbook APIs,
and the complete feature reference.

## Development

```bash
pnpm install
pnpm test
pnpm test:solid2
pnpm typecheck
pnpm build
pnpm pack:check
pnpm test:consumer
```

These are prepared, unpublished releases. Install the packed tarballs until
publication. See [Solid 2 release notes](./packages/spreadsheets/docs/solid-2-release.md)
for the exact compiler setup and UE Shed migration. pnpm owns dependency installation;
the obsolete Bun lockfile has been removed. Bun is used to execute unit tests and scripts.

## License

The `peculiar-sheets` core and `peculiar-sheets-ironcalc` adapter are MIT licensed. IronCalc is
distributed under MIT or Apache-2.0. HyperFormula is not bundled or relicensed.
