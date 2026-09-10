# peculiar-sheets-ironcalc

The recommended formula engine for Peculiar Sheets. It adapts IronCalc's Rust/WASM model to the
engine-neutral `FormulaEngine` contract while keeping the `peculiar-sheets` core formula-free.

```bash
npm install --save-exact peculiar-sheets@0.13.0 peculiar-sheets-ironcalc@0.13.0 solid-js@2.0.0-rc.7 @solidjs/web@2.0.0-rc.7
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

The versions above are prepared regular releases. Until published, install the matching
local tarballs. This adapter does not import Solid; its core peer explicitly admits
the Solid 2 core `0.13.x` as well as core `0.11.x` and `0.12.x`.

Peculiar Sheets owns application undo/redo. Do not call the wrapped IronCalc model's undo methods.

## License

MIT. IronCalc is available under MIT or Apache-2.0; see its distribution for details.
