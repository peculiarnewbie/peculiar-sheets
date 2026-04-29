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
import {
	type PhysicalRowIndex,
	type RowId,
	columnIdx,
	physicalRow,
	rowId,
	toNumber,
	visualRow,
} from "./brands";
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
	pushColumnResizeHistory,
	pushMutationHistory,
	pushRowOperationHistory,
	pushRowReorderHistory,
	pushRowResizeHistory,
	redo as histRedo,
	undo as histUndo,
} from "./history";

// ── Types ────────────────────────────────────────────────────────────────────

export interface SheetState {
	cells: CellValue[][];
	rowIds: RowId[];
	rowCount: number;
	colCount: number;
}

export interface UndoRedoResult {
	mutations: CellMutation[];
	rowChange?: UndoRedoRowChange;
	rowReorder?: RowReorderMutation;
	columnResize?: { columnId: string; width: number };
	rowResize?: { rowId: RowId; height: number };
}

export interface SheetStore {
	// Reactive state accessors
	cells: CellValue[][];
	rowCount(): number;
	colCount(): number;
	rowIds(): RowId[];
	dataRevision(): number;
	selection(): Selection;
	editMode(): EditModeState | null;
	columnWidths(): Map<string, number>;
	rowHeights(): Map<RowId, number>;
	history(): HistoryStack;

	// Mutations
	setCell(row: PhysicalRowIndex, col: number, value: CellValue): void;
	setCells(mutations: Array<{ row: PhysicalRowIndex; col: number; value: CellValue }>): void;
	reorderRows(nextRowIds: RowId[]): void;
	setSelection(selection: Selection): void;
	setEditMode(state: EditModeState | null): void;
	setColumnWidth(columnId: string, width: number): void;
	setRowHeight(rowId: RowId, height: number): void;
	resizeGrid(rowCount: number, colCount: number): void;
	restoreSnapshot(cells: CellValue[][], rowIds: RowId[]): void;
	/** Adopt host-provided row IDs without touching cell data. */
	adoptRowIds(ids: RowId[]): void;
	insertRows(atIndex: PhysicalRowIndex, count: number): void;
	deleteRows(atIndex: PhysicalRowIndex, count: number): CellValue[][];
	getRowIdAtPhysicalRow(row: PhysicalRowIndex): RowId | null;
	getPhysicalRowForRowId(rowId: RowId): PhysicalRowIndex | null;

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
	pushColumnResize(
		columnResize: { columnId: string; oldWidth: number; newWidth: number },
		selectionBefore: Selection,
		selectionAfter: Selection,
	): void;
	pushRowResize(
		rowResize: { rowId: RowId; oldHeight: number; newHeight: number },
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
	hostRowIds?: readonly RowId[],
): SheetStore {
	const rowCount = initialData.length;
	const colCount = columns.length;

	// Validate host-provided row IDs
	if (hostRowIds) {
		if (hostRowIds.length !== rowCount) {
			throw new Error(
				`rowIds length (${hostRowIds.length}) must match data length (${rowCount})`,
			);
		}
		const seen = new Set<number>();
		for (const id of hostRowIds) {
			const n = toNumber(id);
			if (seen.has(n)) {
				throw new Error(`Duplicate rowId found: ${String(id)}`);
			}
			seen.add(n);
		}
	}

	// Deep copy initial data to avoid shared references
	const initialCells = initialData.map((row) => [...row]);

	const [cells, setCells] = createStore<CellValue[][]>(initialCells);
	const [dimensions, setDimensions] = createSignal({ rowCount, colCount });

	// Use host-provided rowIds or auto-generate
	const initialRowIds: RowId[] = hostRowIds
		? [...hostRowIds]
		: Array.from({ length: rowCount }, (_, index) => rowId(index));
	const [rowIds, setRowIds] = createSignal<RowId[]>(initialRowIds);

	// nextRowId starts at the max of all known IDs (host-provided or auto-generated)
	const maxExistingId = initialRowIds.length > 0
		? Math.max(...initialRowIds.map(toNumber))
		: -1;
	const [nextRowId, setNextRowId] = createSignal(maxExistingId + 1);
	const [selection, setSelection] = createSignal<Selection>(
		rowCount > 0 && colCount > 0 ? selectCell({ row: visualRow(0), col: columnIdx(0) }) : emptySelection(),
	);
	const [editMode, setEditMode] = createSignal<EditModeState | null>(null);
	const [colWidths, setColWidths] = createSignal<Map<string, number>>(
		new Map(columns.map((c) => [c.id, c.width ?? 120])),
	);
	const [rowHeights, setRowHeights] = createSignal<Map<RowId, number>>(new Map());
	const [historyState, setHistory] = createSignal<HistoryStack>(createHistory());
	const [hasPendingRowOp, setHasPendingRowOp] = createSignal(false);
	const [dataRevision, setDataRevision] = createSignal(0);

	function bumpDataRevision() {
		setDataRevision((value) => value + 1);
	}

	/** Internal: splice empty rows into the cells array and update dimensions. */
	function _insertRows(atIndex: number, count: number) {
		const currentRowCount = dimensions().rowCount;
		const cc = dimensions().colCount;
		const insertAt = Math.max(0, Math.min(atIndex, currentRowCount));
		const startId = nextRowId();
		const newRowIds = Array.from({ length: count }, (_, index) => rowId(startId + index));
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
		bumpDataRevision();
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
		bumpDataRevision();

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
		bumpDataRevision();
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
		bumpDataRevision();
	}

	/** Internal: apply a row operation (used during undo/redo). */
	function applyRowOp(rowOp: RowOperation) {
		if (rowOp.type === "insertRows") {
			_insertRows(rowOp.atIndex, rowOp.count);
		} else {
			_deleteRows(rowOp.atIndex, rowOp.count);
		}
	}

	function getPhysicalRowForRowId(id: RowId): PhysicalRowIndex | null {
		const index = rowIds().indexOf(id);
		return index >= 0 ? physicalRow(index) : null;
	}

	function reorderRows(nextOrder: RowId[]) {
		const currentRowIds = rowIds();
		if (nextOrder.length !== currentRowIds.length) return;

		const currentIndexByRowId = new Map<RowId, PhysicalRowIndex>();
		for (const [i, id] of currentRowIds.entries()) {
			currentIndexByRowId.set(id, physicalRow(i));
		}

		if (nextOrder.some((id) => !currentIndexByRowId.has(id))) return;

		const nextCells = nextOrder.map((id) => {
			const currentIndex = currentIndexByRowId.get(id)!;
			const row = cells[toNumber(currentIndex)];
			return row ? [...row] : new Array(dimensions().colCount).fill(null) as CellValue[];
		});

		setCells(
			produce((draft) => {
				draft.length = 0;
				draft.push(...nextCells);
			}),
		);
		setRowIds([...nextOrder]);
		bumpDataRevision();
	}

	return {
		get cells() {
			return cells;
		},

		rowCount: () => dimensions().rowCount,
		colCount: () => dimensions().colCount,
		rowIds,
		dataRevision,

		selection,
		editMode,
		columnWidths: colWidths,
		rowHeights,
		history: historyState,

		setCell(row: PhysicalRowIndex, col: number, value: CellValue) {
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
			bumpDataRevision();
		},

		setCells(mutations: Array<{ row: PhysicalRowIndex; col: number; value: CellValue }>) {
			if (mutations.length === 0) return;
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
			bumpDataRevision();
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

		setRowHeight(id: RowId, height: number) {
			setRowHeights((prev) => {
				const next = new Map(prev);
				next.set(id, height);
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
					next.push(rowId(startId + i));
				}
				setNextRowId(startId + additional);
				return next;
			});
			bumpDataRevision();
		},

		restoreSnapshot(nextCells: CellValue[][], nextRowIds: RowId[]) {
			setDimensions({ rowCount: nextCells.length, colCount: dimensions().colCount });
			setCells(
				produce((draft) => {
					draft.length = 0;
					for (const row of nextCells) {
						draft.push([...row]);
					}
				}),
			);
			setRowIds([...nextRowIds]);
			setHasPendingRowOp(false);
			bumpDataRevision();
		},

		adoptRowIds(ids: RowId[]) {
			if (ids.length !== dimensions().rowCount) {
				throw new Error(
					`adoptRowIds: length (${ids.length}) must match rowCount (${dimensions().rowCount})`,
				);
			}
			setRowIds([...ids]);
			// Update nextRowId to be past the max known ID
			const maxId = ids.length > 0 ? Math.max(...ids.map(toNumber)) : -1;
			setNextRowId(Math.max(nextRowId(), maxId + 1));
			bumpDataRevision();
		},

		insertRows(atIndex: PhysicalRowIndex, count: number) {
			_insertRows(toNumber(atIndex), count);
		},

		deleteRows(atIndex: PhysicalRowIndex, count: number): CellValue[][] {
			return _deleteRows(toNumber(atIndex), count);
		},

		getRowIdAtPhysicalRow(row: PhysicalRowIndex): RowId | null {
			return rowIds()[toNumber(row)] ?? null;
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

		pushColumnResize(
			columnResize: { columnId: string; oldWidth: number; newWidth: number },
			selectionBefore: Selection,
			selectionAfter: Selection,
		) {
			setHistory((prev) => pushColumnResizeHistory(prev, columnResize, selectionBefore, selectionAfter));
		},

		pushRowResize(
			rowResize: { rowId: RowId; oldHeight: number; newHeight: number },
			selectionBefore: Selection,
			selectionAfter: Selection,
		) {
			setHistory((prev) => pushRowResizeHistory(prev, rowResize, selectionBefore, selectionAfter));
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
				bumpDataRevision();
			}

			if (result.rowReorder) {
				reorderRows(result.rowReorder.newOrder);
			}

			if (result.columnResize) {
				setColWidths((prev) => {
					const next = new Map(prev);
					next.set(result.columnResize!.columnId, result.columnResize!.width);
					return next;
				});
			}

			if (result.rowResize) {
				setRowHeights((prev) => {
					const next = new Map(prev);
					next.set(result.rowResize!.rowId, result.rowResize!.height);
					return next;
				});
			}

			return {
				mutations: result.mutations,
				...(result.rowChange !== undefined ? { rowChange: result.rowChange } : {}),
				...(result.rowReorder ? { rowReorder: result.rowReorder } : {}),
				...(result.columnResize ? { columnResize: result.columnResize } : {}),
				...(result.rowResize ? { rowResize: result.rowResize } : {}),
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
				bumpDataRevision();
			}

			if (result.rowReorder) {
				reorderRows(result.rowReorder.newOrder);
			}

			if (result.columnResize) {
				setColWidths((prev) => {
					const next = new Map(prev);
					next.set(result.columnResize!.columnId, result.columnResize!.width);
					return next;
				});
			}

			if (result.rowResize) {
				setRowHeights((prev) => {
					const next = new Map(prev);
					next.set(result.rowResize!.rowId, result.rowResize!.height);
					return next;
				});
			}

			return {
				mutations: result.mutations,
				...(result.rowChange !== undefined ? { rowChange: result.rowChange } : {}),
				...(result.rowReorder ? { rowReorder: result.rowReorder } : {}),
				...(result.columnResize ? { columnResize: result.columnResize } : {}),
				...(result.rowResize ? { rowResize: result.rowResize } : {}),
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
	getRowIds?: () => readonly RowId[] | undefined,
	onExternalChange?: () => void,
): void {
	createEffect(
		on(
			[getData, getColumns, getRowIds ?? (() => undefined)],
			([data, columns, hostRowIds]) => {
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
				const mutations: Array<{ row: PhysicalRowIndex; col: number; value: CellValue }> = [];
				for (let r = 0; r < data.length; r++) {
					const dataRow = data[r];
					if (!dataRow) continue;
					// Iterate over ALL columns so short/empty external rows
					// (e.g. [] from HyperFormula's addRows) correctly null-out
					// stale internal values.
					const colEnd = Math.max(dataRow.length, newColCount);
					for (let c = 0; c < colEnd; c++) {
						const externalValue = (c < dataRow.length ? dataRow[c] : null) ?? null;
						const internalValue = store.cells[r]?.[c] ?? null;
						if (externalValue !== internalValue) {
							mutations.push({ row: physicalRow(r), col: c, value: externalValue });
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

				// ── Row ID synchronisation ────────────────────────────
				// When the host provides rowIds, adopt them if they differ
				// from the store's current identity mapping.
				if (hostRowIds) {
					const currentRowIds = store.rowIds();
					if (
						hostRowIds.length !== currentRowIds.length ||
						hostRowIds.some((id, i) => id !== currentRowIds[i])
					) {
						store.adoptRowIds([...hostRowIds]);
					}
				}
			},
		),
	);
}
