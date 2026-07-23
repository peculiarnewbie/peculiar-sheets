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
npm install peculiar-sheets
```

Recommended formula support:

```bash
npm install peculiar-sheets peculiar-sheets-ironcalc
```

IronCalc initializes asynchronously. Create the engine with
`createIronCalcFormulaEngine()`, wait for it to resolve, then pass it as
`formulaEngine={{ instance: engine }}` or to `createWorkbookCoordinator({ engine })`.

Existing direct HyperFormula configurations remain valid after adding it as an explicit dependency:

```bash
npm install peculiar-sheets hyperformula
```

See [the package README](./packages/spreadsheets/README.md) for usage, migration, workbook APIs,
and the complete feature reference.

## Development

```bash
pnpm install
bun test
pnpm typecheck
pnpm build
pnpm pack:check
```

## License

The `peculiar-sheets` core and `peculiar-sheets-ironcalc` adapter are MIT licensed. IronCalc is
distributed under MIT or Apache-2.0. HyperFormula is not bundled or relicensed.
