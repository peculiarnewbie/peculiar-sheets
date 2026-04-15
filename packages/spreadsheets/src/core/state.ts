import { createEffect, createSignal, on } from "solid-js";
import { createStore, produce } from "solid-js/store";
import type {
	CellMutation,
	CellValue,
	ColumnDef,
	EditModeState,
	RowReorderMutation,
	Selection,
} from "../types";
import { emptySelection, selectCell } from "./selection";
import {
	isFormulaValue,
	shiftFormulaReferencesForRowInsert,
	shiftFormulaReferencesForRowDelete,
} from "../formula/references";
import {
	type HistoryStack,
	type RowOperation,
	type UndoRedoRowChange,
	canRedo as histCanRedo,
	canUndo as histCanUndo,
	createHistory,
	pushMutationHistory,
	pushRowOperationHistory,
	pushRowReorderHistory,
	redo as histRedo,
	undo as histUndo,
} from "./history";

// ── Types ────────────────────────────────────────────────────────────────────

export interface SheetState {
	cells: CellValue[][];
	rowIds: number[];
	rowCount: number;
	colCount: number;
}

export interface UndoRedoResult {
	mutations: CellMutation[];
	rowChange?: UndoRedoRowChange;
	rowReorder?: RowReorderMutation;
}

export interface SheetStore {
	// Reactive state accessors
	cells: CellValue[][];
	rowCount(): number;
	colCount(): number;
	rowIds(): number[];
	selection(): Selection;
	editMode(): EditModeState | null;
	columnWidths(): Map<string, number>;
	history(): HistoryStack;

	// Mutations
	setCell(row: number, col: number, value: CellValue): void;
	setCells(mutations: Array<{ row: number; col: number; value: CellValue }>): void;
	reorderRows(nextRowIds: number[]): void;
	setSelection(selection: Selection): void;
	setEditMode(state: EditModeState | null): void;
	setColumnWidth(columnId: string, width: number): void;
	resizeGrid(rowCount: number, colCount: number): void;
	insertRows(atIndex: number, count: number): void;
	deleteRows(atIndex: number, count: number): CellValue[][];
	getRowIdAtPhysicalRow(row: number): number | null;
	getPhysicalRowForRowId(rowId: number): number | null;

	// Row operation tracking (for reconciler guard)
	hasPendingRowOp(): boolean;
	clearPendingRowOp(): void;

	// History
	pushMutations(mutations: CellMutation[], selectionBefore: Selection, selectionAfter: Selection): void;
	pushRowOperation(rowOp: RowOperation, selectionBefore: Selection, selectionAfter: Selection): void;
	pushRowReorder(
		rowReorder: Omit<RowReorderMutation, "indexOrder" | "source">,
		selectionBefore: Selection,
		selectionAfter: Selection,
	): void;
	undo(): UndoRedoResult | null;
	redo(): UndoRedoResult | null;
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
	const [rowIds, setRowIds] = createSignal<number[]>(
		Array.from({ length: rowCount }, (_, index) => index),
	);
	const [nextRowId, setNextRowId] = createSignal(rowCount);
	const [selection, setSelection] = createSignal<Selection>(
		rowCount > 0 && colCount > 0 ? selectCell({ row: 0, col: 0 }) : emptySelection(),
	);
	const [editMode, setEditMode] = createSignal<EditModeState | null>(null);
	const [colWidths, setColWidths] = createSignal<Map<string, number>>(
		new Map(columns.map((c) => [c.id, c.width ?? 120])),
	);
	const [historyState, setHistory] = createSignal<HistoryStack>(createHistory());
	const [hasPendingRowOp, setHasPendingRowOp] = createSignal(false);

	/** Internal: splice empty rows into the cells array and update dimensions. */
	function _insertRows(atIndex: number, count: number) {
		const currentRowCount = dimensions().rowCount;
		const cc = dimensions().colCount;
		const insertAt = Math.max(0, Math.min(atIndex, currentRowCount));
		const startId = nextRowId();
		const newRowIds = Array.from({ length: count }, (_, index) => startId + index);
		setNextRowId((value) => value + count);

		setDimensions({ rowCount: currentRowCount + count, colCount: cc });
		setCells(
			produce((draft) => {
				const newRows = Array.from({ length: count }, () =>
					new Array(cc).fill(null) as CellValue[],
				);
				draft.splice(insertAt, 0, ...newRows);

				// Rewrite formula references: shift refs at/below insertAt by +count
				for (let r = 0; r < draft.length; r++) {
					const row = draft[r];
					if (!row) continue;
					for (let c = 0; c < row.length; c++) {
						const v = row[c];
						if (typeof v === "string" && isFormulaValue(v)) {
							row[c] = shiftFormulaReferencesForRowInsert(v, insertAt, count);
						}
					}
				}
			}),
		);
		setRowIds((prev) => {
			const next = [...prev];
			next.splice(insertAt, 0, ...newRowIds);
			return next;
		});
		setHasPendingRowOp(true);
	}

	/** Internal: splice rows out of the cells array, update dimensions, return removed data. */
	function _deleteRows(atIndex: number, count: number): CellValue[][] {
		const currentRowCount = dimensions().rowCount;
		const cc = dimensions().colCount;
		const deleteAt = Math.max(0, Math.min(atIndex, currentRowCount));
		const actualCount = Math.min(count, currentRowCount - deleteAt);
		if (actualCount <= 0) return [];

		// Capture the data being removed (deep copy)
		const removedData: CellValue[][] = [];
		for (let r = deleteAt; r < deleteAt + actualCount; r++) {
			const row = cells[r];
			removedData.push(row ? [...row] : new Array(cc).fill(null) as CellValue[]);
		}

		setDimensions({ rowCount: currentRowCount - actualCount, colCount: cc });
		setCells(
			produce((draft) => {
				draft.splice(deleteAt, actualCount);

				// Rewrite formula references: shift refs at/below deleteAt+actualCount by -actualCount
				for (let r = 0; r < draft.length; r++) {
					const row = draft[r];
					if (!row) continue;
					for (let c = 0; c < row.length; c++) {
						const v = row[c];
						if (typeof v === "string" && isFormulaValue(v)) {
							row[c] = shiftFormulaReferencesForRowDelete(v, deleteAt, actualCount);
						}
					}
				}
			}),
		);
		setRowIds((prev) => {
			const next = [...prev];
			next.splice(deleteAt, actualCount);
			return next;
		});
		setHasPendingRowOp(true);

		return removedData;
	}

	/** Internal: insert rows and fill them with given data. */
	function _insertRowsWithData(atIndex: number, data: CellValue[][]) {
		_insertRows(atIndex, data.length);
		// Restore the saved cell data
		setCells(
			produce((draft) => {
				for (let r = 0; r < data.length; r++) {
					const row = data[r]!;
					const targetRow = draft[atIndex + r]!;
					for (let c = 0; c < row.length; c++) {
						targetRow[c] = row[c] ?? null;
					}
				}
			}),
		);
	}

	function _restoreAllCells(snapshot: CellValue[][]) {
		setCells(
			produce((draft) => {
				draft.length = 0;
				for (const row of snapshot) {
					draft.push([...row]);
				}
			}),
		);
	}

	/** Internal: apply a row operation (used during undo/redo). */
	function applyRowOp(rowOp: RowOperation) {
		if (rowOp.type === "insertRows") {
			_insertRows(rowOp.atIndex, rowOp.count);
		} else {
			_deleteRows(rowOp.atIndex, rowOp.count);
		}
	}

	function getPhysicalRowForRowId(rowId: number): number | null {
		const index = rowIds().indexOf(rowId);
		return index >= 0 ? index : null;
	}

	function reorderRows(nextOrder: number[]) {
		const currentRowIds = rowIds();
		if (nextOrder.length !== currentRowIds.length) return;

		const currentIndexByRowId = new Map<number, number>();
		for (let i = 0; i < currentRowIds.length; i++) {
			currentIndexByRowId.set(currentRowIds[i]!, i);
		}

		if (nextOrder.some((rowId) => !currentIndexByRowId.has(rowId))) return;

		const nextCells = nextOrder.map((rowId) => {
			const currentIndex = currentIndexByRowId.get(rowId)!;
			const row = cells[currentIndex];
			return row ? [...row] : new Array(dimensions().colCount).fill(null) as CellValue[];
		});

		setCells(
			produce((draft) => {
				draft.length = 0;
				draft.push(...nextCells);
			}),
		);
		setRowIds([...nextOrder]);
	}

	return {
		get cells() {
			return cells;
		},

		rowCount: () => dimensions().rowCount,
		colCount: () => dimensions().colCount,
		rowIds,

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

		reorderRows,

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
			setRowIds((prev) => {
				if (prev.length === newRowCount) return prev;

				if (prev.length > newRowCount) {
					return prev.slice(0, newRowCount);
				}

				const next = [...prev];
				const additional = newRowCount - prev.length;
				const startId = nextRowId();
				for (let i = 0; i < additional; i++) {
					next.push(startId + i);
				}
				setNextRowId(startId + additional);
				return next;
			});
		},

		insertRows(atIndex: number, count: number) {
			_insertRows(atIndex, count);
		},

		deleteRows(atIndex: number, count: number): CellValue[][] {
			return _deleteRows(atIndex, count);
		},

		getRowIdAtPhysicalRow(row: number): number | null {
			return rowIds()[row] ?? null;
		},

		getPhysicalRowForRowId,

		hasPendingRowOp: () => hasPendingRowOp(),
		clearPendingRowOp: () => setHasPendingRowOp(false),

		pushMutations(mutations: CellMutation[], selectionBefore: Selection, selectionAfter: Selection) {
			setHistory((prev) => pushMutationHistory(prev, mutations, selectionBefore, selectionAfter));
		},

		pushRowOperation(rowOp: RowOperation, selectionBefore: Selection, selectionAfter: Selection) {
			setHistory((prev) => pushRowOperationHistory(prev, rowOp, selectionBefore, selectionAfter));
		},

		pushRowReorder(
			rowReorder: Omit<RowReorderMutation, "indexOrder" | "source">,
			selectionBefore: Selection,
			selectionAfter: Selection,
		) {
			setHistory((prev) => pushRowReorderHistory(prev, rowReorder, selectionBefore, selectionAfter));
		},

		undo(): UndoRedoResult | null {
			const result = histUndo(historyState());
			if (!result) return null;
			setHistory(result.history);
			setSelection(result.selection);

			// Apply structural row change first (if any)
			if (result.rowOp) {
				if (result.rowOp.type === "insertRows") {
					// Undo of deleteRows → re-insert with saved data
					const originalEntry = result.history.redoStack[result.history.redoStack.length - 1];
					const originalRowOp = originalEntry?.type === "row-operation"
						? originalEntry.rowOp
						: undefined;
					if (originalRowOp?.type === "deleteRows" && originalRowOp.removedData.length > 0) {
						_insertRowsWithData(result.rowOp.atIndex, originalRowOp.removedData);
						if (originalRowOp.previousCells) {
							_restoreAllCells(originalRowOp.previousCells);
						}
					} else {
						applyRowOp(result.rowOp);
					}
				} else {
					applyRowOp(result.rowOp);
				}
			}

			// Apply inverse cell mutations
			if (result.mutations.length > 0) {
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
			}

			if (result.rowReorder) {
				reorderRows(result.rowReorder.newOrder);
			}

			return {
				mutations: result.mutations,
				rowChange: result.rowChange,
				rowReorder: result.rowReorder,
			};
		},

		redo(): UndoRedoResult | null {
			const result = histRedo(historyState());
			if (!result) return null;
			setHistory(result.history);
			setSelection(result.selection);

			// Apply structural row change first (if any)
			if (result.rowOp) {
				applyRowOp(result.rowOp);
			}

			// Apply forward cell mutations
			if (result.mutations.length > 0) {
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
			}

			if (result.rowReorder) {
				reorderRows(result.rowReorder.newOrder);
			}

			return {
				mutations: result.mutations,
				rowChange: result.rowChange,
				rowReorder: result.rowReorder,
			};
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
	onExternalChange?: () => void,
): void {
	createEffect(
		on(
			[getData, getColumns],
			([data, columns]) => {
				const newRowCount = data.length;
				const newColCount = columns.length;
				let didChange = false;

				// ── Row-operation guard ──────────────────────────────────
				// If an internal insertRows/deleteRows just ran, the store
				// dimensions may differ from the host data.  Don't let the
				// reconciler destroy those internal changes.
				const pending = store.hasPendingRowOp();
				if (pending) {
					if (newRowCount === store.rowCount() && newColCount === store.colCount()) {
						// Host mirrored the row op (dimensions match).
						// Skip cell reconciliation — host data has stale formula
						// strings while the store has correctly rewritten ones.
						// Do NOT call onExternalChange — HF was already synced
						// from Grid.tsx after the row operation.
						store.clearPendingRowOp();
						return;
					}
					// Host hasn't mirrored yet (dimensions still differ).
					// Skip the entire pass — don't resize, don't overwrite cells.
					return;
				}

				// Resize grid if dimensions changed
				if (newRowCount !== store.rowCount() || newColCount !== store.colCount()) {
					store.resizeGrid(newRowCount, newColCount);
					didChange = true;
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
					didChange = true;
				}

				if (didChange) {
					onExternalChange?.();
				}
			},
		),
	);
}
