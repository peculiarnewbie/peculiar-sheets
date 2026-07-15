import type { WorkbookStructuralChange, WorkbookStructuralOrigin, WorkbookHistoryResult } from "./types";
import {
	WorkbookHistoryError,
	type WorkbookCoordinatorError,
} from "../internal/errors";
import {
	Result,
	applied,
	noop,
	type ResultLike,
} from "../internal/result";
import { errorTraceContext, withTraceContext } from "../internal/trace";

// ── Types ───────────────────────────────────────────────────────────────────

export interface WorkbookHistoryEntry {
	origin: WorkbookStructuralOrigin;
	before: WorkbookStructuralChange["snapshots"];
	after: WorkbookStructuralChange["snapshots"];
}

export interface HistoryManager {
	canUndo(): boolean;
	canRedo(): boolean;
	undo(restoreSnapshots: (
		origin: WorkbookStructuralOrigin,
		snapshots: WorkbookStructuralChange["snapshots"],
	) => ResultLike<WorkbookStructuralChange, WorkbookCoordinatorError>,
	): WorkbookHistoryResult;
	redo(restoreSnapshots: (
		origin: WorkbookStructuralOrigin,
		snapshots: WorkbookStructuralChange["snapshots"],
	) => ResultLike<WorkbookStructuralChange, WorkbookCoordinatorError>,
	): WorkbookHistoryResult;
	pushHistoryEntry(entry: WorkbookHistoryEntry): void;
	/** Test/inspection helper: retained history entries in stack order. */
	peekEntries(): readonly WorkbookHistoryEntry[];
}

// ── Factory ─────────────────────────────────────────────────────────────────

export function createHistoryManager(): HistoryManager {
	const history: WorkbookHistoryEntry[] = [];
	let historyIndex = 0;

	return {
		canUndo() {
			return historyIndex > 0;
		},

		canRedo() {
			return historyIndex < history.length;
		},

		pushHistoryEntry(entry) {
			history.splice(historyIndex);
			history.push(entry);
			historyIndex = history.length;
		},

		peekEntries() {
			return history;
		},

		undo(restoreSnapshots) {
			const trace = withTraceContext({
				module: "workbook-coordinator",
				operation: "undo",
				phase: "history",
			});
			trace.start();

			if (historyIndex <= 0) {
				trace.noop({ reason: "history-empty" });
				return Result.ok(noop("history-empty"));
			}

			const nextIndex = historyIndex - 1;
			const entry = history[nextIndex];
			if (!entry) {
				const error = new WorkbookHistoryError({
					operation: "undo",
					message: "Undo history entry is missing.",
				});
				trace.err(errorTraceContext(error));
				return Result.err(error);
			}

			const restoreResult = restoreSnapshots({ type: "undo" }, entry.before);
			if (Result.isError(restoreResult)) {
				trace.err(errorTraceContext(restoreResult.error));
				return restoreResult;
			}

			historyIndex = nextIndex;
			trace.ok();
			return Result.ok(applied(restoreResult.value));
		},

		redo(restoreSnapshots) {
			const trace = withTraceContext({
				module: "workbook-coordinator",
				operation: "redo",
				phase: "history",
			});
			trace.start();

			if (historyIndex >= history.length) {
				trace.noop({ reason: "history-empty" });
				return Result.ok(noop("history-empty"));
			}

			const entry = history[historyIndex];
			if (!entry) {
				const error = new WorkbookHistoryError({
					operation: "redo",
					message: "Redo history entry is missing.",
				});
				trace.err(errorTraceContext(error));
				return Result.err(error);
			}

			const restoreResult = restoreSnapshots({ type: "redo" }, entry.after);
			if (Result.isError(restoreResult)) {
				trace.err(errorTraceContext(restoreResult.error));
				return restoreResult;
			}

			historyIndex += 1;
			trace.ok();
			return Result.ok(applied(restoreResult.value));
		},
	};
}
