import { createEffect, createSignal, onMount } from "solid-js";
import {
	Sheet,
	type CellMutation,
	type CellValue,
	type ColumnDef,
	type FormulaEngineConfig,
	type RowReorderMutation,
	type SheetController,
	type SortBehavior,
	type SortState,
} from "peculiar-sheets";
import "peculiar-sheets/styles";

export interface HarnessProps {
	initialData: CellValue[][];
	columns: ColumnDef[];
	formulaEngine?: FormulaEngineConfig;
	readOnly?: boolean;
	showFormulaBar?: boolean;
	showReferenceHeaders?: boolean;
	sortBehavior?: SortBehavior;
	defaultSortState?: SortState | null;
	onSort?: (columnId: string, direction: SortState["direction"] | null) => void;
}

/**
 * Test harness that wraps <Sheet> and exposes state on `window` for e2e assertions.
 *
 * - `window.__SHEET_DATA__`       — current cell data (updated on every mutation)
 * - `window.__MUTATIONS__`        — all mutations since page load
 * - `window.__SHEET_CONTROLLER__` — imperative controller handle
 */
export default function Harness(props: HarnessProps) {
	const [sheetData, setSheetData] = createSignal(structuredClone(props.initialData));
	const [sortState, setSortState] = createSignal<SortState | null>(props.defaultSortState ?? null);

	function syncWindowState() {
		window.__SHEET_DATA__ = sheetData();
		window.__SORT_STATE__ = sortState();
	}

	// ── Expose state on window ────────────────────────────────────────────

	onMount(() => {
		syncWindowState();
		window.__MUTATIONS__ = [];
		window.__ROW_REORDERS__ = [];
		window.__SHEET_CONTROLLER__ = null;
	});

	createEffect(() => {
		syncWindowState();
	});

	// ── Mutation handlers ─────────────────────────────────────────────────

	function applyMutation(mutation: CellMutation) {
		const { row, col } = mutation.address;
		setSheetData((prev) => {
			const next = prev.map((dataRow) => [...dataRow]);
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

	function handleRowInsert(atIndex: number, count: number) {
		setSheetData((prev) => {
			const next = prev.map((row) => [...row]);
			const emptyRows = Array.from({ length: count }, () =>
				new Array(props.columns.length).fill(null),
			);
			next.splice(atIndex, 0, ...emptyRows);
			// Re-read ALL cells from the controller so the host data
			// picks up formula references rewritten by the engine.
			if (window.__SHEET_CONTROLLER__) {
				for (let r = 0; r < next.length; r++) {
					for (let c = 0; c < props.columns.length; c++) {
						next[r]![c] = window.__SHEET_CONTROLLER__.getCellValue(r, c);
					}
				}
			}
			return next;
		});
	}

	function handleRowDelete(atIndex: number, count: number) {
		setSheetData((prev) => {
			const next = prev.map((row) => [...row]);
			next.splice(atIndex, count);
			// Re-read ALL cells from the controller so the host data
			// picks up formula references rewritten by the engine.
			if (window.__SHEET_CONTROLLER__) {
				for (let r = 0; r < next.length; r++) {
					for (let c = 0; c < props.columns.length; c++) {
						next[r]![c] = window.__SHEET_CONTROLLER__.getCellValue(r, c);
					}
				}
			}
			return next;
		});
	}

	function handleRowReorder(mutation: RowReorderMutation) {
		window.__ROW_REORDERS__.push(mutation);
		setSheetData((prev) => {
			const next = new Array(prev.length).fill(null).map(() => [] as CellValue[]);
			for (let oldIndex = 0; oldIndex < mutation.indexOrder.length; oldIndex++) {
				const newIndex = mutation.indexOrder[oldIndex];
				if (newIndex === undefined || newIndex < 0) continue;
				next[newIndex] = [...(prev[oldIndex] ?? [])];
			}
			return next;
		});
	}

	function handleRef(ctrl: SheetController) {
		window.__SHEET_CONTROLLER__ = ctrl;
	}

	// ── Render ────────────────────────────────────────────────────────────

	return (
		<div style={{ width: "100vw", height: "100vh" }} data-testid="harness">
			<Sheet
				data={sheetData()}
				columns={props.columns}
				readOnly={props.readOnly}
				formulaEngine={props.formulaEngine}
				showFormulaBar={props.showFormulaBar}
				showReferenceHeaders={props.showReferenceHeaders}
				onCellEdit={handleCellEdit}
				onBatchEdit={handleBatchEdit}
				onRowInsert={handleRowInsert}
				onRowDelete={handleRowDelete}
				onRowReorder={handleRowReorder}
				onSort={props.onSort}
				onSortChange={setSortState}
				ref={handleRef}
				sortBehavior={props.sortBehavior}
				defaultSortState={props.defaultSortState}
			/>
		</div>
	);
}
