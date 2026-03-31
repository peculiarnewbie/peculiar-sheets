import { createEffect, onCleanup } from "solid-js";
import type { SheetProps } from "./types";
import { DEFAULT_ROW_HEIGHT } from "./types";
import { createReconciler, createSheetStore } from "./core/state";
import { createFormulaBridge } from "./formula/bridge";
import { SheetCustomizationContext } from "./customization";
import Grid from "./grid/Grid";

export function Sheet(props: SheetProps) {
	const rowHeight = () => props.rowHeight ?? DEFAULT_ROW_HEIGHT;
	const readOnly = () => props.readOnly ?? false;
	const columns = () => props.columns;
	const formulaBridge = createFormulaBridge(props.formulaEngine);
	const showFormulaBar = () => props.showFormulaBar ?? Boolean(props.formulaEngine);
	const showReferenceHeaders = () => props.showReferenceHeaders ?? Boolean(props.formulaEngine);

	// ── Create Store ───────────────────────────────────────────────────────

	const store = createSheetStore(props.data, props.columns);

	// ── Data Reconciliation ────────────────────────────────────────────────

	createReconciler(
		store,
		() => props.data,
		() => props.columns,
	);

	createEffect(() => {
		formulaBridge?.ensureSheet();
		formulaBridge?.syncAll(props.data);
	});

	onCleanup(() => formulaBridge?.dispose());

	// ── Render ─────────────────────────────────────────────────────────────

	return (
		<SheetCustomizationContext.Provider value={props.customization}>
			<Grid
				store={store}
				columns={columns()}
				rowHeight={rowHeight()}
				readOnly={readOnly()}
				onSelectionChange={props.onSelectionChange}
				onCellEdit={props.onCellEdit}
				onBatchEdit={props.onBatchEdit}
				onEditModeChange={props.onEditModeChange}
				onClipboard={props.onClipboard}
				onColumnResize={props.onColumnResize}
				onSort={props.onSort}
				onCellPointerDown={props.onCellPointerDown}
				onCellPointerMove={props.onCellPointerMove}
				controllerRef={props.ref}
				formulaBridge={formulaBridge}
				showFormulaBar={showFormulaBar()}
				showReferenceHeaders={showReferenceHeaders()}
			/>
		</SheetCustomizationContext.Provider>
	);
}
