import type { CellRange, CellValue, EditModeState, FormulaEngineConfig, SheetController } from "../types";
import { normalizeRange } from "../core/selection";
import { addressToA1 } from "../formula/references";
import {
	WorkbookBindingMismatchError,
	WorkbookDuplicateFormulaNameError,
	WorkbookHistoryError,
	WorkbookReferenceInsertError,
	WorkbookSheetNotRegisteredError,
	WorkbookSnapshotBuildError,
	WorkbookSnapshotRestoreError,
	WorkbookStructuralOperationError,
	type WorkbookCoordinatorError,
} from "../internal/errors";
import {
	Result,
	applied,
	getErrorMessage,
	isApplied,
	noop,
	type OperationOutcome,
	type ResultLike,
} from "../internal/result";
import { errorTraceContext, withTraceContext } from "../internal/trace";
import type {
	WorkbookCoordinator,
	WorkbookCoordinatorOptions,
	WorkbookSheetBinding,
	WorkbookStructuralChange,
	WorkbookStructuralOrigin,
} from "./types";

interface HyperFormulaWorkbookLike {
	addSheet(name?: string): string;
	getSheetId(name: string): number | undefined;
	getSheetName(sheetId: number): string | undefined;
	simpleCellRangeToString(
		range: {
			start: { sheet: number; row: number; col: number };
			end: { sheet: number; row: number; col: number };
		},
		contextSheetId: number,
	): string | undefined;
	setSheetContent(sheetId: number, values: unknown[][]): unknown;
	getSheetSerialized(sheetId: number): unknown[][];
	addRows(sheetId: number, ...indexes: [number, number][]): unknown;
	isItPossibleToAddRows(sheetId: number, ...indexes: [number, number][]): boolean;
	removeRows(sheetId: number, ...indexes: [number, number][]): unknown;
	isItPossibleToRemoveRows(sheetId: number, ...indexes: [number, number][]): boolean;
	setRowOrder(sheetId: number, newRowOrder: number[]): unknown;
	isItPossibleToSetRowOrder(sheetId: number, newRowOrder: number[]): boolean;
}

interface WorkbookHistoryEntry {
	origin: WorkbookStructuralOrigin;
	before: WorkbookStructuralChange["snapshots"];
	after: WorkbookStructuralChange["snapshots"];
}

interface WorkbookSheetRuntime {
	sheetKey: string;
	formulaName: string;
	sheetId: number;
	controller: SheetController | null;
	getCells: (() => CellValue[][]) | null;
	lastKnownCells: CellValue[][];
}

interface ReferenceSession {
	sourceSheetKey: string;
	targetSheetKey: string;
	anchor: { row: number; col: number };
	didDrag: boolean;
}

export interface WorkbookCoordinatorInternals {
	getFormulaEngineConfig(binding: WorkbookSheetBinding): FormulaEngineConfig;
	attachController(sheetKey: string, controller: SheetController): void;
	detachController(sheetKey: string, controller: SheetController): void;
	attachDataGetter(sheetKey: string, getCells: () => CellValue[][]): void;
	detachDataGetter(sheetKey: string, getCells: () => CellValue[][]): void;
	handleCellPointerDown(sheetKey: string, address: { row: number; col: number }, event: MouseEvent): boolean;
	handleCellPointerMove(sheetKey: string, address: { row: number; col: number }, event: MouseEvent): boolean;
	handleEditModeChange(sheetKey: string, state: EditModeState | null): void;
}

export const workbookCoordinatorInternals = Symbol("workbookCoordinatorInternals");

type WorkbookCoordinatorWithInternals = WorkbookCoordinator & {
	[workbookCoordinatorInternals]: WorkbookCoordinatorInternals;
};

type StructuralOpNoopReason = "invalid-count" | "engine-rejected";
type StructuralOpResult = ResultLike<
	OperationOutcome<WorkbookStructuralChange, StructuralOpNoopReason>,
	WorkbookCoordinatorError
>;
type ReferenceNoopReason = "missing-controller" | "reference-unavailable";
type ReferenceInsertResult = ResultLike<
	OperationOutcome<boolean, ReferenceNoopReason>,
	WorkbookCoordinatorError
>;
type HistoryNoopReason = "history-empty";
type HistoryResult = ResultLike<
	OperationOutcome<WorkbookStructuralChange, HistoryNoopReason>,
	WorkbookCoordinatorError
>;
type SnapshotResult = ResultLike<WorkbookStructuralChange["snapshots"], WorkbookCoordinatorError>;
type RuntimeResult = ResultLike<WorkbookSheetRuntime, WorkbookCoordinatorError>;

function cloneCells(cells: CellValue[][]): CellValue[][] {
	return cells.map((row) => [...row]);
}

function normalizeEngineValue(value: CellValue): CellValue {
	if (typeof value !== "string") return value;

	const trimmed = value.trim();
	if (!trimmed.startsWith("=")) return value;

	let rest = trimmed.slice(1);
	while (rest.startsWith("=")) {
		rest = rest.slice(1);
	}

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
	return rows.map((row) => row.map((value) => normalizeSnapshotValue(value)));
}

function normalizeSheetContent(cells: CellValue[][]): CellValue[][] {
	return cells.map((row) => row.map((value) => normalizeEngineValue(value)));
}

function formatReferenceText(referenceText: string, range: CellRange): string {
	if (range.start.row !== range.end.row || range.start.col !== range.end.col) {
		return referenceText;
	}

	const cellRef = addressToA1(range.start);
	if (referenceText === `${cellRef}:${cellRef}`) {
		return cellRef;
	}
	if (referenceText.endsWith(`!${cellRef}:${cellRef}`)) {
		return referenceText.slice(0, -(`:${cellRef}`).length);
	}
	return referenceText;
}

function toPublicStructuralChange(
	result: ResultLike<OperationOutcome<WorkbookStructuralChange, string>, WorkbookCoordinatorError>,
): WorkbookStructuralChange | null {
	if (Result.isError(result)) return null;
	return isApplied(result.value) ? result.value.value : null;
}

function toPublicReferenceResult(result: ReferenceInsertResult): boolean {
	return Result.isOk(result) && isApplied(result.value);
}

function originTraceContext(origin: WorkbookStructuralOrigin): Record<string, unknown> {
	switch (origin.type) {
		case "insertRows":
		case "deleteRows":
			return {
				sheetKey: origin.sheetKey,
				atIndex: origin.atIndex,
				count: origin.count,
			};
		case "setRowOrder":
			return {
				sheetKey: origin.sheetKey,
				indexOrder: [...origin.indexOrder],
			};
		case "undo":
		case "redo":
			return {
				operation: origin.type,
			};
	}
}

export function getWorkbookCoordinatorInternals(
	coordinator: WorkbookCoordinator,
): WorkbookCoordinatorInternals {
	return (coordinator as WorkbookCoordinatorWithInternals)[workbookCoordinatorInternals];
}

export function createWorkbookCoordinator(
	options: WorkbookCoordinatorOptions,
): WorkbookCoordinator {
	const hf = options.engine as HyperFormulaWorkbookLike;
	const sheets = new Map<string, WorkbookSheetRuntime>();
	const sheetKeysByFormulaName = new Map<string, string>();
	const listeners = new Set<(change: WorkbookStructuralChange) => void>();
	const history: WorkbookHistoryEntry[] = [];
	let historyIndex = 0;
	let referenceSession: ReferenceSession | null = null;
	let cleanupReferenceSession: (() => void) | null = null;

	function tryEnsureSheetId(formulaName: string): ResultLike<number, WorkbookCoordinatorError> {
		const trace = withTraceContext({
			module: "workbook-coordinator",
			operation: "ensureSheetId",
			phase: "binding",
			context: { formulaName },
		});
		trace.start();

		const existingIdResult = Result.try({
			try: () => hf.getSheetId(formulaName),
			catch: (cause) => new WorkbookStructuralOperationError({
				operation: "getSheetId",
				formulaName,
				message: getErrorMessage(cause),
				cause,
			}),
		});
		if (Result.isError(existingIdResult)) {
			trace.err(errorTraceContext(existingIdResult.error));
			return existingIdResult;
		}
		if (existingIdResult.value !== undefined) {
			trace.ok({ sheetId: existingIdResult.value });
			return Result.ok(existingIdResult.value);
		}

		const addedNameResult = Result.try({
			try: () => hf.addSheet(formulaName),
			catch: (cause) => new WorkbookStructuralOperationError({
				operation: "addSheet",
				formulaName,
				message: getErrorMessage(cause),
				cause,
			}),
		});
		if (Result.isError(addedNameResult)) {
			trace.err(errorTraceContext(addedNameResult.error));
			return addedNameResult;
		}

		const addedIdResult = Result.try({
			try: () => hf.getSheetId(addedNameResult.value),
			catch: (cause) => new WorkbookStructuralOperationError({
				operation: "getAddedSheetId",
				formulaName,
				message: getErrorMessage(cause),
				cause,
			}),
		});
		if (Result.isError(addedIdResult)) {
			trace.err(errorTraceContext(addedIdResult.error));
			return addedIdResult;
		}
		if (addedIdResult.value === undefined) {
			const error = new WorkbookStructuralOperationError({
				operation: "ensureSheetId",
				formulaName,
				message: `Failed to create workbook sheet "${formulaName}".`,
			});
			trace.err(errorTraceContext(error));
			return Result.err(error);
		}

		trace.ok({ sheetId: addedIdResult.value });
		return Result.ok(addedIdResult.value);
	}

	function getSheetRuntime(sheetKey: string): WorkbookSheetRuntime {
		const runtime = sheets.get(sheetKey);
		if (!runtime) {
			throw new Error(`Workbook sheet "${sheetKey}" is not registered.`);
		}
		return runtime;
	}

	function tryGetSheetRuntime(sheetKey: string): RuntimeResult {
		const runtime = sheets.get(sheetKey);
		if (!runtime) {
			return Result.err(new WorkbookSheetNotRegisteredError({
				sheetKey,
				message: `Workbook sheet "${sheetKey}" is not registered.`,
			}));
		}
		return Result.ok(runtime);
	}

	function tryBuildSnapshots(): SnapshotResult {
		const trace = withTraceContext({
			module: "workbook-coordinator",
			operation: "buildSnapshots",
			phase: "snapshot",
		});
		trace.start({ sheetCount: sheets.size });

		const snapshots: WorkbookStructuralChange["snapshots"] = [];
		for (const runtime of sheets.values()) {
			const serializedResult = Result.try({
				try: () => hf.getSheetSerialized(runtime.sheetId),
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
			snapshots.push({
				sheetKey: runtime.sheetKey,
				cells,
			});
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
			listener(change);
		}
		return change;
	}

	function trySyncRegisteredSheetsToEngine(): ResultLike<void, WorkbookCoordinatorError> {
		const trace = withTraceContext({
			module: "workbook-coordinator",
			operation: "syncRegisteredSheetsToEngine",
			phase: "sync",
		});
		trace.start({ sheetCount: sheets.size });

		for (const runtime of sheets.values()) {
			const cells = runtime.getCells ? runtime.getCells() : runtime.lastKnownCells;
			const normalized = normalizeSheetContent(cells);
			const setResult = Result.try({
				try: () => {
					hf.setSheetContent(runtime.sheetId, normalized);
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

		trace.ok({ sheetCount: sheets.size });
		return Result.ok();
	}

	function pushHistoryEntry(entry: WorkbookHistoryEntry) {
		history.splice(historyIndex);
		history.push(entry);
		historyIndex = history.length;
	}

	function tryApplyStructuralOperation(
		origin: WorkbookStructuralOrigin,
		apply: () => void,
	): StructuralOpResult {
		const trace = withTraceContext({
			module: "workbook-coordinator",
			operation: origin.type,
			phase: "structural",
			context: originTraceContext(origin),
		});
		trace.start();

		const result = Result.gen(function* () {
			yield* trySyncRegisteredSheetsToEngine();
			const before = yield* tryBuildSnapshots();
			yield* Result.try({
				try: () => {
					apply();
				},
				catch: (cause) => new WorkbookStructuralOperationError({
					operation: origin.type,
					...originTraceContext(origin),
					message: getErrorMessage(cause),
					cause,
				}),
			});
			const after = yield* tryBuildSnapshots();
			pushHistoryEntry({ origin, before, after });
			return Result.ok(applied(emitChange(origin, after)));
		});

		if (Result.isError(result)) {
			trace.err(errorTraceContext(result.error));
			return result;
		}

		trace.ok();
		return result;
	}

	function findActiveReferenceSource(excludedSheetKey: string): WorkbookSheetRuntime | null {
		for (const runtime of sheets.values()) {
			if (runtime.sheetKey === excludedSheetKey) continue;
			if (runtime.controller?.canInsertReference()) {
				return runtime;
			}
		}
		return null;
	}

	function installReferenceSessionCleanup() {
		if (cleanupReferenceSession || typeof document === "undefined") return;

		const handleMouseUp = () => {
			if (referenceSession?.didDrag) {
				clearReferenceHighlights();
			}
			referenceSession = null;
		};

		document.addEventListener("mouseup", handleMouseUp);
		cleanupReferenceSession = () => {
			document.removeEventListener("mouseup", handleMouseUp);
			cleanupReferenceSession = null;
		};
	}

	function clearReferenceHighlights() {
		for (const runtime of sheets.values()) {
			runtime.controller?.setReferenceHighlight(null);
		}
		referenceSession = null;
		cleanupReferenceSession?.();
	}

	function tryInsertReference(
		sourceSheetKey: string,
		targetSheetKey: string,
		range: CellRange,
	): ReferenceInsertResult {
		const trace = withTraceContext({
			module: "workbook-coordinator",
			operation: "insertReference",
			phase: "reference",
			context: { sourceSheetKey, targetSheetKey },
		});
		trace.start();

		const result = Result.gen(function* () {
			const source = yield* tryGetSheetRuntime(sourceSheetKey);
			const target = yield* tryGetSheetRuntime(targetSheetKey);
			const sourceController = source.controller;
			const targetController = target.controller;
			const isActiveReferenceSession =
				referenceSession?.sourceSheetKey === sourceSheetKey &&
				referenceSession?.targetSheetKey === targetSheetKey;

			if (!sourceController || !targetController) {
				return Result.ok(noop("missing-controller"));
			}
			if (!sourceController.canInsertReference() && !isActiveReferenceSession) {
				return Result.ok(noop("missing-controller"));
			}

			const normalized = normalizeRange(range);
			const sheetRange = {
				start: { ...normalized.start, sheet: target.sheetId },
				end: { ...normalized.end, sheet: target.sheetId },
			};
			const referenceResult = Result.try({
				try: () => hf.simpleCellRangeToString(sheetRange, source.sheetId),
				catch: (cause) => new WorkbookReferenceInsertError({
					operation: "simpleCellRangeToString",
					sourceSheetKey,
					targetSheetKey,
					message: getErrorMessage(cause),
					cause,
				}),
			});
			if (Result.isError(referenceResult)) {
				return referenceResult;
			}
			if (!referenceResult.value) {
				return Result.ok(noop("reference-unavailable"));
			}
			const referenceText = formatReferenceText(referenceResult.value, normalized);

			const applyReferenceResult = Result.try({
				try: () => {
					sourceController.insertReferenceText(referenceText);
					targetController.setReferenceHighlight(normalized);
				},
				catch: (cause) => new WorkbookReferenceInsertError({
					operation: "applyReference",
					sourceSheetKey,
					targetSheetKey,
					message: getErrorMessage(cause),
					cause,
				}),
			});
			if (Result.isError(applyReferenceResult)) {
				return applyReferenceResult;
			}

			return Result.ok(applied(true));
		});

		if (Result.isError(result)) {
			trace.err(errorTraceContext(result.error));
			return result;
		}
		if (!isApplied(result.value)) {
			trace.noop({ reason: result.value.reason });
			return result;
		}

		trace.ok();
		return result;
	}

	function tryRestoreSnapshots(
		origin: WorkbookStructuralOrigin,
		snapshots: WorkbookStructuralChange["snapshots"],
	): ResultLike<WorkbookStructuralChange, WorkbookCoordinatorError> {
		const trace = withTraceContext({
			module: "workbook-coordinator",
			operation: "restoreSnapshots",
			phase: "snapshot",
			context: originTraceContext(origin),
		});
		trace.start({ snapshotCount: snapshots.length });

		for (const snapshot of snapshots) {
			const runtimeResult = tryGetSheetRuntime(snapshot.sheetKey);
			if (Result.isError(runtimeResult)) {
				trace.err(errorTraceContext(runtimeResult.error));
				return runtimeResult;
			}

			const runtime = runtimeResult.value;
			const setResult = Result.try({
				try: () => {
					hf.setSheetContent(runtime.sheetId, normalizeSheetContent(snapshot.cells));
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

		const rebuiltSnapshots = tryBuildSnapshots();
		if (Result.isError(rebuiltSnapshots)) {
			trace.err(errorTraceContext(rebuiltSnapshots.error));
			return rebuiltSnapshots;
		}

		const change = emitChange(origin, rebuiltSnapshots.value);
		trace.ok({ snapshotCount: rebuiltSnapshots.value.length });
		return Result.ok(change);
	}

	function tryInsertRows(sheetKey: string, atIndex: number, count: number): StructuralOpResult {
		const trace = withTraceContext({
			module: "workbook-coordinator",
			operation: "insertRows",
			phase: "structural",
			context: { sheetKey, atIndex, count },
		});
		trace.start();

		if (count <= 0) {
			trace.noop({ reason: "invalid-count" });
			return Result.ok(noop("invalid-count"));
		}

		const runtimeResult = tryGetSheetRuntime(sheetKey);
		if (Result.isError(runtimeResult)) {
			trace.err(errorTraceContext(runtimeResult.error));
			return runtimeResult;
		}

		const runtime = runtimeResult.value;
		const syncResult = trySyncRegisteredSheetsToEngine();
		if (Result.isError(syncResult)) {
			trace.err(errorTraceContext(syncResult.error));
			return syncResult;
		}
		const canAddRowsResult = Result.try({
			try: () => hf.isItPossibleToAddRows(runtime.sheetId, [atIndex, count]),
			catch: (cause) => new WorkbookStructuralOperationError({
				operation: "insertRows",
				sheetKey,
				formulaName: runtime.formulaName,
				sheetId: runtime.sheetId,
				atIndex,
				count,
				message: getErrorMessage(cause),
				cause,
			}),
		});
		if (Result.isError(canAddRowsResult)) {
			trace.err(errorTraceContext(canAddRowsResult.error));
			return canAddRowsResult;
		}
		if (!canAddRowsResult.value) {
			trace.noop({ reason: "engine-rejected" });
			return Result.ok(noop("engine-rejected"));
		}

		return tryApplyStructuralOperation(
			{ type: "insertRows", sheetKey, atIndex, count },
			() => {
				hf.addRows(runtime.sheetId, [atIndex, count]);
			},
		);
	}

	function tryDeleteRows(sheetKey: string, atIndex: number, count: number): StructuralOpResult {
		const trace = withTraceContext({
			module: "workbook-coordinator",
			operation: "deleteRows",
			phase: "structural",
			context: { sheetKey, atIndex, count },
		});
		trace.start();

		if (count <= 0) {
			trace.noop({ reason: "invalid-count" });
			return Result.ok(noop("invalid-count"));
		}

		const runtimeResult = tryGetSheetRuntime(sheetKey);
		if (Result.isError(runtimeResult)) {
			trace.err(errorTraceContext(runtimeResult.error));
			return runtimeResult;
		}

		const runtime = runtimeResult.value;
		const syncResult = trySyncRegisteredSheetsToEngine();
		if (Result.isError(syncResult)) {
			trace.err(errorTraceContext(syncResult.error));
			return syncResult;
		}
		const canRemoveRowsResult = Result.try({
			try: () => hf.isItPossibleToRemoveRows(runtime.sheetId, [atIndex, count]),
			catch: (cause) => new WorkbookStructuralOperationError({
				operation: "deleteRows",
				sheetKey,
				formulaName: runtime.formulaName,
				sheetId: runtime.sheetId,
				atIndex,
				count,
				message: getErrorMessage(cause),
				cause,
			}),
		});
		if (Result.isError(canRemoveRowsResult)) {
			trace.err(errorTraceContext(canRemoveRowsResult.error));
			return canRemoveRowsResult;
		}
		if (!canRemoveRowsResult.value) {
			trace.noop({ reason: "engine-rejected" });
			return Result.ok(noop("engine-rejected"));
		}

		return tryApplyStructuralOperation(
			{ type: "deleteRows", sheetKey, atIndex, count },
			() => {
				hf.removeRows(runtime.sheetId, [atIndex, count]);
			},
		);
	}

	function trySetRowOrder(sheetKey: string, indexOrder: number[]): StructuralOpResult {
		const trace = withTraceContext({
			module: "workbook-coordinator",
			operation: "setRowOrder",
			phase: "structural",
			context: { sheetKey, indexOrder: [...indexOrder] },
		});
		trace.start();

		const runtimeResult = tryGetSheetRuntime(sheetKey);
		if (Result.isError(runtimeResult)) {
			trace.err(errorTraceContext(runtimeResult.error));
			return runtimeResult;
		}

		const runtime = runtimeResult.value;
		const syncResult = trySyncRegisteredSheetsToEngine();
		if (Result.isError(syncResult)) {
			trace.err(errorTraceContext(syncResult.error));
			return syncResult;
		}
		const canSetRowOrderResult = Result.try({
			try: () => hf.isItPossibleToSetRowOrder(runtime.sheetId, indexOrder),
			catch: (cause) => new WorkbookStructuralOperationError({
				operation: "setRowOrder",
				sheetKey,
				formulaName: runtime.formulaName,
				sheetId: runtime.sheetId,
				indexOrder: [...indexOrder],
				message: getErrorMessage(cause),
				cause,
			}),
		});
		if (Result.isError(canSetRowOrderResult)) {
			trace.err(errorTraceContext(canSetRowOrderResult.error));
			return canSetRowOrderResult;
		}
		if (!canSetRowOrderResult.value) {
			trace.noop({ reason: "engine-rejected" });
			return Result.ok(noop("engine-rejected"));
		}

		return tryApplyStructuralOperation(
			{ type: "setRowOrder", sheetKey, indexOrder: [...indexOrder] },
			() => {
				hf.setRowOrder(runtime.sheetId, indexOrder);
			},
		);
	}

	function tryUndo(): HistoryResult {
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

		const restoreResult = tryRestoreSnapshots({ type: "undo" }, entry.before);
		if (Result.isError(restoreResult)) {
			trace.err(errorTraceContext(restoreResult.error));
			return restoreResult;
		}

		historyIndex = nextIndex;
		trace.ok();
		return Result.ok(applied(restoreResult.value));
	}

	function tryRedo(): HistoryResult {
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

		const restoreResult = tryRestoreSnapshots({ type: "redo" }, entry.after);
		if (Result.isError(restoreResult)) {
			trace.err(errorTraceContext(restoreResult.error));
			return restoreResult;
		}

		historyIndex += 1;
		trace.ok();
		return Result.ok(applied(restoreResult.value));
	}

	const internals: WorkbookCoordinatorInternals = {
		getFormulaEngineConfig(binding) {
			const runtime = getSheetRuntime(binding.sheetKey);
			if (runtime.formulaName !== binding.formulaName) {
				const error = new WorkbookBindingMismatchError({
					sheetKey: binding.sheetKey,
					expectedFormulaName: runtime.formulaName,
					receivedFormulaName: binding.formulaName,
					message: `Workbook binding mismatch for "${binding.sheetKey}": expected formula name "${runtime.formulaName}", received "${binding.formulaName}".`,
				});
				throw new Error(error.message);
			}

			return {
				instance: hf,
				sheetId: runtime.sheetId,
				sheetName: runtime.formulaName,
			};
		},

		attachController(sheetKey, controller) {
			getSheetRuntime(sheetKey).controller = controller;
			withTraceContext({
				module: "workbook-coordinator",
				operation: "attachController",
				phase: "lifecycle",
				context: { sheetKey },
			}).ok();
		},

		detachController(sheetKey, controller) {
			const runtime = getSheetRuntime(sheetKey);
			if (runtime.controller === controller) {
				runtime.controller?.setReferenceHighlight(null);
				runtime.controller = null;
			}
			if (referenceSession?.sourceSheetKey === sheetKey || referenceSession?.targetSheetKey === sheetKey) {
				clearReferenceHighlights();
			}
			withTraceContext({
				module: "workbook-coordinator",
				operation: "detachController",
				phase: "lifecycle",
				context: { sheetKey },
			}).ok();
		},

		attachDataGetter(sheetKey, getCells) {
			const runtime = getSheetRuntime(sheetKey);
			runtime.getCells = getCells;
			runtime.lastKnownCells = cloneCells(getCells());
			withTraceContext({
				module: "workbook-coordinator",
				operation: "attachDataGetter",
				phase: "lifecycle",
				context: { sheetKey },
			}).ok();
		},

		detachDataGetter(sheetKey, getCells) {
			const runtime = getSheetRuntime(sheetKey);
			if (runtime.getCells === getCells) {
				runtime.lastKnownCells = cloneCells(getCells());
				runtime.getCells = null;
			}
			withTraceContext({
				module: "workbook-coordinator",
				operation: "detachDataGetter",
				phase: "lifecycle",
				context: { sheetKey },
			}).ok();
		},

		handleCellPointerDown(sheetKey, address, event) {
			if (event.button === 2) return false;

			const source = findActiveReferenceSource(sheetKey);
			if (!source) return false;

			event.preventDefault();
			event.stopPropagation();

			const inserted = tryInsertReference(source.sheetKey, sheetKey, {
				start: address,
				end: address,
			});
			if (!toPublicReferenceResult(inserted)) return false;

			referenceSession = {
				sourceSheetKey: source.sheetKey,
				targetSheetKey: sheetKey,
				anchor: address,
				didDrag: false,
			};
			installReferenceSessionCleanup();
			return true;
		},

		handleCellPointerMove(sheetKey, address, event) {
			if (!referenceSession || referenceSession.targetSheetKey !== sheetKey) return false;
			if ((event.buttons & 1) === 0) return false;

			const { sourceSheetKey, anchor } = referenceSession;
			const inserted = tryInsertReference(sourceSheetKey, sheetKey, {
				start: anchor,
				end: address,
			});
			if (toPublicReferenceResult(inserted)) {
				referenceSession.didDrag = true;
				return true;
			}

			return false;
		},

		handleEditModeChange(sheetKey, state) {
			if (!state) {
				clearReferenceHighlights();
				if (referenceSession?.sourceSheetKey === sheetKey) {
					referenceSession = null;
				}
			}
		},
	};

	const coordinator: WorkbookCoordinatorWithInternals = {
		bindSheet(definition) {
			const trace = withTraceContext({
				module: "workbook-coordinator",
				operation: "bindSheet",
				phase: "binding",
				context: { sheetKey: definition.sheetKey, formulaName: definition.formulaName },
			});
			trace.start();

			const existing = sheets.get(definition.sheetKey);
			if (existing) {
				if (existing.formulaName !== definition.formulaName) {
					const error = new Error(
						`Workbook sheet "${definition.sheetKey}" is already bound to formula name "${existing.formulaName}".`,
					);
					trace.err(errorTraceContext(error));
					throw error;
				}
				trace.ok({ reused: true, sheetId: existing.sheetId });
				return {
					coordinator,
					sheetKey: definition.sheetKey,
					formulaName: definition.formulaName,
				};
			}

			const duplicateByName = sheetKeysByFormulaName.get(definition.formulaName);
			if (duplicateByName && duplicateByName !== definition.sheetKey) {
				const error = new WorkbookDuplicateFormulaNameError({
					sheetKey: definition.sheetKey,
					formulaName: definition.formulaName,
					existingSheetKey: duplicateByName,
					message: `Workbook formula name "${definition.formulaName}" is already used by sheet "${duplicateByName}".`,
				});
				trace.err(errorTraceContext(error));
				throw new Error(error.message);
			}

			const sheetIdResult = tryEnsureSheetId(definition.formulaName);
			if (Result.isError(sheetIdResult)) {
				trace.err(errorTraceContext(sheetIdResult.error));
				throw new Error(sheetIdResult.error.message);
			}

			sheets.set(definition.sheetKey, {
				sheetKey: definition.sheetKey,
				formulaName: definition.formulaName,
				sheetId: sheetIdResult.value,
				controller: null,
				getCells: null,
				lastKnownCells: [],
			});
			sheetKeysByFormulaName.set(definition.formulaName, definition.sheetKey);
			trace.ok({ sheetId: sheetIdResult.value });

			return {
				coordinator,
				sheetKey: definition.sheetKey,
				formulaName: definition.formulaName,
			};
		},

		subscribe(listener) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},

		getController(sheetKey) {
			return sheets.get(sheetKey)?.controller ?? null;
		},

		insertReference(sourceSheetKey, targetSheetKey, range) {
			return toPublicReferenceResult(
				tryInsertReference(sourceSheetKey, targetSheetKey, range),
			);
		},

		setReferenceHighlight(sheetKey, range) {
			getSheetRuntime(sheetKey).controller?.setReferenceHighlight(range);
		},

		clearReferenceHighlights,

		insertRows(sheetKey, atIndex, count) {
			return toPublicStructuralChange(tryInsertRows(sheetKey, atIndex, count));
		},

		deleteRows(sheetKey, atIndex, count) {
			return toPublicStructuralChange(tryDeleteRows(sheetKey, atIndex, count));
		},

		setRowOrder(sheetKey, indexOrder) {
			return toPublicStructuralChange(trySetRowOrder(sheetKey, indexOrder));
		},

		undo() {
			return toPublicStructuralChange(tryUndo());
		},

		redo() {
			return toPublicStructuralChange(tryRedo());
		},

		canUndo() {
			return historyIndex > 0;
		},

		canRedo() {
			return historyIndex < history.length;
		},

		[workbookCoordinatorInternals]: internals,
	};

	return coordinator;
}
