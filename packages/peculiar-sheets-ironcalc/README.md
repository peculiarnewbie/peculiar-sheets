# peculiar-sheets-ironcalc

The recommended formula engine for Peculiar Sheets. It adapts IronCalc's Rust/WASM model to the
engine-neutral `FormulaEngine` contract while keeping the `peculiar-sheets` core formula-free.

```bash
npm install --save-exact peculiar-sheets@0.15.0 peculiar-sheets-ironcalc@0.15.0 solid-js@2.0.0-rc.9 @solidjs/web@2.0.0-rc.9
```

```tsx
import { Sheet } from "peculiar-sheets";
import { createIronCalcFormulaEngine } from "peculiar-sheets-ironcalc";
import "peculiar-sheets/styles";

// Initialize before mounting; initialization errors reject this promise.
const engine = await createIronCalcFormulaEngine();

function FormulaSheet() {
	return <Sheet data={data} columns={columns} formulaEngine={{ instance: engine }} />;
}

// The host must call engine.dispose?.() after unmounting every Sheet using it.
```

WASM initialization is asynchronous, so render a loading or formula-free state until the factory
resolves. The adapter uses IronCalc's `en` locale and UTC timezone by default; both are configurable.

This adapter does not import Solid. Its core peer admits `0.11.x`, `0.12.x`,
`0.13.x`, `0.14.x`, and `0.15.x`; core `0.15.x` is compiled for Solid rc.9.

Peculiar Sheets owns application undo/redo. Do not call the wrapped IronCalc model's undo methods.

## License

MIT. IronCalc is available under MIT or Apache-2.0; see its distribution for details.
