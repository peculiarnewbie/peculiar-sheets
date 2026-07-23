import type { CellValue } from "../types";
import type { WorkbookStructuralChange, WorkbookStructuralOrigin, WorkbookStructuralResult } from "./types";
import type { WorkbookSheetRuntime } from "./registry";
import type { FormulaEngine } from "./formula-engine";
import type { WorkbookHistoryEntry } from "./history";
import type { FormulaSheetId } from "../core/brands";
import {
	WorkbookSnapshotBuildError,
	WorkbookSnapshotRestoreError,
	WorkbookStructuralOperationError,
	WorkbookStructuralRollbackError,
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

type RollbackSheetState = {
	sheetKey: string;
	sheetId: FormulaSheetId;
	engineCells: CellValue[][];
	lastKnownCells: CellValue[][];
	engineContentConfirmed: boolean;
};

type RollbackState = {
	sheets: RollbackSheetState[];
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

function cellsEqual(left: CellValue[][], right: CellValue[][]): boolean {
	if (left.length !== right.length) return false;
	for (let rowIndex = 0; rowIndex < left.length; rowIndex += 1) {
		const leftRow = left[rowIndex];
		const rightRow = right[rowIndex];
		if (!leftRow || !rightRow || leftRow.length !== rightRow.length) return false;
		for (let colIndex = 0; colIndex < leftRow.length; colIndex += 1) {
			if (leftRow[colIndex] !== rightRow[colIndex]) return false;
		}
	}
	return true;
}

function scopeChangedSnapshots(
	before: WorkbookStructuralChange["snapshots"],
	after: WorkbookStructuralChange["snapshots"],
): Pick<WorkbookHistoryEntry, "before" | "after"> {
	const beforeByKey = new Map(before.map((snapshot) => [snapshot.sheetKey, snapshot.cells]));
	const afterByKey = new Map(after.map((snapshot) => [snapshot.sheetKey, snapshot.cells]));
	const sheetKeys = new Set([...beforeByKey.keys(), ...afterByKey.keys()]);

	const scopedBefore: WorkbookStructuralChange["snapshots"] = [];
	const scopedAfter: WorkbookStructuralChange["snapshots"] = [];
	for (const sheetKey of sheetKeys) {
		const beforeCells = beforeByKey.get(sheetKey) ?? [];
		const afterCells = afterByKey.get(sheetKey) ?? [];
		if (cellsEqual(beforeCells, afterCells)) continue;
		scopedBefore.push({ sheetKey, cells: beforeCells });
		scopedAfter.push({ sheetKey, cells: afterCells });
	}
	return { before: scopedBefore, after: scopedAfter };
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
	engine: FormulaEngine,
): StructuralEngine {
	const listeners = new Set<(change: WorkbookStructuralChange) => void>();

	function tryCaptureRollbackState(registry: RegistryAccess): ResultLike<RollbackState, WorkbookCoordinatorError> {
		const trace = withTraceContext({
			module: "workbook-coordinator",
			operation: "captureRollbackState",
			phase: "rollback",
		});
		trace.start({ sheetCount: 0 });

		const sheets: RollbackSheetState[] = [];
		for (const runtime of registry.iterSheetRuntimes()) {
			let engineCells: CellValue[][];
			if (runtime.engineContentConfirmed) {
				// Confirmed caches already match engine — avoid a redundant full serialize.
				engineCells = cloneCells(runtime.lastKnownCells);
			} else {
				const serializedResult = Result.try({
					try: () => engine.serializeSheet(toNumber(runtime.sheetId)),
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
				engineCells = normalizeSnapshotRows(serializedResult.value);
			}

			sheets.push({
				sheetKey: runtime.sheetKey,
				sheetId: runtime.sheetId,
				engineCells,
				lastKnownCells: cloneCells(runtime.lastKnownCells),
				engineContentConfirmed: runtime.engineContentConfirmed,
			});
		}

		trace.ok({ sheetCount: sheets.length });
		return Result.ok({ sheets });
	}

	function tryBuildSnapshotsFromCaches(
		registry: RegistryAccess,
	): WorkbookStructuralChange["snapshots"] {
		const snapshots: WorkbookStructuralChange["snapshots"] = [];
		for (const runtime of registry.iterSheetRuntimes()) {
			snapshots.push({
				sheetKey: runtime.sheetKey,
				cells: cloneCells(runtime.lastKnownCells),
			});
		}
		return snapshots;
	}

	function failWithRollback(
		origin: WorkbookStructuralOrigin,
		operationError: WorkbookCoordinatorError,
		rollback: RollbackState,
		registry: RegistryAccess,
		trace: ReturnType<typeof withTraceContext>,
	): ResultLike<never, WorkbookCoordinatorError> {
		const restoreResult = tryRollbackState(rollback, registry);
		if (Result.isError(restoreResult)) {
			const rollbackError = new WorkbookStructuralRollbackError({
				operation: origin.type,
				...originTraceContext(origin),
				message: `Structural operation failed and engine restore was incomplete: ${getErrorMessage(operationError)}`,
				engineInconsistent: true,
				cause: operationError,
				rollbackCause: restoreResult.error,
			});
			trace.err({
				...errorTraceContext(rollbackError),
				originalError: errorTraceContext(operationError),
				rollbackError: errorTraceContext(restoreResult.error),
			});
			return Result.err(rollbackError);
		}

		trace.err(errorTraceContext(operationError));
		return Result.err(operationError);
	}

	function tryRollbackState(
		rollback: RollbackState,
		registry: RegistryAccess,
	): ResultLike<void, WorkbookCoordinatorError> {
		const trace = withTraceContext({
			module: "workbook-coordinator",
			operation: "rollbackStructuralOperation",
			phase: "rollback",
		});
		trace.start({ sheetCount: rollback.sheets.length });

		for (const sheet of rollback.sheets) {
			const runtimeResult = registry.tryGetSheetRuntime(sheet.sheetKey);
			if (Result.isError(runtimeResult)) {
				trace.err(errorTraceContext(runtimeResult.error));
				return runtimeResult;
			}

			const runtime = runtimeResult.value;
			const setResult = Result.try({
				try: () => {
					engine.replaceSheet(toNumber(runtime.sheetId), normalizeSheetContent(sheet.engineCells));
				},
				catch: (cause) => new WorkbookSnapshotRestoreError({
					sheetKey: sheet.sheetKey,
					sheetId: runtime.sheetId,
					message: getErrorMessage(cause),
					cause,
				}),
			});
			if (Result.isError(setResult)) {
				trace.err(errorTraceContext(setResult.error));
				return setResult;
			}
			runtime.lastKnownCells = cloneCells(sheet.lastKnownCells);
			runtime.engineContentConfirmed = sheet.engineContentConfirmed;
		}

		trace.ok({ sheetCount: rollback.sheets.length });
		return Result.ok();
	}

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
			// Skip engine writes only when host content matches a previously confirmed engine state.
			if (
				runtime.engineContentConfirmed &&
				cellsEqual(normalized, runtime.lastKnownCells)
			) {
				continue;
			}
			const setResult = Result.try({
				try: () => {
					engine.replaceSheet(toNumber(runtime.sheetId), normalized);
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
			runtime.engineContentConfirmed = true;
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
				try: () => engine.serializeSheet(toNumber(runtime.sheetId)),
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
			runtime.engineContentConfirmed = true;
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

			const rollbackResult = tryCaptureRollbackState(registry);
			if (Result.isError(rollbackResult)) {
				trace.err(errorTraceContext(rollbackResult.error));
				return rollbackResult;
			}
			const rollback = rollbackResult.value;

			for (const snapshot of snapshots) {
				const runtimeResult = registry.tryGetSheetRuntime(snapshot.sheetKey);
				if (Result.isError(runtimeResult)) {
					return failWithRollback(origin, runtimeResult.error, rollback, registry, trace);
				}

				const runtime = runtimeResult.value;
				const setResult = Result.try({
					try: () => {
						engine.replaceSheet(toNumber(runtime.sheetId), normalizeSheetContent(snapshot.cells));
					},
					catch: (cause) => new WorkbookSnapshotRestoreError({
						sheetKey: snapshot.sheetKey,
						sheetId: runtime.sheetId,
						message: getErrorMessage(cause),
						cause,
					}),
				});
				if (Result.isError(setResult)) {
					return failWithRollback(origin, setResult.error, rollback, registry, trace);
				}
				runtime.lastKnownCells = cloneCells(snapshot.cells);
				runtime.engineContentConfirmed = true;
			}

			// Restored sheets updated caches directly; unaffected sheets were untouched.
			// Public payload stays all-sheet without re-serializing the workbook.
			const rebuiltSnapshots = tryBuildSnapshotsFromCaches(registry);
			const change = emitChange(origin, rebuiltSnapshots);
			trace.ok({ snapshotCount: rebuiltSnapshots.length });
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

			const rollbackResult = tryCaptureRollbackState(registry);
			if (Result.isError(rollbackResult)) {
				trace.err(errorTraceContext(rollbackResult.error));
				return rollbackResult;
			}
			const rollback = rollbackResult.value;

			const result = Result.gen(function* () {
				yield* trySyncRegisteredSheetsToEngine(registry);
				// Post-sync caches match engine; avoid a second full-workbook serialize for `before`.
				const before = tryBuildSnapshotsFromCaches(registry);
				yield* Result.try({
					try: () => { apply(); },
					catch: (cause) => new WorkbookStructuralOperationError({
						operation: origin.type,
						...originTraceContext(origin),
						message: getErrorMessage(cause),
						cause,
					}),
				});
				// Structural HF ops can rewrite formulas on dependent sheets — serialize once for public `after`.
				const after = yield* tryBuildSnapshots(registry);
				const scoped = scopeChangedSnapshots(before, after);
				onHistoryPush({ origin, before: scoped.before, after: scoped.after });
				// Public subscriber payload stays all-sheet; history retains only changed sheets.
				return Result.ok(applied(emitChange(origin, after)));
			});

			if (Result.isError(result)) {
				return failWithRollback(origin, result.error, rollback, registry, trace);
			}

			trace.ok();
			return result;
		},
	};
}
