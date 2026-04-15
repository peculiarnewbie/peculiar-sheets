import { createSignal } from "solid-js";
import type { CellValue, FormulaEngineConfig } from "../types";
import {
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
import { errorTraceContext, withTraceContext } from "../internal/trace";
import { isFormulaValue } from "./references";

// ── HyperFormula Bridge ──────────────────────────────────────────────────────
//
// This module wraps HyperFormula as an optional formula engine. It uses dynamic
// property access so the library has no hard compile-time dependency on
// HyperFormula — it's a peer dependency that may or may not be installed.

/** Minimal interface we expect from a HyperFormula instance. */
interface HyperFormulaLike {
	setCellContents(address: { sheet: number; row: number; col: number }, value: unknown): void;
	getCellValue(address: { sheet: number; row: number; col: number }): unknown;
	addSheet(name?: string): string;
	getSheetId(name: string): number | undefined;
	setSheetContent(sheetId: number, data: unknown[][]): void;
	setRowOrder(sheetId: number, newRowOrder: number[]): unknown;
	isItPossibleToSetRowOrder(sheetId: number, newRowOrder: number[]): boolean;
	on(event: string, callback: (...args: unknown[]) => void): void;
	off(event: string, callback: (...args: unknown[]) => void): void;
}

type FormulaBridgeNoopReason = "sheet-unavailable";
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
	setCell(row: number, col: number, value: CellValue): FormulaBridgeOperationResult;
	/** Reorder rows structurally in the formula engine. */
	setRowOrder(newRowOrder: number[]): FormulaBridgeOperationResult<FormulaBridgeRowOrderNoopReason>;
	/** Get the display value for a cell (evaluated formula result or raw value). */
	getDisplayValue(row: number, col: number, rawValue: CellValue): CellValue;
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
 * Returns null if no config is provided.
 */
export function createFormulaBridge(
	config: FormulaEngineConfig | undefined,
): FormulaBridge | null {
	if (!config) return null;

	const hf = config.instance as HyperFormulaLike;
	let resolvedSheetId: number | null = config.sheetId ?? null;
	const sheetName = config.sheetName ?? "Sheet1";
	const [revision, setRevision] = createSignal(0);

	function bumpRevision() {
		setRevision((value) => value + 1);
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
			resolvedSheetId = existingIdResult.value;
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

		resolvedSheetId = addedIdResult.value;
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

		const sheetId = sheetIdResult.value.value;
		const affectsSheet = changes.some((change) => {
			if (typeof change !== "object" || change === null) return false;
			if (!("address" in change)) return true;

			const address = (change as { address?: { sheet?: unknown } }).address;
			return address?.sheet === sheetId;
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

		const sheetId = sheetIdResult.value.value;
		const result = Result.try({
			try: () => {
				hf.setSheetContent(
					sheetId,
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

		bumpRevision();
		trace.ok({ sheetId });
		return Result.ok(applied(sheetId));
	}

	function trySetCell(row: number, col: number, value: CellValue): FormulaBridgeOperationResult {
		const trace = withTraceContext({
			module: "formula-bridge",
			operation: "setCell",
			phase: "mutation",
			context: { formulaName: sheetName, row, col },
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

		const sheetId = sheetIdResult.value.value;
		const result = Result.try({
			try: () => {
				hf.setCellContents(
					{ sheet: sheetId, row, col },
					normalizeEngineValue(value),
				);
			},
			catch: (cause) => new FormulaCellUpdateError({
				operation: "setCell",
				formulaName: sheetName,
				sheetId,
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

		bumpRevision();
		trace.ok({ sheetId });
		return Result.ok(applied(sheetId));
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

		const sheetId = sheetIdResult.value.value;
		const canSetRowOrderResult = Result.try({
			try: () => hf.isItPossibleToSetRowOrder(sheetId, newRowOrder),
			catch: (cause) => new FormulaRowOrderError({
				operation: "setRowOrder",
				formulaName: sheetName,
				sheetId,
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
			trace.noop({ reason: "engine-rejected", sheetId });
			return Result.ok(noop("engine-rejected"));
		}

		const rowOrderResult = Result.try({
			try: () => {
				hf.setRowOrder(sheetId, newRowOrder);
			},
			catch: (cause) => new FormulaRowOrderError({
				operation: "setRowOrder",
				formulaName: sheetName,
				sheetId,
				indexOrder: [...newRowOrder],
				message: getErrorMessage(cause),
				cause,
			}),
		});
		if (Result.isError(rowOrderResult)) {
			trace.err(errorTraceContext(rowOrderResult.error));
			return rowOrderResult;
		}

		bumpRevision();
		trace.ok({ sheetId });
		return Result.ok(applied(sheetId));
	}

	function tryGetDisplayValue(
		row: number,
		col: number,
		rawValue: CellValue,
	): ResultLike<OperationOutcome<CellValue, FormulaBridgeNoopReason>, FormulaBridgeError> {
		const sheetIdResult = tryResolveSheetId();
		if (Result.isError(sheetIdResult)) {
			return sheetIdResult;
		}
		if (!isApplied(sheetIdResult.value)) {
			return Result.ok(noop("sheet-unavailable"));
		}

		const sheetId = sheetIdResult.value.value;
		return Result.try({
			try: () => applied(coerceDisplayValue(hf.getCellValue({ sheet: sheetId, row, col }), rawValue)),
			catch: (cause) => new FormulaDisplayValueError({
				operation: "getDisplayValue",
				formulaName: sheetName,
				sheetId,
				row,
				col,
				message: getErrorMessage(cause),
				cause,
			}),
		});
	}

	trySubscribeValuesUpdated();

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

		setCell(row: number, col: number, value: CellValue) {
			return trySetCell(row, col, value);
		},

		setRowOrder(newRowOrder: number[]) {
			return trySetRowOrder(newRowOrder);
		},

		getDisplayValue(row: number, col: number, rawValue: CellValue): CellValue {
			if (!bridge.isFormula(rawValue)) return rawValue;

			const result = tryGetDisplayValue(row, col, rawValue);
			if (Result.isError(result)) {
				withTraceContext({
					module: "formula-bridge",
					operation: "getDisplayValue",
					phase: "read",
					context: { formulaName: sheetName, row, col },
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

	return bridge;
}
