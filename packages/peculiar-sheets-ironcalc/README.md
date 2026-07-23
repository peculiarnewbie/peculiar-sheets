# peculiar-sheets-ironcalc

The recommended formula engine for Peculiar Sheets. It adapts IronCalc's Rust/WASM model to the
engine-neutral `FormulaEngine` contract while keeping the `peculiar-sheets` core formula-free.

```bash
npm install peculiar-sheets peculiar-sheets-ironcalc
```

```tsx
import { createSignal, onCleanup, onMount, Show } from "solid-js";
import { Sheet } from "peculiar-sheets";
import { createIronCalcFormulaEngine } from "peculiar-sheets-ironcalc";

function FormulaSheet() {
	const [engine, setEngine] = createSignal<Awaited<
		ReturnType<typeof createIronCalcFormulaEngine>
	> | null>(null);
	let created: Awaited<ReturnType<typeof createIronCalcFormulaEngine>> | null = null;

	onMount(async () => {
		created = await createIronCalcFormulaEngine();
		setEngine(created);
	});
	onCleanup(() => created?.dispose?.());

	return <Show when={engine()}>{(ready) =>
		<Sheet data={data} columns={columns} formulaEngine={{ instance: ready() }} />
	}</Show>;
}
```

WASM initialization is asynchronous, so render a loading or formula-free state until the factory
resolves. The adapter uses IronCalc's `en` locale and UTC timezone by default; both are configurable.

Peculiar Sheets owns application undo/redo. Do not call the wrapped IronCalc model's undo methods.

## License

MIT. IronCalc is available under MIT or Apache-2.0; see its distribution for details.
