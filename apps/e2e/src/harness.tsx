import { createEffect, createSignal, onMount } from "solid-js";
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
	const [data, setData] = createSignal<CellValue[][]>(
		structuredClone(props.initialData),
	);

	let controller: SheetController | null = null;

	// ── Expose state on window ────────────────────────────────────────────

	onMount(() => {
		window.__MUTATIONS__ = [];
		window.__SHEET_CONTROLLER__ = null;
	});

	createEffect(() => {
		window.__SHEET_DATA__ = data();
	});

	// ── Mutation handlers ─────────────────────────────────────────────────

	function applyMutation(mutation: CellMutation) {
		setData((prev) => {
			const next = prev.map((row) => [...row]);
			const { row, col } = mutation.address;
			// Grow rows/cols if needed
			while (next.length <= row) next.push([]);
			while (next[row]!.length <= col) next[row]!.push(null);
			next[row]![col] = mutation.newValue;
			return next;
		});
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
		controller = ctrl;
		window.__SHEET_CONTROLLER__ = ctrl;
	}

	// ── Render ────────────────────────────────────────────────────────────

	return (
		<div style={{ width: "100vw", height: "100vh" }} data-testid="harness">
			<Sheet
				data={data()}
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
