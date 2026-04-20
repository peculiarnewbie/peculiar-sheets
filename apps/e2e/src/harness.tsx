import { createEffect, onMount } from "solid-js";
import {
	Sheet,
	type CellValue,
	type ColumnDef,
	type FormulaEngineConfig,
	type SheetController,
	type SheetCustomization,
	type SortBehavior,
	type SortState,
} from "peculiar-sheets";
import "peculiar-sheets/styles";
import { createSignal } from "solid-js";
import { createMutationBuffer } from "sheet-scenarios";

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
	customization?: SheetCustomization;
}

/**
 * Test harness that wraps <Sheet> and exposes state on `window` for e2e assertions.
 *
 * - `window.__SHEET_DATA__`       — current cell data (updated on every mutation)
 * - `window.__MUTATIONS__`        — all mutations since page load
 * - `window.__SHEET_CONTROLLER__` — imperative controller handle
 *
 * Internally wraps the shared `createMutationBuffer` factory. The same buffer
 * powers `ReplayHost` in the showcase — one reconciliation implementation,
 * two mount points.
 */
export default function Harness(props: HarnessProps) {
	let controller: SheetController | null = null;
	const buffer = createMutationBuffer({
		initialData: props.initialData,
		columnCount: props.columns.length,
	});
	const bindings = buffer.bindings(() => controller);

	const [sortState, setSortState] = createSignal<SortState | null>(props.defaultSortState ?? null);

	function syncWindowState() {
		window.__SHEET_DATA__ = buffer.data();
		window.__MUTATIONS__ = buffer.mutations();
		window.__ROW_REORDERS__ = buffer.rowReorders();
		window.__SORT_STATE__ = sortState();
	}

	// ── Expose state on window ────────────────────────────────────────────

	onMount(() => {
		syncWindowState();
		window.__SHEET_CONTROLLER__ = null;
		// setup.ts's `clearMutations` helper calls this to flush the buffer.
		// Without the explicit hook the buffer would keep the pre-clear log,
		// and the next reactive tick would re-sync it back onto the window.
		window.__HARNESS_CLEAR_MUTATIONS__ = () => {
			buffer.clear();
			syncWindowState();
		};
	});

	createEffect(() => {
		syncWindowState();
	});

	function handleRef(ctrl: SheetController) {
		controller = ctrl;
		window.__SHEET_CONTROLLER__ = ctrl;
	}

	// ── Render ────────────────────────────────────────────────────────────

	return (
		<div style={{ width: "100vw", height: "100vh" }} data-testid="harness">
			<Sheet
				data={buffer.data()}
				columns={props.columns}
				readOnly={props.readOnly}
				formulaEngine={props.formulaEngine}
				showFormulaBar={props.showFormulaBar}
				showReferenceHeaders={props.showReferenceHeaders}
				customization={props.customization}
				onCellEdit={bindings.onCellEdit}
				onBatchEdit={bindings.onBatchEdit}
				onRowInsert={bindings.onRowInsert}
				onRowDelete={bindings.onRowDelete}
				onRowReorder={bindings.onRowReorder}
				onSort={props.onSort}
				onSortChange={setSortState}
				ref={handleRef}
				sortBehavior={props.sortBehavior}
				defaultSortState={props.defaultSortState}
			/>
		</div>
	);
}
