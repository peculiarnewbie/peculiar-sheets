import { createEffect, createSignal, on } from "solid-js";
import { createStore, produce } from "solid-js/store";
import type {
	CellMutation,
	CellValue,
	ColumnDef,
	EditModeState,
	Selection,
} from "../types";
import { emptySelection, selectCell } from "./selection";
import {
	type HistoryStack,
	canRedo as histCanRedo,
	canUndo as histCanUndo,
	createHistory,
	pushHistory,
	redo as histRedo,
	undo as histUndo,
} from "./history";

// ── Types ────────────────────────────────────────────────────────────────────

export interface SheetState {
	cells: CellValue[][];
	rowCount: number;
	colCount: number;
}

export interface SheetStore {
	// Reactive state accessors
	cells: CellValue[][];
	rowCount(): number;
	colCount(): number;
	selection(): Selection;
	editMode(): EditModeState | null;
	columnWidths(): Map<string, number>;
	history(): HistoryStack;

	// Mutations
	setCell(row: number, col: number, value: CellValue): void;
	setCells(mutations: Array<{ row: number; col: number; value: CellValue }>): void;
	setSelection(selection: Selection): void;
	setEditMode(state: EditModeState | null): void;
	setColumnWidth(columnId: string, width: number): void;
	resizeGrid(rowCount: number, colCount: number): void;

	// History
	pushMutations(mutations: CellMutation[], selectionBefore: Selection, selectionAfter: Selection): void;
	undo(): CellMutation[] | null;
	redo(): CellMutation[] | null;
	canUndo(): boolean;
	canRedo(): boolean;
}

// ── Factory ──────────────────────────────────────────────────────────────────

export function createSheetStore(
	initialData: CellValue[][],
	columns: ColumnDef[],
): SheetStore {
	const rowCount = initialData.length;
	const colCount = columns.length;

	// Deep copy initial data to avoid shared references
	const initialCells = initialData.map((row) => [...row]);

	const [cells, setCells] = createStore<CellValue[][]>(initialCells);
	const [dimensions, setDimensions] = createSignal({ rowCount, colCount });
	const [selection, setSelection] = createSignal<Selection>(
		rowCount > 0 && colCount > 0 ? selectCell({ row: 0, col: 0 }) : emptySelection(),
	);
	const [editMode, setEditMode] = createSignal<EditModeState | null>(null);
	const [colWidths, setColWidths] = createSignal<Map<string, number>>(
		new Map(columns.map((c) => [c.id, c.width ?? 120])),
	);
	const [historyState, setHistory] = createSignal<HistoryStack>(createHistory());

	return {
		get cells() {
			return cells;
		},

		rowCount: () => dimensions().rowCount,
		colCount: () => dimensions().colCount,

		selection,
		editMode,
		columnWidths: colWidths,
		history: historyState,

		setCell(row: number, col: number, value: CellValue) {
			setCells(
				produce((draft) => {
					// Ensure row exists
					while (draft.length <= row) {
						draft.push(new Array(dimensions().colCount).fill(null) as CellValue[]);
					}
					const draftRow = draft[row]!;
					// Ensure column exists
					while (draftRow.length <= col) {
						draftRow.push(null);
					}
					draftRow[col] = value;
				}),
			);
		},

		setCells(mutations: Array<{ row: number; col: number; value: CellValue }>) {
			setCells(
				produce((draft) => {
					for (const m of mutations) {
						while (draft.length <= m.row) {
							draft.push(new Array(dimensions().colCount).fill(null) as CellValue[]);
						}
						const draftRow = draft[m.row]!;
						while (draftRow.length <= m.col) {
							draftRow.push(null);
						}
						draftRow[m.col] = m.value;
					}
				}),
			);
		},

		setSelection,
		setEditMode,

		setColumnWidth(columnId: string, width: number) {
			setColWidths((prev) => {
				const next = new Map(prev);
				next.set(columnId, width);
				return next;
			});
		},

		resizeGrid(newRowCount: number, newColCount: number) {
			setDimensions({ rowCount: newRowCount, colCount: newColCount });
			setCells(
				produce((draft) => {
					// Add rows if needed
					while (draft.length < newRowCount) {
						draft.push(new Array(newColCount).fill(null) as CellValue[]);
					}
					// Trim excess rows
					if (draft.length > newRowCount) {
						draft.length = newRowCount;
					}
					// Ensure each row has the right number of columns
					for (let i = 0; i < draft.length; i++) {
						const row = draft[i]!;
						while (row.length < newColCount) {
							row.push(null);
						}
					}
				}),
			);
		},

		pushMutations(mutations: CellMutation[], selectionBefore: Selection, selectionAfter: Selection) {
			setHistory((prev) => pushHistory(prev, mutations, selectionBefore, selectionAfter));
		},

		undo(): CellMutation[] | null {
			const result = histUndo(historyState());
			if (!result) return null;
			setHistory(result.history);
			setSelection(result.selection);
			// Apply inverse mutations
			setCells(
				produce((draft) => {
					for (const m of result.mutations) {
						const row = draft[m.address.row];
						if (row) {
							row[m.address.col] = m.newValue;
						}
					}
				}),
			);
			return result.mutations;
		},

		redo(): CellMutation[] | null {
			const result = histRedo(historyState());
			if (!result) return null;
			setHistory(result.history);
			setSelection(result.selection);
			// Apply forward mutations
			setCells(
				produce((draft) => {
					for (const m of result.mutations) {
						const row = draft[m.address.row];
						if (row) {
							row[m.address.col] = m.newValue;
						}
					}
				}),
			);
			return result.mutations;
		},

		canUndo: () => histCanUndo(historyState()),
		canRedo: () => histCanRedo(historyState()),
	};
}

// ── Reconciliation ───────────────────────────────────────────────────────────

/**
 * Sets up a reactive effect that reconciles external data changes into the
 * store. Host data is authoritative — overwrites internal values.
 */
export function createReconciler(
	store: SheetStore,
	getData: () => CellValue[][],
	getColumns: () => ColumnDef[],
): void {
	createEffect(
		on(
			[getData, getColumns],
			([data, columns]) => {
				const newRowCount = data.length;
				const newColCount = columns.length;

				// Resize grid if dimensions changed
				if (newRowCount !== store.rowCount() || newColCount !== store.colCount()) {
					store.resizeGrid(newRowCount, newColCount);
				}

				// Update column widths for new columns
				for (const col of columns) {
					if (!store.columnWidths().has(col.id)) {
						store.setColumnWidth(col.id, col.width ?? 120);
					}
				}

				// Reconcile cell data — host values overwrite internal state
				const mutations: Array<{ row: number; col: number; value: CellValue }> = [];
				for (let r = 0; r < data.length; r++) {
					const dataRow = data[r];
					if (!dataRow) continue;
					for (let c = 0; c < dataRow.length; c++) {
						const externalValue = dataRow[c] ?? null;
						const internalValue = store.cells[r]?.[c] ?? null;
						if (externalValue !== internalValue) {
							mutations.push({ row: r, col: c, value: externalValue });
						}
					}
				}

				if (mutations.length > 0) {
					store.setCells(mutations);
				}
			},
		),
	);
}
