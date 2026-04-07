import type { CellMutation, CellValue, RowReorderMutation, Selection } from "../types";

// ── Row Operation Types ─────────────────────────────────────────────────────

export type RowOperation =
	| { type: "insertRows"; atIndex: number; count: number }
	| { type: "deleteRows"; atIndex: number; count: number; removedData: CellValue[][] };

interface StoredRowReorder {
	columnId: string;
	direction: RowReorderMutation["direction"];
	oldOrder: number[];
	newOrder: number[];
}

// ── Types ────────────────────────────────────────────────────────────────────

export type HistoryEntry =
	| {
		type: "cell-mutations";
		forward: CellMutation[];
		inverse: CellMutation[];
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
	const undoStack = [...history.undoStack, entry].slice(-MAX_HISTORY);
	return { undoStack, redoStack: [] };
}

export function pushMutationHistory(
	history: HistoryStack,
	forward: CellMutation[],
	selectionBefore: Selection,
	selectionAfter: Selection,
): HistoryStack {
	if (forward.length === 0) return history;

	const inverse = forward.map<CellMutation>((m) => ({
		address: m.address,
		viewAddress: m.viewAddress,
		rowId: m.rowId,
		columnId: m.columnId,
		oldValue: m.newValue,
		newValue: m.oldValue,
		source: m.source,
	}));

	return pushEntry(history, {
		type: "cell-mutations",
		forward,
		inverse,
		selectionBefore,
		selectionAfter,
	});
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
}

function buildIndexOrder(oldOrder: number[], newOrder: number[]): number[] {
	const nextIndexByRowId = new Map<number, number>();
	for (let i = 0; i < newOrder.length; i++) {
		nextIndexByRowId.set(newOrder[i]!, i);
	}

	return oldOrder.map((rowId) => nextIndexByRowId.get(rowId) ?? -1);
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
				mutations: entry.inverse,
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
	}
}

export function canUndo(history: HistoryStack): boolean {
	return history.undoStack.length > 0;
}

export function canRedo(history: HistoryStack): boolean {
	return history.redoStack.length > 0;
}
