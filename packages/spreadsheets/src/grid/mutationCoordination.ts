import type { UndoRedoResult } from "../core/state";
import { toNumber, type RowId } from "../core/brands";
import type { FormulaBridgeOperationResult } from "../formula/bridge";
import {
	Result,
	applied,
	isApplied,
	isNoop,
	noop,
	type OperationOutcome,
	type ResultLike,
} from "../internal/result";
import type { FormulaBridgeError } from "../internal/errors";
import type {
	CellMutation,
	CellValue,
	RowReorderMutation,
	SheetOperation,
} from "../types";

export type MutationCoordinationNoopReason =
	| "empty-mutations"
	| "no-transition"
	| "formula-sync-noop";

export type MutationCoordinationResult = ResultLike<
	OperationOutcome<true, MutationCoordinationNoopReason>,
	FormulaBridgeError
>;

/** Injected formula engine surface — no Solid/DOM. */
export interface FormulaSyncPort {
	syncAll(cells: CellValue[][]): FormulaBridgeOperationResult;
	setRowOrder(indexOrder: number[]): FormulaBridgeOperationResult<string>;
}

export interface BatchMutationCoordinationDeps {
	getCells(): CellValue[][];
	getColCount(): number;
	applyMutations(mutations: CellMutation[]): void;
	emitOperation(operation: SheetOperation): void;
	formula: FormulaSyncPort | null;
}

export interface HistoryTransitionCoordinationDeps {
	getCells(): CellValue[][];
	emitOperation(operation: SheetOperation): void;
	formula: FormulaSyncPort | null;
	onColumnResize?: (columnId: string, width: number) => void;
	onRowResize?: (rowId: RowId, height: number) => void;
}

/**
 * Preview cells after applying mutations without touching store state.
 * Used so formula sync can validate proposed content before commit.
 */
export function buildCellsAfterMutations(
	cells: CellValue[][],
	colCount: number,
	mutations: CellMutation[],
): CellValue[][] {
	const nextCells = cells.map((row) => [...row]);
	for (const mutation of mutations) {
		while (nextCells.length <= mutation.address.row) {
			nextCells.push(new Array(colCount).fill(null) as CellValue[]);
		}
		const row = nextCells[mutation.address.row];
		if (!row) {
			throw new Error("buildCellsAfterMutations: missing row after pad");
		}
		while (row.length <= mutation.address.col) {
			row.push(null);
		}
		row[mutation.address.col] = mutation.newValue;
	}
	return nextCells;
}

function tryFormulaSync(
	formula: FormulaSyncPort | null,
	run: (port: FormulaSyncPort) => FormulaBridgeOperationResult<string>,
): MutationCoordinationResult {
	if (!formula) return Result.ok(applied(true));

	const result = run(formula);
	if (Result.isError(result)) return result;
	if (!isApplied(result.value)) {
		return Result.ok(noop("formula-sync-noop"));
	}
	return Result.ok(applied(true));
}

/**
 * Forward batch path: sync proposed cells → commit store → emit host operation.
 * On formula sync failure/noop, store and host notification are left unchanged.
 */
export function coordinateBatchMutations(
	deps: BatchMutationCoordinationDeps,
	mutations: CellMutation[],
): MutationCoordinationResult {
	if (mutations.length === 0) {
		return Result.ok(noop("empty-mutations"));
	}

	const syncResult = tryFormulaSync(deps.formula, (formula) =>
		formula.syncAll(
			buildCellsAfterMutations(deps.getCells(), deps.getColCount(), mutations),
		),
	);
	if (Result.isError(syncResult) || isNoop(syncResult.value)) {
		return syncResult;
	}

	deps.applyMutations(mutations);
	deps.emitOperation({ type: "batch-edit", mutations });
	return Result.ok(applied(true));
}

function emitRowChange(
	emitOperation: (operation: SheetOperation) => void,
	rowChange: NonNullable<UndoRedoResult["rowChange"]>,
): void {
	if (rowChange.type === "insertRows") {
		emitOperation({
			type: "row-insert",
			atIndex: rowChange.atIndex,
			count: rowChange.count,
		});
		return;
	}
	emitOperation({
		type: "row-delete",
		atIndex: rowChange.atIndex,
		count: rowChange.count,
	});
}

/**
 * Post-history path for undo/redo: store has already applied the transition.
 * Syncs formula engine to current cells / structure, then emits host operations.
 *
 * Plan 002 constraint: SheetStore.undo()/redo() mutate synchronously before this
 * runs. There is no non-mutating propose API on the store; pure planning exists
 * only in core/history.ts and is not wired to structural application. Sync
 * failure therefore cannot roll local state back through this seam yet.
 */
export function coordinateHistoryTransition(
	deps: HistoryTransitionCoordinationDeps,
	result: UndoRedoResult,
): MutationCoordinationResult {
	let didWork = false;

	if (result.mutations.length > 0) {
		const syncResult = tryFormulaSync(deps.formula, (formula) =>
			formula.syncAll(deps.getCells()),
		);
		if (Result.isError(syncResult) || isNoop(syncResult.value)) {
			return syncResult;
		}
		deps.emitOperation({ type: "batch-edit", mutations: result.mutations });
		didWork = true;
	}

	if (result.rowChange) {
		const syncResult = tryFormulaSync(deps.formula, (formula) =>
			formula.syncAll(deps.getCells()),
		);
		if (Result.isError(syncResult) || isNoop(syncResult.value)) {
			return syncResult;
		}
		emitRowChange(deps.emitOperation, result.rowChange);
		didWork = true;
	}

	if (result.rowReorder) {
		const reorder: RowReorderMutation = result.rowReorder;
		const syncResult = tryFormulaSync(deps.formula, (formula) =>
			formula.setRowOrder(reorder.indexOrder.map(toNumber)),
		);
		if (Result.isError(syncResult) || isNoop(syncResult.value)) {
			return syncResult;
		}
		deps.emitOperation({ type: "row-reorder", mutation: reorder });
		didWork = true;
	}

	if (result.columnResize) {
		deps.onColumnResize?.(result.columnResize.columnId, result.columnResize.width);
		didWork = true;
	}

	if (result.rowResize) {
		deps.onRowResize?.(result.rowResize.rowId, result.rowResize.height);
		didWork = true;
	}

	if (!didWork) {
		return Result.ok(noop("no-transition"));
	}
	return Result.ok(applied(true));
}
