import type { CellMutation, CellValue, RowReorderMutation, Selection } from "../types";
import { type RowId } from "./brands";
import { buildIndexOrder } from "./indexOrder";

// ── Row Operation Types ─────────────────────────────────────────────────────

export type RowOperation =
	| { type: "insertRows"; atIndex: number; count: number }
	| {
			type: "deleteRows";
			atIndex: number;
			count: number;
			removedData: CellValue[][];
			previousCells?: CellValue[][];
	  };

interface StoredRowReorder {
	columnId: string;
	direction: RowReorderMutation["direction"];
	oldOrder: RowId[];
	newOrder: RowId[];
}

interface StoredColumnResize {
	columnId: string;
	oldWidth: number;
	newWidth: number;
}

interface StoredRowResize {
	rowId: RowId;
	oldHeight: number;
	newHeight: number;
}

// ── Types ────────────────────────────────────────────────────────────────────

export type HistoryEntry =
	| {
			type: "cell-mutations";
			forward: CellMutation[];
			selectionBefore: Selection;
			selectionAfter: Selection;
	  }
	| {
			type: "row-operation";
			rowOp: RowOperation;
			selectionBefore: Selection;
			selectionAfter: Selection;
	  }
	| {
			type: "row-reorder";
			rowReorder: StoredRowReorder;
			selectionBefore: Selection;
			selectionAfter: Selection;
	  }
	| {
			type: "column-resize";
			columnResize: StoredColumnResize;
			selectionBefore: Selection;
			selectionAfter: Selection;
	  }
	| {
			type: "row-resize";
			rowResize: StoredRowResize;
			selectionBefore: Selection;
			selectionAfter: Selection;
	  };

export interface HistoryStack {
	undoStack: HistoryEntry[];
	redoStack: HistoryEntry[];
}

// ── Constants ────────────────────────────────────────────────────────────────

const MAX_HISTORY = 200;

// ── Factory ──────────────────────────────────────────────────────────────────

export function createHistory(): HistoryStack {
	return { undoStack: [], redoStack: [] };
}

// ── Push ─────────────────────────────────────────────────────────────────────

function pushEntry(history: HistoryStack, entry: HistoryEntry): HistoryStack {
	const undoStack = history.undoStack.slice(
		Math.max(0, history.undoStack.length - MAX_HISTORY + 1),
	);
	undoStack.push(entry);
	return { undoStack, redoStack: [] };
}

function invertCellMutation(m: CellMutation): CellMutation {
	// Grid edits normally carry both identities. Construct that shape directly
	// instead of allocating temporary objects for optional-property spreads.
	if (m.viewAddress && m.rowId !== undefined) {
		return {
			address: m.address,
			viewAddress: m.viewAddress,
			rowId: m.rowId,
			columnId: m.columnId,
			oldValue: m.newValue,
			newValue: m.oldValue,
			source: m.source,
		};
	}
	return {
		address: m.address,
		...(m.viewAddress ? { viewAddress: m.viewAddress } : {}),
		...(m.rowId !== undefined ? { rowId: m.rowId } : {}),
		columnId: m.columnId,
		oldValue: m.newValue,
		newValue: m.oldValue,
		source: m.source,
	};
}

function mutationHistoryEntry(
	forward: CellMutation[],
	selectionBefore: Selection,
	selectionAfter: Selection,
): HistoryEntry {
	return {
		type: "cell-mutations",
		forward,
		selectionBefore,
		selectionAfter,
	};
}

export function pushMutationHistory(
	history: HistoryStack,
	forward: CellMutation[],
	selectionBefore: Selection,
	selectionAfter: Selection,
): HistoryStack {
	if (forward.length === 0) return history;
	return pushEntry(history, mutationHistoryEntry(forward, selectionBefore, selectionAfter));
}

/** Append only to store-owned stacks; readers receive separate snapshots. */
export function appendMutationHistory(
	history: HistoryStack,
	forward: CellMutation[],
	selectionBefore: Selection,
	selectionAfter: Selection,
): void {
	if (forward.length === 0) return;
	history.undoStack.push(mutationHistoryEntry(forward, selectionBefore, selectionAfter));
	while (history.undoStack.length > MAX_HISTORY) history.undoStack.shift();
	history.redoStack.length = 0;
}

export function pushRowOperationHistory(
	history: HistoryStack,
	rowOp: RowOperation,
	selectionBefore: Selection,
	selectionAfter: Selection,
): HistoryStack {
	return pushEntry(history, {
		type: "row-operation",
		rowOp,
		selectionBefore,
		selectionAfter,
	});
}

export function pushRowReorderHistory(
	history: HistoryStack,
	rowReorder: Omit<RowReorderMutation, "indexOrder" | "source">,
	selectionBefore: Selection,
	selectionAfter: Selection,
): HistoryStack {
	return pushEntry(history, {
		type: "row-reorder",
		rowReorder: {
			columnId: rowReorder.columnId,
			direction: rowReorder.direction,
			oldOrder: [...rowReorder.oldOrder],
			newOrder: [...rowReorder.newOrder],
		},
		selectionBefore,
		selectionAfter,
	});
}

export function pushColumnResizeHistory(
	history: HistoryStack,
	columnResize: StoredColumnResize,
	selectionBefore: Selection,
	selectionAfter: Selection,
): HistoryStack {
	if (columnResize.oldWidth === columnResize.newWidth) return history;

	return pushEntry(history, {
		type: "column-resize",
		columnResize: { ...columnResize },
		selectionBefore,
		selectionAfter,
	});
}

export function pushRowResizeHistory(
	history: HistoryStack,
	rowResize: StoredRowResize,
	selectionBefore: Selection,
	selectionAfter: Selection,
): HistoryStack {
	if (rowResize.oldHeight === rowResize.newHeight) return history;

	return pushEntry(history, {
		type: "row-resize",
		rowResize: { ...rowResize },
		selectionBefore,
		selectionAfter,
	});
}

// ── Undo / Redo ──────────────────────────────────────────────────────────────

/** Info about what structural row change was performed during undo/redo. */
export interface UndoRedoRowChange {
	type: "insertRows" | "deleteRows";
	atIndex: number;
	count: number;
}

export interface UndoResult {
	history: HistoryStack;
	mutations: CellMutation[];
	selection: Selection;
	rowOp?: RowOperation;
	rowChange?: UndoRedoRowChange;
	rowReorder?: RowReorderMutation;
	columnResize?: { columnId: string; width: number };
	rowResize?: { rowId: RowId; height: number };
}

function materializeRowReorder(
	rowReorder: StoredRowReorder,
	source: RowReorderMutation["source"],
): RowReorderMutation {
	return {
		columnId: rowReorder.columnId,
		direction: rowReorder.direction,
		oldOrder: [...rowReorder.oldOrder],
		newOrder: [...rowReorder.newOrder],
		indexOrder: buildIndexOrder(rowReorder.oldOrder, rowReorder.newOrder),
		source,
	};
}

export function undo(history: HistoryStack): UndoResult | null {
	if (history.undoStack.length === 0) return null;

	const entry = history.undoStack[history.undoStack.length - 1]!;

	const nextHistory: HistoryStack = {
		undoStack: history.undoStack.slice(0, -1),
		redoStack: [...history.redoStack, entry],
	};

	switch (entry.type) {
		case "cell-mutations":
			return {
				history: nextHistory,
				mutations: entry.forward.map(invertCellMutation),
				selection: entry.selectionBefore,
			};

		case "row-operation": {
			let inverseRowOp: RowOperation | undefined;
			let rowChange: UndoRedoRowChange | undefined;
			if (entry.rowOp.type === "insertRows") {
				inverseRowOp = {
					type: "deleteRows",
					atIndex: entry.rowOp.atIndex,
					count: entry.rowOp.count,
					removedData: [],
				};
				rowChange = {
					type: "deleteRows",
					atIndex: entry.rowOp.atIndex,
					count: entry.rowOp.count,
				};
			} else {
				inverseRowOp = {
					type: "insertRows",
					atIndex: entry.rowOp.atIndex,
					count: entry.rowOp.count,
				};
				rowChange = {
					type: "insertRows",
					atIndex: entry.rowOp.atIndex,
					count: entry.rowOp.count,
				};
			}

			return {
				history: nextHistory,
				mutations: [],
				selection: entry.selectionBefore,
				rowOp: inverseRowOp,
				rowChange,
			};
		}

		case "row-reorder":
			return {
				history: nextHistory,
				mutations: [],
				selection: entry.selectionBefore,
				rowReorder: materializeRowReorder(
					{
						columnId: entry.rowReorder.columnId,
						direction: entry.rowReorder.direction,
						oldOrder: entry.rowReorder.newOrder,
						newOrder: entry.rowReorder.oldOrder,
					},
					"undo",
				),
			};

		case "column-resize":
			return {
				history: nextHistory,
				mutations: [],
				selection: entry.selectionBefore,
				columnResize: {
					columnId: entry.columnResize.columnId,
					width: entry.columnResize.oldWidth,
				},
			};

		case "row-resize":
			return {
				history: nextHistory,
				mutations: [],
				selection: entry.selectionBefore,
				rowResize: {
					rowId: entry.rowResize.rowId,
					height: entry.rowResize.oldHeight,
				},
			};
	}
}

export function redo(history: HistoryStack): UndoResult | null {
	if (history.redoStack.length === 0) return null;

	const entry = history.redoStack[history.redoStack.length - 1]!;

	const nextHistory: HistoryStack = {
		undoStack: [...history.undoStack, entry],
		redoStack: history.redoStack.slice(0, -1),
	};

	switch (entry.type) {
		case "cell-mutations":
			return {
				history: nextHistory,
				mutations: entry.forward,
				selection: entry.selectionAfter,
			};

		case "row-operation": {
			let rowChange: UndoRedoRowChange | undefined;
			if (entry.rowOp.type === "insertRows") {
				rowChange = {
					type: "insertRows",
					atIndex: entry.rowOp.atIndex,
					count: entry.rowOp.count,
				};
			} else {
				rowChange = {
					type: "deleteRows",
					atIndex: entry.rowOp.atIndex,
					count: entry.rowOp.count,
				};
			}

			return {
				history: nextHistory,
				mutations: [],
				selection: entry.selectionAfter,
				rowOp: entry.rowOp,
				rowChange,
			};
		}

		case "row-reorder":
			return {
				history: nextHistory,
				mutations: [],
				selection: entry.selectionAfter,
				rowReorder: materializeRowReorder(entry.rowReorder, "redo"),
			};

		case "column-resize":
			return {
				history: nextHistory,
				mutations: [],
				selection: entry.selectionAfter,
				columnResize: {
					columnId: entry.columnResize.columnId,
					width: entry.columnResize.newWidth,
				},
			};

		case "row-resize":
			return {
				history: nextHistory,
				mutations: [],
				selection: entry.selectionAfter,
				rowResize: {
					rowId: entry.rowResize.rowId,
					height: entry.rowResize.newHeight,
				},
			};
	}
}

export function canUndo(history: HistoryStack): boolean {
	return history.undoStack.length > 0;
}

export function canRedo(history: HistoryStack): boolean {
	return history.redoStack.length > 0;
}
