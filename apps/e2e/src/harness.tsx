import { onMount } from "solid-js";
import { Sheet, type CellMutation, type CellValue, type ColumnDef, type FormulaEngineConfig, type SheetController } from "@peculiarnewbie/spreadsheets";
import "@peculiarnewbie/spreadsheets/styles";

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
				ref={handleRef}
			/>
		</div>
	);
}
