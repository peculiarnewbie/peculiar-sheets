import { onCleanup, onMount } from "solid-js";
import type { SheetController, SheetProps } from "./types";
import { DEFAULT_ROW_HEIGHT } from "./types";
import { createReconciler, createSheetStore } from "./core/state";
import { createFormulaBridge } from "./formula/bridge";
import { Result, isApplied } from "./internal/result";
import { SheetCustomizationContext } from "./customization";
import Grid from "./grid/Grid";
import { getWorkbookCoordinatorInternals } from "./workbook/coordinator";

export function Sheet(props: SheetProps) {
	if (props.formulaEngine && props.workbook) {
		throw new Error("Sheet props `formulaEngine` and `workbook` are mutually exclusive.");
	}

	const rowHeight = () => props.rowHeight ?? DEFAULT_ROW_HEIGHT;
	const readOnly = () => props.readOnly ?? false;
	const columns = () => props.columns;
	const workbookInternals = () =>
		props.workbook ? getWorkbookCoordinatorInternals(props.workbook.coordinator) : null;
	const resolvedFormulaEngine = () =>
		props.workbook
			? workbookInternals()!.getFormulaEngineConfig(props.workbook)
			: props.formulaEngine;
	const formulaBridge = createFormulaBridge(resolvedFormulaEngine());
	const showFormulaBar = () =>
		props.showFormulaBar ?? Boolean(props.formulaEngine || props.workbook);
	const showReferenceHeaders = () =>
		props.showReferenceHeaders ?? Boolean(props.formulaEngine || props.workbook);
	const workbookDataGetter = () => props.data;
	let attachedController: SheetController | null = null;

	function syncFormulaBridge() {
		if (!formulaBridge) return;

		const ensured = formulaBridge.ensureSheet();
		if (Result.isError(ensured) || !isApplied(ensured.value)) {
			return;
		}

		const synced = formulaBridge.syncAll(props.data);
		if (Result.isError(synced) || !isApplied(synced.value)) {
			return;
		}
	}

	// ── Create Store ───────────────────────────────────────────────────────

	const store = createSheetStore(props.data, props.columns);

	// ── Data Reconciliation ────────────────────────────────────────────────

	createReconciler(
		store,
		() => props.data,
		() => props.columns,
		() => {
			syncFormulaBridge();
		},
	);

	onMount(() => {
		if (props.workbook) {
			workbookInternals()!.attachDataGetter(props.workbook.sheetKey, workbookDataGetter);
		}
		syncFormulaBridge();
	});

	onCleanup(() => {
		if (props.workbook) {
			if (attachedController) {
				workbookInternals()!.detachController(props.workbook.sheetKey, attachedController);
			}
			workbookInternals()!.detachDataGetter(props.workbook.sheetKey, workbookDataGetter);
		}
		formulaBridge?.dispose();
	});

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
				onEditModeChange={(state) => {
					if (props.workbook) {
						workbookInternals()!.handleEditModeChange(props.workbook.sheetKey, state);
					}
					props.onEditModeChange?.(state);
				}}
				onClipboard={props.onClipboard}
				resizeMode={props.resizeMode ?? "onEnd"}
				columnSizing={props.columnSizing}
				onColumnSizingChange={props.onColumnSizingChange}
				rowSizing={props.rowSizing}
				onRowSizingChange={props.onRowSizingChange}
				onColumnResize={props.onColumnResize}
				onRowResize={props.onRowResize}
				onSort={props.onSort}
				onSortChange={props.onSortChange}
				onRowInsert={props.onRowInsert}
				onRowDelete={props.onRowDelete}
				onRowReorder={props.onRowReorder}
				onCellPointerDown={(address, event) => {
					const handledByWorkbook = props.workbook
						? workbookInternals()!.handleCellPointerDown(props.workbook.sheetKey, address, event)
						: false;
					if (handledByWorkbook) return true;
					return props.onCellPointerDown?.(address, event) ?? false;
				}}
				onCellPointerMove={(address, event) => {
					const handledByWorkbook = props.workbook
						? workbookInternals()!.handleCellPointerMove(props.workbook.sheetKey, address, event)
						: false;
					if (handledByWorkbook) return true;
					return props.onCellPointerMove?.(address, event) ?? false;
				}}
				controllerRef={(controller) => {
					if (props.workbook) {
						if (attachedController && attachedController !== controller) {
							workbookInternals()!.detachController(props.workbook.sheetKey, attachedController);
						}
						workbookInternals()!.attachController(props.workbook.sheetKey, controller);
						attachedController = controller;
					}
					props.ref?.(controller);
				}}
				formulaBridge={formulaBridge}
				workbook={props.workbook}
				showFormulaBar={showFormulaBar()}
				showReferenceHeaders={showReferenceHeaders()}
				sortBehavior={props.sortBehavior ?? "view"}
				sortState={props.sortState}
				defaultSortState={props.defaultSortState ?? null}
			/>
		</SheetCustomizationContext.Provider>
	);
}
