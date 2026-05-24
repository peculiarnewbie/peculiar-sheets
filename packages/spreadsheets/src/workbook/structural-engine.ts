import type { CellValue } from "../types";
import type { WorkbookStructuralChange, WorkbookStructuralOrigin, WorkbookStructuralResult } from "./types";
import type { WorkbookSheetRuntime } from "./registry";
import type { HyperFormulaWorkbookLike } from "./hf-interface";
import type { WorkbookHistoryEntry } from "./history";
import {
	WorkbookSnapshotBuildError,
	WorkbookSnapshotRestoreError,
	WorkbookStructuralOperationError,
	type WorkbookCoordinatorError,
} from "../internal/errors";
import {
	Result,
	applied,
	getErrorMessage,
	type ResultLike,
} from "../internal/result";
import { errorTraceContext, withTraceContext } from "../internal/trace";
import { toNumber } from "../core/brands";

// ── Types ───────────────────────────────────────────────────────────────────

type RegistryAccess = {
	iterSheetRuntimes(): IterableIterator<WorkbookSheetRuntime>;
	tryGetSheetRuntime(sheetKey: string): ResultLike<WorkbookSheetRuntime, WorkbookCoordinatorError>;
};

export interface StructuralEngine {
	subscribe(listener: (change: WorkbookStructuralChange) => void): () => void;
	trySyncRegisteredSheetsToEngine(registry: RegistryAccess): ResultLike<void, WorkbookCoordinatorError>;
	tryBuildSnapshots(registry: RegistryAccess): ResultLike<WorkbookStructuralChange["snapshots"], WorkbookCoordinatorError>;
	tryRestoreSnapshots(
		origin: WorkbookStructuralOrigin,
		snapshots: WorkbookStructuralChange["snapshots"],
		registry: RegistryAccess,
	): ResultLike<WorkbookStructuralChange, WorkbookCoordinatorError>;
	tryApplyStructuralOperation(
		origin: WorkbookStructuralOrigin,
		apply: () => void,
		onHistoryPush: (entry: WorkbookHistoryEntry) => void,
		registry: RegistryAccess,
	): WorkbookStructuralResult;
}

// ── Utilities ───────────────────────────────────────────────────────────────

function cloneCells(cells: CellValue[][]): CellValue[][] {
	return cells.map((row) => [...row]);
}

function normalizeEngineValue(value: CellValue): CellValue {
	if (typeof value !== "string") return value;
	const trimmed = value.trim();
	if (!trimmed.startsWith("=")) return value;
	let rest = trimmed.slice(1);
	while (rest.startsWith("=")) rest = rest.slice(1);
	return `=${rest}`;
}

function normalizeSnapshotValue(value: unknown): CellValue {
	if (value === undefined) return null;
	if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
		return value;
	}
	return String(value);
}

function normalizeSnapshotRows(rows: unknown[][]): CellValue[][] {
	const maxCols = rows.reduce((max, row) => Math.max(max, row.length), 0);
	return rows.map((row) => {
		const normalized = row.map((value) => normalizeSnapshotValue(value));
		while (normalized.length < maxCols) normalized.push(null);
		return normalized;
	});
}

function normalizeSheetContent(cells: CellValue[][]): CellValue[][] {
	return cells.map((row) => row.map((value) => normalizeEngineValue(value)));
}

function originTraceContext(origin: WorkbookStructuralOrigin): Record<string, unknown> {
	switch (origin.type) {
		case "insertRows":
		case "deleteRows":
			return { sheetKey: origin.sheetKey, atIndex: origin.atIndex, count: origin.count };
		case "setRowOrder":
			return { sheetKey: origin.sheetKey, indexOrder: [...origin.indexOrder] };
		case "undo":
		case "redo":
			return { operation: origin.type };
	}
}

// ── Factory ─────────────────────────────────────────────────────────────────

export function createStructuralEngine(
	hf: HyperFormulaWorkbookLike,
): StructuralEngine {
	const listeners = new Set<(change: WorkbookStructuralChange) => void>();

	function trySyncRegisteredSheetsToEngine(registry: RegistryAccess): ResultLike<void, WorkbookCoordinatorError> {
		const trace = withTraceContext({
			module: "workbook-coordinator",
			operation: "syncRegisteredSheetsToEngine",
			phase: "sync",
		});
		trace.start({ sheetCount: 0 });

		for (const runtime of registry.iterSheetRuntimes()) {
			const cells = runtime.getCells ? runtime.getCells() : runtime.lastKnownCells;
			const normalized = normalizeSheetContent(cells);
			const setResult = Result.try({
				try: () => {
					hf.setSheetContent(toNumber(runtime.sheetId), normalized);
				},
				catch: (cause) => new WorkbookStructuralOperationError({
					operation: "syncRegisteredSheetsToEngine",
					sheetKey: runtime.sheetKey,
					formulaName: runtime.formulaName,
					sheetId: runtime.sheetId,
					message: getErrorMessage(cause),
					cause,
				}),
			});
			if (Result.isError(setResult)) {
				trace.err({
					...errorTraceContext(setResult.error),
					sheetKey: runtime.sheetKey,
					sheetId: runtime.sheetId,
				});
				return setResult;
			}
			runtime.lastKnownCells = cloneCells(normalized);
		}

		trace.ok({ sheetCount: 0 });
		return Result.ok();
	}

	function tryBuildSnapshots(registry: RegistryAccess): ResultLike<WorkbookStructuralChange["snapshots"], WorkbookCoordinatorError> {
		const trace = withTraceContext({
			module: "workbook-coordinator",
			operation: "buildSnapshots",
			phase: "snapshot",
		});
		trace.start({ sheetCount: 0 });

		const snapshots: WorkbookStructuralChange["snapshots"] = [];
		for (const runtime of registry.iterSheetRuntimes()) {
			const serializedResult = Result.try({
				try: () => hf.getSheetSerialized(toNumber(runtime.sheetId)),
				catch: (cause) => new WorkbookSnapshotBuildError({
					sheetKey: runtime.sheetKey,
					sheetId: runtime.sheetId,
					message: getErrorMessage(cause),
					cause,
				}),
			});
			if (Result.isError(serializedResult)) {
				trace.err({
					...errorTraceContext(serializedResult.error),
					sheetKey: runtime.sheetKey,
					sheetId: runtime.sheetId,
				});
				return serializedResult;
			}

			const cells = normalizeSnapshotRows(serializedResult.value);
			runtime.lastKnownCells = cloneCells(cells);
			snapshots.push({ sheetKey: runtime.sheetKey, cells });
		}

		trace.ok({ sheetCount: snapshots.length });
		return Result.ok(snapshots);
	}

	function emitChange(
		origin: WorkbookStructuralOrigin,
		snapshots: WorkbookStructuralChange["snapshots"],
	): WorkbookStructuralChange {
		const change = { origin, snapshots };
		for (const listener of listeners) {
			const listenerResult = Result.try({
				try: () => listener(change),
				catch: (cause) => new WorkbookStructuralOperationError({
					operation: "emitChange",
					...originTraceContext(origin),
					message: getErrorMessage(cause),
					cause,
				}),
			});
			if (Result.isError(listenerResult)) {
				withTraceContext({
					module: "workbook-coordinator",
					operation: "emitChange",
					phase: "listener",
					context: originTraceContext(origin),
				}).err(errorTraceContext(listenerResult.error));
			}
		}
		return change;
	}

	return {
		subscribe(listener) {
			listeners.add(listener);
			return () => { listeners.delete(listener); };
		},

		trySyncRegisteredSheetsToEngine,

		tryBuildSnapshots,

		tryRestoreSnapshots(origin, snapshots, registry) {
			const trace = withTraceContext({
				module: "workbook-coordinator",
				operation: "restoreSnapshots",
				phase: "snapshot",
				context: originTraceContext(origin),
			});
			trace.start({ snapshotCount: snapshots.length });

			for (const snapshot of snapshots) {
				const runtimeResult = registry.tryGetSheetRuntime(snapshot.sheetKey);
				if (Result.isError(runtimeResult)) {
					trace.err(errorTraceContext(runtimeResult.error));
					return runtimeResult;
				}

				const runtime = runtimeResult.value;
				const setResult = Result.try({
					try: () => {
						hf.setSheetContent(toNumber(runtime.sheetId), normalizeSheetContent(snapshot.cells));
					},
					catch: (cause) => new WorkbookSnapshotRestoreError({
						sheetKey: snapshot.sheetKey,
						sheetId: runtime.sheetId,
						message: getErrorMessage(cause),
						cause,
					}),
				});
				if (Result.isError(setResult)) {
					trace.err(errorTraceContext(setResult.error));
					return setResult;
				}
				runtime.lastKnownCells = cloneCells(snapshot.cells);
			}

			const rebuiltSnapshots = tryBuildSnapshots(registry);
			if (Result.isError(rebuiltSnapshots)) {
				trace.err(errorTraceContext(rebuiltSnapshots.error));
				return rebuiltSnapshots;
			}

			const change = emitChange(origin, rebuiltSnapshots.value);
			trace.ok({ snapshotCount: rebuiltSnapshots.value.length });
			return Result.ok(change);
		},

		tryApplyStructuralOperation(origin, apply, onHistoryPush, registry) {
			const trace = withTraceContext({
				module: "workbook-coordinator",
				operation: origin.type,
				phase: "structural",
				context: originTraceContext(origin),
			});
			trace.start();

			const result = Result.gen(function* () {
				yield* trySyncRegisteredSheetsToEngine(registry);
				const before = yield* tryBuildSnapshots(registry);
				yield* Result.try({
					try: () => { apply(); },
					catch: (cause) => new WorkbookStructuralOperationError({
						operation: origin.type,
						...originTraceContext(origin),
						message: getErrorMessage(cause),
						cause,
					}),
				});
				const after = yield* tryBuildSnapshots(registry);
				onHistoryPush({ origin, before, after });
				return Result.ok(applied(emitChange(origin, after)));
			});

			if (Result.isError(result)) {
				trace.err(errorTraceContext(result.error));
				return result;
			}

			trace.ok();
			return result;
		},
	};
}
