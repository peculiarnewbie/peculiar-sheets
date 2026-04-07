import { onMount } from "solid-js";
import { Sheet, type CellMutation, type CellValue, type ColumnDef, type FormulaEngineConfig, type SheetController } from "peculiar-sheets";
import "peculiar-sheets/styles";

export interface HarnessProps {
	initialData: CellValue[][];
	columns: ColumnDef[];
	formulaEngine?: FormulaEngineConfig;
	readOnly?: boolean;
	showFormulaBar?: boolean;
	showReferenceHeaders?: boolean;
}

/**
 * Test harness that wraps <Sheet> and exposes state on `window` for e2e assertions.
 *
 * - `window.__SHEET_DATA__`       — current cell data (updated on every mutation)
 * - `window.__MUTATIONS__`        — all mutations since page load
 * - `window.__SHEET_CONTROLLER__` — imperative controller handle
 */
export default function Harness(props: HarnessProps) {
	const sheetData = structuredClone(props.initialData);

	// ── Expose state on window ────────────────────────────────────────────

	onMount(() => {
		window.__SHEET_DATA__ = sheetData;
		window.__MUTATIONS__ = [];
		window.__SHEET_CONTROLLER__ = null;
	});

	// ── Mutation handlers ─────────────────────────────────────────────────

	function applyMutation(mutation: CellMutation) {
		const { row, col } = mutation.address;
		// Grow rows/cols if needed while preserving the same top-level reference.
		while (sheetData.length <= row) sheetData.push([]);
		while (sheetData[row]!.length <= col) sheetData[row]!.push(null);
		sheetData[row]![col] = mutation.newValue;
		window.__SHEET_DATA__ = sheetData;
	}

	function handleCellEdit(mutation: CellMutation) {
		window.__MUTATIONS__.push(mutation);
		applyMutation(mutation);
	}

	function handleBatchEdit(mutations: CellMutation[]) {
		window.__MUTATIONS__.push(...mutations);
		for (const m of mutations) applyMutation(m);
	}

	function handleRowInsert(atIndex: number, count: number) {
		const emptyRows = Array.from({ length: count }, () =>
			new Array(props.columns.length).fill(null),
		);
		sheetData.splice(atIndex, 0, ...emptyRows);
		// Sync back from controller — during undo of deleteRows the store
		// restores the original cell values, so read them back.
		if (window.__SHEET_CONTROLLER__) {
			for (let r = atIndex; r < atIndex + count; r++) {
				for (let c = 0; c < props.columns.length; c++) {
					sheetData[r]![c] = window.__SHEET_CONTROLLER__.getCellValue(r, c);
				}
			}
		}
		window.__SHEET_DATA__ = sheetData;
	}

	function handleRowDelete(atIndex: number, count: number) {
		sheetData.splice(atIndex, count);
		window.__SHEET_DATA__ = sheetData;
	}

	function handleRef(ctrl: SheetController) {
		window.__SHEET_CONTROLLER__ = ctrl;
	}

	// ── Render ────────────────────────────────────────────────────────────

	return (
		<div style={{ width: "100vw", height: "100vh" }} data-testid="harness">
			<Sheet
				data={sheetData}
				columns={props.columns}
				readOnly={props.readOnly}
				formulaEngine={props.formulaEngine}
				showFormulaBar={props.showFormulaBar}
				showReferenceHeaders={props.showReferenceHeaders}
				onCellEdit={handleCellEdit}
				onBatchEdit={handleBatchEdit}
				onRowInsert={handleRowInsert}
				onRowDelete={handleRowDelete}
				ref={handleRef}
			/>
		</div>
	);
}
