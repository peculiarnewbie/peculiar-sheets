import type { CellMutation, Selection } from "../types";

// ── Types ────────────────────────────────────────────────────────────────────

export interface HistoryEntry {
	forward: CellMutation[];
	inverse: CellMutation[];
	selectionBefore: Selection;
	selectionAfter: Selection;
}

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

/**
 * Record a batch of mutations into the history stack.
 * Returns a new HistoryStack (immutable).
 */
export function pushHistory(
	history: HistoryStack,
	forward: CellMutation[],
	selectionBefore: Selection,
	selectionAfter: Selection,
): HistoryStack {
	if (forward.length === 0) return history;

	const inverse = forward.map<CellMutation>((m) => ({
		address: m.address,
		columnId: m.columnId,
		oldValue: m.newValue,
		newValue: m.oldValue,
		source: m.source,
	}));

	const entry: HistoryEntry = { forward, inverse, selectionBefore, selectionAfter };

	const undoStack = [...history.undoStack, entry].slice(-MAX_HISTORY);
	return { undoStack, redoStack: [] };
}

// ── Undo / Redo ──────────────────────────────────────────────────────────────

export interface UndoResult {
	history: HistoryStack;
	mutations: CellMutation[];
	selection: Selection;
}

export function undo(history: HistoryStack): UndoResult | null {
	if (history.undoStack.length === 0) return null;

	const entry = history.undoStack[history.undoStack.length - 1]!;
	return {
		history: {
			undoStack: history.undoStack.slice(0, -1),
			redoStack: [...history.redoStack, entry],
		},
		mutations: entry.inverse,
		selection: entry.selectionBefore,
	};
}

export function redo(history: HistoryStack): UndoResult | null {
	if (history.redoStack.length === 0) return null;

	const entry = history.redoStack[history.redoStack.length - 1]!;
	return {
		history: {
			undoStack: [...history.undoStack, entry],
			redoStack: history.redoStack.slice(0, -1),
		},
		mutations: entry.forward,
		selection: entry.selectionAfter,
	};
}

export function canUndo(history: HistoryStack): boolean {
	return history.undoStack.length > 0;
}

export function canRedo(history: HistoryStack): boolean {
	return history.redoStack.length > 0;
}
