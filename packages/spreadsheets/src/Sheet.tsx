import { onCleanup, onMount } from "solid-js";
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
		() => {
			formulaBridge?.ensureSheet();
			formulaBridge?.syncAll(props.data);
		},
	);

	onMount(() => {
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
				onSortChange={props.onSortChange}
				onRowInsert={props.onRowInsert}
				onRowDelete={props.onRowDelete}
				onRowReorder={props.onRowReorder}
				onCellPointerDown={props.onCellPointerDown}
				onCellPointerMove={props.onCellPointerMove}
				controllerRef={props.ref}
				formulaBridge={formulaBridge}
				showFormulaBar={showFormulaBar()}
				showReferenceHeaders={showReferenceHeaders()}
				sortBehavior={props.sortBehavior ?? "view"}
				sortState={props.sortState}
				defaultSortState={props.defaultSortState ?? null}
			/>
		</SheetCustomizationContext.Provider>
	);
}
