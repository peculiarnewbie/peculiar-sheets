import { createSignal } from "solid-js";
import type { CellMutation, CellValue, FormulaEngineConfig } from "../types";
import {
	FormulaBatchUpdateError,
	FormulaCellUpdateError,
	FormulaDisplayValueError,
	FormulaEngineSubscriptionError,
	FormulaEngineSyncError,
	FormulaRowOrderError,
	FormulaSheetResolutionError,
	type FormulaBridgeError,
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
import { type ColumnIndex, type FormulaSheetId, type PhysicalRowIndex, formulaSheetId, toNumber } from "../core/brands";
import { errorTraceContext, withTraceContext } from "../internal/trace";
import { isFormulaValue } from "./references";

// ── HyperFormula Bridge ──────────────────────────────────────────────────────
//
// This module wraps HyperFormula as an optional formula engine. It uses dynamic
// property access so the library has no hard compile-time dependency on
// HyperFormula. Hosts that opt into formulas provide the engine instance themselves
// or through the separately licensed adapter.

/** Minimal interface we expect from a HyperFormula instance. */
interface HyperFormulaLike {
	setCellContents(
		address: { sheet: number; row: number; col: number },
		value: unknown | unknown[][],
	): void;
	getCellValue(address: { sheet: number; row: number; col: number }): unknown;
	addSheet(name?: string): string;
	getSheetId(name: string): number | undefined;
	setSheetContent(sheetId: number, data: unknown[][]): void;
	setRowOrder(sheetId: number, newRowOrder: number[]): unknown;
	isItPossibleToSetRowOrder(sheetId: number, newRowOrder: number[]): boolean;
	/** Suspend recalculation across multiple writes when available. */
	batch?(callback: () => void): unknown;
	on(event: string, callback: (...args: unknown[]) => void): void;
	off(event: string, callback: (...args: unknown[]) => void): void;
}

type FormulaBridgeNoopReason = "sheet-unavailable" | "empty-mutations";
type FormulaBridgeRowOrderNoopReason = FormulaBridgeNoopReason | "engine-rejected";

export type FormulaBridgeOperationResult<Reason extends string = FormulaBridgeNoopReason> =
	ResultLike<OperationOutcome<number, Reason>, FormulaBridgeError>;

/** Result-aware bridge surface used internally by Sheet/Grid orchestration. */
export interface FormulaBridge {
	/** Ensure the target sheet exists and return a detailed operation result. */
	ensureSheet(): FormulaBridgeOperationResult;
	/** Reactive revision number bumped when formula outputs change. */
	revision(): number;
	/** Sync all cell data to the formula engine. */
	syncAll(cells: CellValue[][]): FormulaBridgeOperationResult;
	/** Update a single cell in the formula engine. */
	setCell(row: PhysicalRowIndex, col: ColumnIndex, value: CellValue): FormulaBridgeOperationResult;
	/** Update only the changed cells from a mutation batch (no full-sheet rewrite). */
	setCells(mutations: CellMutation[]): FormulaBridgeOperationResult;
	/** Reorder rows structurally in the formula engine. */
	setRowOrder(newRowOrder: number[]): FormulaBridgeOperationResult<FormulaBridgeRowOrderNoopReason>;
	/** Get the display value for a cell (evaluated formula result or raw value). */
	getDisplayValue(row: PhysicalRowIndex, col: ColumnIndex, rawValue: CellValue): CellValue;
	/** Check if a cell value is a formula. */
	isFormula(value: CellValue): boolean;
	/** Cleanup listeners. */
	dispose(): void;
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

function coerceDisplayValue(result: unknown, rawValue: CellValue): CellValue {
	if (result === null || result === undefined) return null;
	if (typeof result === "string" || typeof result === "number" || typeof result === "boolean") {
		return result;
	}

	if (typeof result === "object" && result !== null) {
		const err = result as { value?: unknown; message?: unknown };
		if (typeof err.value === "string") return err.value;
		if (typeof err.message === "string") return err.message;
	}

	return typeof rawValue === "string" ? rawValue : String(result);
}

/**
 * Creates a formula bridge from the engine config.
 * Returns Ok(null) if no config is provided.
 */
export function createFormulaBridge(
	config: FormulaEngineConfig | undefined,
): ResultLike<FormulaBridge | null, FormulaBridgeError> {
	if (!config) return Result.ok(null);

	const hf = config.instance as HyperFormulaLike;
	let resolvedSheetId: FormulaSheetId | null = config.sheetId ?? null;
	const sheetName = config.sheetName ?? "Sheet1";
	const onEngineContentChanged = config.onEngineContentChanged;
	const [revision, setRevision] = createSignal(0);

	function bumpRevision() {
		setRevision((value) => value + 1);
	}

	function notifyEngineContentChanged() {
		onEngineContentChanged?.();
	}

	function tryResolveSheetId(): FormulaBridgeOperationResult {
		if (resolvedSheetId !== null) {
			return Result.ok(applied(resolvedSheetId));
		}

		const trace = withTraceContext({
			module: "formula-bridge",
			operation: "resolveSheetId",
			phase: "resolution",
			context: { formulaName: sheetName },
		});
		trace.start();

		const existingIdResult = Result.try({
			try: () => hf.getSheetId(sheetName),
			catch: (cause) => new FormulaSheetResolutionError({
				operation: "getSheetId",
				formulaName: sheetName,
				message: getErrorMessage(cause),
				cause,
			}),
		});
		if (Result.isError(existingIdResult)) {
			trace.err(errorTraceContext(existingIdResult.error));
			return existingIdResult;
		}

		if (existingIdResult.value !== undefined) {
			resolvedSheetId = formulaSheetId(existingIdResult.value);
			trace.ok({ sheetId: resolvedSheetId });
			return Result.ok(applied(resolvedSheetId));
		}

		const addedNameResult = Result.try({
			try: () => hf.addSheet(sheetName),
			catch: (cause) => new FormulaSheetResolutionError({
				operation: "addSheet",
				formulaName: sheetName,
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
			catch: (cause) => new FormulaSheetResolutionError({
				operation: "getAddedSheetId",
				formulaName: sheetName,
				message: getErrorMessage(cause),
				cause,
			}),
		});
		if (Result.isError(addedIdResult)) {
			trace.err(errorTraceContext(addedIdResult.error));
			return addedIdResult;
		}

		if (addedIdResult.value === undefined) {
			trace.noop({ reason: "sheet-unavailable" });
			return Result.ok(noop("sheet-unavailable"));
		}

		resolvedSheetId = formulaSheetId(addedIdResult.value);
		trace.ok({ sheetId: resolvedSheetId });
		return Result.ok(applied(resolvedSheetId));
	}

	function trySubscribeValuesUpdated(): ResultLike<void, FormulaEngineSubscriptionError> {
		const trace = withTraceContext({
			module: "formula-bridge",
			operation: "subscribeValuesUpdated",
			phase: "subscription",
			context: { formulaName: sheetName },
		});
		trace.start();

		const result = Result.try({
			try: () => {
				hf.on("valuesUpdated", handleValuesUpdated);
			},
			catch: (cause) => new FormulaEngineSubscriptionError({
				operation: "subscribe",
				formulaName: sheetName,
				message: getErrorMessage(cause),
				cause,
			}),
		});

		if (Result.isError(result)) {
			trace.err(errorTraceContext(result.error));
			return result;
		}

		trace.ok();
		return Result.ok();
	}

	function tryUnsubscribeValuesUpdated(): ResultLike<void, FormulaEngineSubscriptionError> {
		const trace = withTraceContext({
			module: "formula-bridge",
			operation: "unsubscribeValuesUpdated",
			phase: "cleanup",
			context: { formulaName: sheetName },
		});
		trace.start();

		const result = Result.try({
			try: () => {
				hf.off("valuesUpdated", handleValuesUpdated);
			},
			catch: (cause) => new FormulaEngineSubscriptionError({
				operation: "unsubscribe",
				formulaName: sheetName,
				message: getErrorMessage(cause),
				cause,
			}),
		});

		if (Result.isError(result)) {
			trace.err(errorTraceContext(result.error));
			return result;
		}

		trace.ok();
		return Result.ok();
	}

	function handleValuesUpdated(...args: unknown[]) {
		const [changes] = args;
		if (!Array.isArray(changes)) return;

		const sheetIdResult = tryResolveSheetId();
		if (Result.isError(sheetIdResult)) {
			return;
		}
		if (!isApplied(sheetIdResult.value)) {
			return;
		}

		const sheetId = formulaSheetId(sheetIdResult.value.value);
		const affectsSheet = changes.some((change) => {
			if (typeof change !== "object" || change === null) return false;
			if (!("address" in change)) return true;

			const address = (change as { address?: { sheet?: unknown } }).address;
			return address?.sheet === toNumber(sheetId);
		});

		if (affectsSheet) {
			bumpRevision();
		}
	}

	function trySyncAll(cells: CellValue[][]): FormulaBridgeOperationResult {
		const trace = withTraceContext({
			module: "formula-bridge",
			operation: "syncAll",
			phase: "mutation",
			context: { formulaName: sheetName, rowCount: cells.length },
		});
		trace.start();

		const sheetIdResult = tryResolveSheetId();
		if (Result.isError(sheetIdResult)) {
			trace.err(errorTraceContext(sheetIdResult.error));
			return sheetIdResult;
		}
		if (!isApplied(sheetIdResult.value)) {
			trace.noop({ reason: sheetIdResult.value.reason });
			return sheetIdResult;
		}

		const sheetId = formulaSheetId(sheetIdResult.value.value);
		const result = Result.try({
			try: () => {
				hf.setSheetContent(
					toNumber(sheetId),
					cells.map((row) => row.map((value) => normalizeEngineValue(value))),
				);
			},
			catch: (cause) => new FormulaEngineSyncError({
				operation: "syncAll",
				formulaName: sheetName,
				sheetId,
				message: getErrorMessage(cause),
				cause,
			}),
		});

		if (Result.isError(result)) {
			trace.err(errorTraceContext(result.error));
			return result;
		}

		notifyEngineContentChanged();
		bumpRevision();
		trace.ok({ sheetId: toNumber(sheetId) });
		return Result.ok(applied(sheetId));
	}

	function trySetCell(row: PhysicalRowIndex, col: ColumnIndex, value: CellValue): FormulaBridgeOperationResult {
		const trace = withTraceContext({
			module: "formula-bridge",
			operation: "setCell",
			phase: "mutation",
			context: { formulaName: sheetName, row: toNumber(row), col: toNumber(col) },
		});
		trace.start();

		const sheetIdResult = tryResolveSheetId();
		if (Result.isError(sheetIdResult)) {
			trace.err(errorTraceContext(sheetIdResult.error));
			return sheetIdResult;
		}
		if (!isApplied(sheetIdResult.value)) {
			trace.noop({ reason: sheetIdResult.value.reason });
			return sheetIdResult;
		}

		const fSheetId = formulaSheetId(sheetIdResult.value.value);
		const result = Result.try({
			try: () => {
				hf.setCellContents(
					{ sheet: toNumber(fSheetId), row: toNumber(row), col: toNumber(col) },
					normalizeEngineValue(value),
				);
			},
			catch: (cause) => new FormulaCellUpdateError({
				operation: "setCell",
				formulaName: sheetName,
				sheetId: fSheetId,
				row,
				col,
				message: getErrorMessage(cause),
				cause,
			}),
		});

		if (Result.isError(result)) {
			trace.err(errorTraceContext(result.error));
			return result;
		}

		notifyEngineContentChanged();
		bumpRevision();
		trace.ok({ sheetId: toNumber(fSheetId) });
		return Result.ok(applied(toNumber(fSheetId)));
	}

	function trySetCells(mutations: CellMutation[]): FormulaBridgeOperationResult {
		const trace = withTraceContext({
			module: "formula-bridge",
			operation: "setCells",
			phase: "mutation",
			context: { formulaName: sheetName, cellCount: mutations.length },
		});
		trace.start();

		if (mutations.length === 0) {
			trace.noop({ reason: "empty-mutations" });
			return Result.ok(noop("empty-mutations"));
		}

		const sheetIdResult = tryResolveSheetId();
		if (Result.isError(sheetIdResult)) {
			trace.err(errorTraceContext(sheetIdResult.error));
			return sheetIdResult;
		}
		if (!isApplied(sheetIdResult.value)) {
			trace.noop({ reason: sheetIdResult.value.reason });
			return sheetIdResult;
		}

		const fSheetId = formulaSheetId(sheetIdResult.value.value);
		const sheet = toNumber(fSheetId);

		function cellKey(row: number, col: number): string {
			return `${row}:${col}`;
		}

		// First oldValue per address is the pre-batch engine state to restore.
		const restoreByKey = new Map<string, CellValue>();
		for (const mutation of mutations) {
			const key = cellKey(toNumber(mutation.address.row), toNumber(mutation.address.col));
			if (!restoreByKey.has(key)) {
				restoreByKey.set(key, mutation.oldValue);
			}
		}

		const writtenKeys: string[] = [];
		const writtenKeySet = new Set<string>();

		function writeAll(): void {
			for (const mutation of mutations) {
				const row = toNumber(mutation.address.row);
				const col = toNumber(mutation.address.col);
				const key = cellKey(row, col);
				hf.setCellContents(
					{ sheet, row, col },
					normalizeEngineValue(mutation.newValue),
				);
				if (!writtenKeySet.has(key)) {
					writtenKeySet.add(key);
					writtenKeys.push(key);
				}
			}
		}

		function restoreWritten(): boolean {
			let restoredAll = true;
			// Reverse order so repeated writes to the same address restore the original.
			for (let index = writtenKeys.length - 1; index >= 0; index -= 1) {
				const key = writtenKeys[index];
				if (key === undefined) continue;
				const separator = key.indexOf(":");
				const row = Number(key.slice(0, separator));
				const col = Number(key.slice(separator + 1));
				const previous = restoreByKey.get(key);
				if (previous === undefined) {
					restoredAll = false;
					continue;
				}
				try {
					hf.setCellContents(
						{ sheet, row, col },
						normalizeEngineValue(previous),
					);
				} catch {
					restoredAll = false;
				}
			}
			return restoredAll;
		}

		try {
			if (typeof hf.batch === "function") {
				hf.batch(writeAll);
			} else {
				writeAll();
			}
		} catch (cause) {
			const restoredAll = restoreWritten();
			const error = new FormulaBatchUpdateError({
				operation: "setCells",
				formulaName: sheetName,
				sheetId: fSheetId,
				cellCount: mutations.length,
				message: restoredAll
					? getErrorMessage(cause)
					: `batch update failed and engine restore was incomplete: ${getErrorMessage(cause)}`,
				engineInconsistent: !restoredAll,
				cause,
			});
			trace.err(errorTraceContext(error));
			return Result.err(error);
		}

		notifyEngineContentChanged();
		bumpRevision();
		trace.ok({ sheetId: toNumber(fSheetId), cellCount: mutations.length });
		return Result.ok(applied(toNumber(fSheetId)));
	}

	function trySetRowOrder(
		newRowOrder: number[],
	): FormulaBridgeOperationResult<FormulaBridgeRowOrderNoopReason> {
		const trace = withTraceContext({
			module: "formula-bridge",
			operation: "setRowOrder",
			phase: "mutation",
			context: { formulaName: sheetName, indexOrder: [...newRowOrder] },
		});
		trace.start();

		const sheetIdResult = tryResolveSheetId();
		if (Result.isError(sheetIdResult)) {
			trace.err(errorTraceContext(sheetIdResult.error));
			return sheetIdResult;
		}
		if (!isApplied(sheetIdResult.value)) {
			trace.noop({ reason: sheetIdResult.value.reason });
			return sheetIdResult;
		}

		const fSheetId = formulaSheetId(sheetIdResult.value.value);
		const canSetRowOrderResult = Result.try({
			try: () => hf.isItPossibleToSetRowOrder(toNumber(fSheetId), newRowOrder),
			catch: (cause) => new FormulaRowOrderError({
				operation: "setRowOrder",
				formulaName: sheetName,
				sheetId: fSheetId,
				indexOrder: [...newRowOrder],
				message: getErrorMessage(cause),
				cause,
			}),
		});
		if (Result.isError(canSetRowOrderResult)) {
			trace.err(errorTraceContext(canSetRowOrderResult.error));
			return canSetRowOrderResult;
		}
		if (!canSetRowOrderResult.value) {
			trace.noop({ reason: "engine-rejected", sheetId: toNumber(fSheetId) });
			return Result.ok(noop("engine-rejected"));
		}

		const rowOrderResult = Result.try({
			try: () => {
				hf.setRowOrder(toNumber(fSheetId), newRowOrder);
			},
			catch: (cause) => new FormulaRowOrderError({
				operation: "setRowOrder",
				formulaName: sheetName,
				sheetId: fSheetId,
				indexOrder: [...newRowOrder],
				message: getErrorMessage(cause),
				cause,
			}),
		});
		if (Result.isError(rowOrderResult)) {
			trace.err(errorTraceContext(rowOrderResult.error));
			return rowOrderResult;
		}

		notifyEngineContentChanged();
		bumpRevision();
		trace.ok({ sheetId: toNumber(fSheetId) });
		return Result.ok(applied(toNumber(fSheetId)));
	}

	function tryGetDisplayValue(
		row: PhysicalRowIndex,
		col: ColumnIndex,
		rawValue: CellValue,
	): ResultLike<OperationOutcome<CellValue, FormulaBridgeNoopReason>, FormulaBridgeError> {
		const sheetIdResult = tryResolveSheetId();
		if (Result.isError(sheetIdResult)) {
			return sheetIdResult;
		}
		if (!isApplied(sheetIdResult.value)) {
			return Result.ok(noop("sheet-unavailable"));
		}

		const fSheetId = formulaSheetId(sheetIdResult.value.value);
		return Result.try({
			try: () => applied(coerceDisplayValue(hf.getCellValue({ sheet: toNumber(fSheetId), row: toNumber(row), col: toNumber(col) }), rawValue)),
			catch: (cause) => new FormulaDisplayValueError({
				operation: "getDisplayValue",
				formulaName: sheetName,
				sheetId: fSheetId,
				row,
				col,
				message: getErrorMessage(cause),
				cause,
			}),
		});
	}

	const subscriptionResult = trySubscribeValuesUpdated();
	if (Result.isError(subscriptionResult)) {
		return subscriptionResult;
	}

	const bridge: FormulaBridge = {
		ensureSheet() {
			return tryResolveSheetId();
		},

		revision() {
			return revision();
		},

		syncAll(cells: CellValue[][]) {
			return trySyncAll(cells);
		},

		setCell(row: PhysicalRowIndex, col: ColumnIndex, value: CellValue) {
			return trySetCell(row, col, value);
		},

		setCells(mutations: CellMutation[]) {
			return trySetCells(mutations);
		},

		setRowOrder(newRowOrder: number[]) {
			return trySetRowOrder(newRowOrder);
		},

		getDisplayValue(row: PhysicalRowIndex, col: ColumnIndex, rawValue: CellValue): CellValue {
			if (!bridge.isFormula(rawValue)) return rawValue;

			const result = tryGetDisplayValue(row, col, rawValue);
			if (Result.isError(result)) {
				withTraceContext({
					module: "formula-bridge",
					operation: "getDisplayValue",
					phase: "read",
					context: { formulaName: sheetName, row: toNumber(row), col: toNumber(col) },
				}).err(errorTraceContext(result.error));
				return rawValue;
			}

			return isApplied(result.value) ? result.value.value : rawValue;
		},

		isFormula(value: CellValue): boolean {
			return isFormulaValue(value);
		},

		dispose() {
			tryUnsubscribeValuesUpdated();
		},
	};

	return Result.ok(bridge);
}
