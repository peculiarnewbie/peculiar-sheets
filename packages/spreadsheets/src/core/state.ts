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
	autoRowId,
	columnIdx,
	physicalRow,
	rowId,
	toNumber,
	visualRow,
} from "./brands";
import {
	allocateProvisionalRowIds,
	reconcileByRowIdentity,
	validateRowIds,
} from "./row-identity";
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
	type UndoResult,
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

/**
 * Applied undo/redo that can still be rolled back if formula sync fails.
 * Local state is already mutated; call `rollback()` to restore the pre-command snapshot.
 */
export interface HistoryTransitionTransaction {
	result: UndoRedoResult;
	rollback(): void;
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
	/** Reconcile store to host data; used by reconciler and unit tests. */
	reconcileFromHost(
		data: CellValue[][],
		columns: ColumnDef[],
		hostRowIds?: readonly RowId[],
		context?: { lastHostRowCount: number },
	): { didChange: boolean; lastHostRowCount: number };
	/** True when the host supplies `rowIds` (domain keys); grid inserts use provisional keys until fold. */
	hasHostRowIds(): boolean;
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
	/** Apply undo and return a rollback handle for transactional formula sync. */
	beginUndo(): HistoryTransitionTransaction | null;
	/** Apply redo and return a rollback handle for transactional formula sync. */
	beginRedo(): HistoryTransitionTransaction | null;
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

	if (hostRowIds) {
		validateRowIds(hostRowIds, rowCount);
	}

	// Deep copy initial data to avoid shared references
	const initialCells = initialData.map((row) => [...row]);

	const [cells, setCells] = createStore<CellValue[][]>(initialCells);
	const [dimensions, setDimensions] = createSignal({ rowCount, colCount });

	const initialRowIds: RowId[] = hostRowIds
		? [...hostRowIds]
		: Array.from({ length: rowCount }, (_, index) => autoRowId(index));
	const [rowIds, setRowIds] = createSignal<RowId[]>(initialRowIds);

	const [hostProvidesRowIds] = createSignal(hostRowIds !== undefined);
	const [nextAutoRowId, setNextAutoRowId] = createSignal(rowCount);
	const [nextProvisionalCounter, setNextProvisionalCounter] = createSignal(0);
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

	function allocateNewRowIds(count: number, explicitIds?: RowId[]): RowId[] {
		if (explicitIds) {
			if (explicitIds.length !== count) {
				throw new Error(`allocateNewRowIds: expected ${count} ids, got ${explicitIds.length}`);
			}
			return [...explicitIds];
		}
		if (hostProvidesRowIds()) {
			const start = nextProvisionalCounter();
			setNextProvisionalCounter(start + count);
			return allocateProvisionalRowIds(count, start);
		}
		const startId = nextAutoRowId();
		setNextAutoRowId(startId + count);
		return Array.from({ length: count }, (_, index) => rowId(String(startId + index)));
	}

	/** Internal: splice empty rows into the cells array and update dimensions. */
	function _insertRows(
		atIndex: number,
		count: number,
		explicitIds?: RowId[],
		trackPending = true,
	) {
		const currentRowCount = dimensions().rowCount;
		const cc = dimensions().colCount;
		const insertAt = Math.max(0, Math.min(atIndex, currentRowCount));
		const newRowIds = allocateNewRowIds(count, explicitIds);

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
		if (trackPending) {
			setHasPendingRowOp(true);
		}
		bumpDataRevision();
	}

	/** Internal: splice rows out of the cells array, update dimensions, return removed data. */
	function _deleteRows(atIndex: number, count: number, trackPending = true): CellValue[][] {
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
		if (trackPending) {
			setHasPendingRowOp(true);
		}
		bumpDataRevision();

		return removedData;
	}

	function _insertRowsWithIds(atIndex: number, ids: RowId[], trackPending = true) {
		_insertRows(atIndex, ids.length, ids, trackPending);
	}

	/** Internal: insert rows and fill them with given data. */
	function _insertRowsWithData(atIndex: number, data: CellValue[][]) {
		_insertRows(atIndex, data.length);
		// Restore the saved cell data
		setCells(
			produce((draft) => {
				for (let r = 0; r < data.length; r++) {
					const row = data[r];
				if (!row) throw new Error(`Invalid data row at index ${r}`);
					const targetRow = draft[atIndex + r];
				if (!targetRow) throw new Error(`Invalid draft target at index ${atIndex + r}`);
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
			const currentIndex = currentIndexByRowId.get(id);
			// Validate currentIndex exists (should never happen due to earlier check)
			if (currentIndex === undefined) {
				throw new Error(`Invalid row mapping for rowId: ${id}`);
			}
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

	interface HistorySnapshot {
		cells: CellValue[][];
		rowIds: RowId[];
		dimensions: { rowCount: number; colCount: number };
		selection: Selection;
		colWidths: Map<string, number>;
		rowHeights: Map<RowId, number>;
		history: HistoryStack;
		hasPendingRowOp: boolean;
		nextAutoRowId: number;
		nextProvisionalCounter: number;
	}

	function captureHistorySnapshot(): HistorySnapshot {
		const history = historyState();
		return {
			cells: cells.map((row) => [...row]),
			rowIds: [...rowIds()],
			dimensions: { ...dimensions() },
			selection: selection(),
			colWidths: new Map(colWidths()),
			rowHeights: new Map(rowHeights()),
			history: {
				undoStack: [...history.undoStack],
				redoStack: [...history.redoStack],
			},
			hasPendingRowOp: hasPendingRowOp(),
			nextAutoRowId: nextAutoRowId(),
			nextProvisionalCounter: nextProvisionalCounter(),
		};
	}

	function restoreHistorySnapshot(snapshot: HistorySnapshot): void {
		setDimensions({ ...snapshot.dimensions });
		setCells(
			produce((draft) => {
				draft.length = 0;
				for (const row of snapshot.cells) {
					draft.push([...row]);
				}
			}),
		);
		setRowIds([...snapshot.rowIds]);
		setSelection(snapshot.selection);
		setColWidths(new Map(snapshot.colWidths));
		setRowHeights(new Map(snapshot.rowHeights));
		setHistory({
			undoStack: [...snapshot.history.undoStack],
			redoStack: [...snapshot.history.redoStack],
		});
		setHasPendingRowOp(snapshot.hasPendingRowOp);
		setNextAutoRowId(snapshot.nextAutoRowId);
		setNextProvisionalCounter(snapshot.nextProvisionalCounter);
		bumpDataRevision();
	}

	function toUndoRedoResult(planned: UndoResult): UndoRedoResult {
		return {
			mutations: planned.mutations,
			...(planned.rowChange !== undefined ? { rowChange: planned.rowChange } : {}),
			...(planned.rowReorder ? { rowReorder: planned.rowReorder } : {}),
			...(planned.columnResize ? { columnResize: planned.columnResize } : {}),
			...(planned.rowResize ? { rowResize: planned.rowResize } : {}),
		};
	}

	function applyHistoryPlan(planned: UndoResult, direction: "undo" | "redo"): UndoRedoResult {
		setHistory(planned.history);
		setSelection(planned.selection);

		if (planned.rowOp) {
			if (direction === "undo" && planned.rowOp.type === "insertRows") {
				// Undo of deleteRows → re-insert with saved data
				const originalEntry = planned.history.redoStack[planned.history.redoStack.length - 1];
				const originalRowOp =
					originalEntry?.type === "row-operation" ? originalEntry.rowOp : undefined;
				if (originalRowOp?.type === "deleteRows" && originalRowOp.removedData.length > 0) {
					_insertRowsWithData(planned.rowOp.atIndex, originalRowOp.removedData);
					if (originalRowOp.previousCells) {
						_restoreAllCells(originalRowOp.previousCells);
					}
				} else {
					applyRowOp(planned.rowOp);
				}
			} else {
				applyRowOp(planned.rowOp);
			}
		}

		if (planned.mutations.length > 0) {
			setCells(
				produce((draft) => {
					for (const m of planned.mutations) {
						const row = draft[m.address.row];
						if (row) {
							row[m.address.col] = m.newValue;
						}
					}
				}),
			);
			bumpDataRevision();
		}

		if (planned.rowReorder) {
			reorderRows(planned.rowReorder.newOrder);
		}

		if (planned.columnResize) {
			const columnResize = planned.columnResize;
			setColWidths((prev) => {
				const next = new Map(prev);
				next.set(columnResize.columnId, columnResize.width);
				return next;
			});
		}

		if (planned.rowResize) {
			const rowResize = planned.rowResize;
			setRowHeights((prev) => {
				const next = new Map(prev);
				next.set(rowResize.rowId, rowResize.height);
				return next;
			});
		}

		return toUndoRedoResult(planned);
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
					// Guard: draft[row] should exist (guaranteed by while loop above)
					const draftRow = draft[row];
					if (!draftRow) {
						throw new Error(`Invalid draft state at row ${row}`);
					}
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
						const draftRow = draft[m.row];
						// Guard: draft[m.row] should exist (guaranteed by while loop above)
						if (!draftRow) {
							throw new Error(`Invalid draft state at row ${m.row}`);
						}
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
						const row = draft[i];
						if (!row) throw new Error(`Invalid draft row at index ${i}`);
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
				next.push(...allocateNewRowIds(additional));
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
			bumpDataRevision();
		},

		hasHostRowIds: () => hostProvidesRowIds(),

		reconcileFromHost(
			data: CellValue[][],
			columns: ColumnDef[],
			hostRowIds?: readonly RowId[],
			context?: { lastHostRowCount: number },
		) {
			const newRowCount = data.length;
			const newColCount = columns.length;
			let lastHostRowCount = context?.lastHostRowCount ?? newRowCount;
			let didChange = false;

			if (hostRowIds) {
				validateRowIds(hostRowIds, newRowCount);
			}

			const useIdentity = hostRowIds !== undefined;

			// ── Row-operation guard ──────────────────────────────────
			const pending = hasPendingRowOp();
			if (pending) {
				const storeRowCount = dimensions().rowCount;
				const storeColCount = dimensions().colCount;
				if (useIdentity) {
					const hostShrunk = newRowCount < lastHostRowCount;
					if (hostShrunk) {
						setHasPendingRowOp(false);
					} else if (newRowCount < storeRowCount) {
						// Host has not mirrored a grid-initiated insert yet.
						lastHostRowCount = newRowCount;
						return { didChange: false, lastHostRowCount };
					} else if (newRowCount === storeRowCount && newColCount === storeColCount) {
						const storeIds = rowIds();
						const idsMatch =
							hostRowIds !== undefined &&
							hostRowIds.every((id, index) => id === storeIds[index]);
						setHasPendingRowOp(false);
						if (idsMatch) {
							lastHostRowCount = newRowCount;
							return { didChange: false, lastHostRowCount };
						}
					} else if (newRowCount > storeRowCount) {
						lastHostRowCount = newRowCount;
						return { didChange: false, lastHostRowCount };
					}
				} else if (newRowCount === storeRowCount && newColCount === storeColCount) {
					setHasPendingRowOp(false);
					lastHostRowCount = newRowCount;
					return { didChange: false, lastHostRowCount };
				} else if (newRowCount < lastHostRowCount) {
					setHasPendingRowOp(false);
				} else {
					lastHostRowCount = newRowCount;
					return { didChange: false, lastHostRowCount };
				}
			}

			if (useIdentity) {
				const identityTarget = {
					rowIds,
					rowCount: () => dimensions().rowCount,
					colCount: () => dimensions().colCount,
					cells,
					getPhysicalRowForRowId,
					deleteRowsAt: (atIndex: number, count: number) => {
						_deleteRows(atIndex, count, false);
					},
					insertRowsWithIds: (atIndex: number, ids: RowId[]) => {
						_insertRowsWithIds(atIndex, ids, false);
					},
					reorderRows,
					setCells(mutations: Array<{ row: PhysicalRowIndex; col: number; value: CellValue }>) {
						if (mutations.length === 0) return;
						setCells(
							produce((draft) => {
								for (const m of mutations) {
									while (draft.length <= m.row) {
										draft.push(new Array(dimensions().colCount).fill(null) as CellValue[]);
									}
									const draftRow = draft[m.row];
									if (!draftRow) {
										throw new Error(`Invalid draft state at row ${m.row}`);
									}
									while (draftRow.length <= m.col) {
										draftRow.push(null);
									}
									draftRow[m.col] = m.value;
								}
							}),
						);
						bumpDataRevision();
					},
					resizeColumns(colCount: number) {
						setDimensions({ rowCount: dimensions().rowCount, colCount });
						setCells(
							produce((draft) => {
								for (let i = 0; i < draft.length; i++) {
									const row = draft[i];
									if (!row) throw new Error(`Invalid draft row at index ${i}`);
									while (row.length < colCount) {
										row.push(null);
									}
								}
							}),
						);
						bumpDataRevision();
					},
				};

				if (reconcileByRowIdentity(identityTarget, data, hostRowIds, newColCount)) {
					didChange = true;
				}

				for (const col of columns) {
					if (!colWidths().has(col.id)) {
						setColWidths((prev) => {
							const next = new Map(prev);
							next.set(col.id, col.width ?? 120);
							return next;
						});
					}
				}

				lastHostRowCount = newRowCount;
				return { didChange, lastHostRowCount };
			}

			// ── Index-based reconciliation (numeric row IDs) ───────────
			if (newRowCount !== dimensions().rowCount || newColCount !== dimensions().colCount) {
				setDimensions({ rowCount: newRowCount, colCount: newColCount });
				setCells(
					produce((draft) => {
						while (draft.length < newRowCount) {
							draft.push(new Array(newColCount).fill(null) as CellValue[]);
						}
						if (draft.length > newRowCount) {
							draft.length = newRowCount;
						}
						for (let i = 0; i < draft.length; i++) {
							const row = draft[i];
							if (!row) throw new Error(`Invalid draft row at index ${i}`);
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
					next.push(...allocateNewRowIds(newRowCount - prev.length));
					return next;
				});
				didChange = true;
			}

			for (const col of columns) {
				if (!colWidths().has(col.id)) {
					setColWidths((prev) => {
						const next = new Map(prev);
						next.set(col.id, col.width ?? 120);
						return next;
					});
				}
			}

			const mutations: Array<{ row: PhysicalRowIndex; col: number; value: CellValue }> = [];
			for (let r = 0; r < data.length; r++) {
				const dataRow = data[r];
				if (!dataRow) continue;
				const colEnd = Math.max(dataRow.length, newColCount);
				for (let c = 0; c < colEnd; c++) {
					const externalValue = (c < dataRow.length ? dataRow[c] : null) ?? null;
					const internalValue = cells[r]?.[c] ?? null;
					if (externalValue !== internalValue) {
						mutations.push({ row: physicalRow(r), col: c, value: externalValue });
					}
				}
			}

			if (mutations.length > 0) {
				setCells(
					produce((draft) => {
						for (const m of mutations) {
							while (draft.length <= m.row) {
								draft.push(new Array(newColCount).fill(null) as CellValue[]);
							}
							const draftRow = draft[m.row];
							if (!draftRow) {
								throw new Error(`Invalid draft state at row ${m.row}`);
							}
							while (draftRow.length <= m.col) {
								draftRow.push(null);
							}
							draftRow[m.col] = m.value;
						}
					}),
				);
				bumpDataRevision();
				didChange = true;
			}

			lastHostRowCount = newRowCount;
			return { didChange, lastHostRowCount };
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
			const planned = histUndo(historyState());
			if (!planned) return null;
			return applyHistoryPlan(planned, "undo");
		},

		redo(): UndoRedoResult | null {
			const planned = histRedo(historyState());
			if (!planned) return null;
			return applyHistoryPlan(planned, "redo");
		},

		beginUndo(): HistoryTransitionTransaction | null {
			const planned = histUndo(historyState());
			if (!planned) return null;
			const snapshot = captureHistorySnapshot();
			const result = applyHistoryPlan(planned, "undo");
			return {
				result,
				rollback: () => restoreHistorySnapshot(snapshot),
			};
		},

		beginRedo(): HistoryTransitionTransaction | null {
			const planned = histRedo(historyState());
			if (!planned) return null;
			const snapshot = captureHistorySnapshot();
			const result = applyHistoryPlan(planned, "redo");
			return {
				result,
				rollback: () => restoreHistorySnapshot(snapshot),
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
	let lastHostRowCount = getData().length;

	createEffect(
		on(
			[getData, getColumns, getRowIds ?? (() => undefined)],
			([data, columns, hostRowIds]) => {
				const result = store.reconcileFromHost(data, columns, hostRowIds, {
					lastHostRowCount,
				});
				lastHostRowCount = result.lastHostRowCount;

				if (result.didChange) {
					onExternalChange?.();
				}
			},
		),
	);
}
