import { describe, expect, it } from "bun:test";
import { columnIdx, physicalRow, rowId, formulaSheetId, visualRow } from "../core/brands";
import { createSheetStore, type HistoryTransitionTransaction } from "../core/state";
import { selectCell } from "../core/selection";
import { FormulaEngineSyncError } from "../internal/errors";
import {
	Result,
	applied,
	isApplied,
	isNoop,
	noop,
} from "../internal/result";
import type { CellMutation, CellValue, ColumnDef, SheetOperation } from "../types";
import {
	buildCellsAfterMutations,
	coordinateBatchMutations,
	coordinateHistoryCommand,
	type FormulaSyncPort,
	type MutationCoordinationResult,
} from "./mutationCoordination";

function expectApplied(result: MutationCoordinationResult): void {
	expect(Result.isOk(result)).toBe(true);
	if (!Result.isOk(result) || !isApplied(result.value)) {
		throw new Error("Expected applied Result");
	}
}

function expectNoop(
	result: MutationCoordinationResult,
	reason: "empty-mutations" | "no-transition" | "formula-sync-noop",
): void {
	expect(Result.isOk(result)).toBe(true);
	if (!Result.isOk(result) || !isNoop(result.value)) {
		throw new Error("Expected noop Result");
	}
	expect(result.value.reason).toBe(reason);
}

function expectError(result: MutationCoordinationResult): void {
	expect(Result.isError(result)).toBe(true);
}

function mutation(
	row: number,
	col: number,
	oldValue: CellValue,
	newValue: CellValue,
): CellMutation {
	return {
		address: { row: physicalRow(row), col: columnIdx(col) },
		columnId: "A",
		oldValue,
		newValue,
		source: "user",
	};
}

function syncError(): FormulaEngineSyncError {
	return new FormulaEngineSyncError({
		operation: "syncAll",
		formulaName: "Sheet1",
		sheetId: formulaSheetId(0),
		message: "sync failed",
	});
}

function createFakeFormula(options?: {
	syncAll?: FormulaSyncPort["syncAll"];
	setRowOrder?: FormulaSyncPort["setRowOrder"];
	failUntil?: number;
}): {
	port: FormulaSyncPort;
	syncAllCalls: CellValue[][][];
	setRowOrderCalls: number[][];
} {
	const syncAllCalls: CellValue[][][] = [];
	const setRowOrderCalls: number[][] = [];
	let syncAttempts = 0;
	return {
		syncAllCalls,
		setRowOrderCalls,
		port: {
			syncAll: (cells) => {
				syncAllCalls.push(cells.map((row) => [...row]));
				syncAttempts += 1;
				if (options?.failUntil !== undefined && syncAttempts <= options.failUntil) {
					return Result.err(syncError());
				}
				return options?.syncAll?.(cells) ?? Result.ok(applied(0));
			},
			setRowOrder: (indexOrder) => {
				setRowOrderCalls.push([...indexOrder]);
				return options?.setRowOrder?.(indexOrder) ?? Result.ok(applied(0));
			},
		},
	};
}

const columns: ColumnDef[] = [{ id: "A", header: "A", width: 100 }];

describe("buildCellsAfterMutations", () => {
	it("overlays proposed values without mutating the source grid", () => {
		const cells: CellValue[][] = [["a", "b"], ["c", "d"]];
		const next = buildCellsAfterMutations(cells, 2, [
			mutation(0, 1, "b", "B"),
			mutation(1, 0, "c", "C"),
		]);

		expect(cells).toEqual([["a", "b"], ["c", "d"]]);
		expect(next).toEqual([["a", "B"], ["C", "d"]]);
	});
});

describe("coordinateBatchMutations", () => {
	it("syncs proposed cells once, then applies store + emits host operation", () => {
		const formula = createFakeFormula();
		const appliedMutations: CellMutation[][] = [];
		const operations: SheetOperation[] = [];
		const cells: CellValue[][] = [["old"]];
		const mutations = [mutation(0, 0, "old", "new")];

		const result = coordinateBatchMutations(
			{
				getCells: () => cells,
				getColCount: () => 1,
				applyMutations: (batch) => {
					appliedMutations.push(batch);
					cells[0]![0] = batch[0]!.newValue;
				},
				emitOperation: (operation) => operations.push(operation),
				formula: formula.port,
			},
			mutations,
		);

		expectApplied(result);
		expect(formula.syncAllCalls).toEqual([[["new"]]]);
		expect(appliedMutations).toEqual([mutations]);
		expect(operations).toEqual([{ type: "batch-edit", mutations }]);
		expect(cells).toEqual([["new"]]);
	});

	it("leaves store and host unchanged when formula sync fails", () => {
		const formula = createFakeFormula({
			syncAll: () => Result.err(syncError()),
		});
		const cells: CellValue[][] = [["old"]];
		const appliedMutations: CellMutation[][] = [];
		const operations: SheetOperation[] = [];
		const mutations = [mutation(0, 0, "old", "new")];

		const result = coordinateBatchMutations(
			{
				getCells: () => cells,
				getColCount: () => 1,
				applyMutations: (batch) => appliedMutations.push(batch),
				emitOperation: (operation) => operations.push(operation),
				formula: formula.port,
			},
			mutations,
		);

		expectError(result);
		expect(appliedMutations).toEqual([]);
		expect(operations).toEqual([]);
		expect(cells).toEqual([["old"]]);
	});

	it("suppresses commit when formula sync returns noop", () => {
		const formula = createFakeFormula({
			syncAll: () => Result.ok(noop("sheet-missing")),
		});
		const appliedMutations: CellMutation[][] = [];
		const operations: SheetOperation[] = [];

		const result = coordinateBatchMutations(
			{
				getCells: () => [["old"]],
				getColCount: () => 1,
				applyMutations: (batch) => appliedMutations.push(batch),
				emitOperation: (operation) => operations.push(operation),
				formula: formula.port,
			},
			[mutation(0, 0, "old", "new")],
		);

		expectNoop(result, "formula-sync-noop");
		expect(appliedMutations).toEqual([]);
		expect(operations).toEqual([]);
	});

	it("no-ops empty mutation batches without touching formula or store", () => {
		const formula = createFakeFormula();
		const appliedMutations: CellMutation[][] = [];
		const operations: SheetOperation[] = [];

		const result = coordinateBatchMutations(
			{
				getCells: () => [],
				getColCount: () => 0,
				applyMutations: (batch) => appliedMutations.push(batch),
				emitOperation: (operation) => operations.push(operation),
				formula: formula.port,
			},
			[],
		);

		expectNoop(result, "empty-mutations");
		expect(formula.syncAllCalls).toEqual([]);
		expect(appliedMutations).toEqual([]);
		expect(operations).toEqual([]);
	});

	it("commits and emits when no formula port is attached", () => {
		const appliedMutations: CellMutation[][] = [];
		const operations: SheetOperation[] = [];
		const mutations = [mutation(0, 0, "old", "new")];

		const result = coordinateBatchMutations(
			{
				getCells: () => [["old"]],
				getColCount: () => 1,
				applyMutations: (batch) => appliedMutations.push(batch),
				emitOperation: (operation) => operations.push(operation),
				formula: null,
			},
			mutations,
		);

		expectApplied(result);
		expect(appliedMutations).toEqual([mutations]);
		expect(operations).toEqual([{ type: "batch-edit", mutations }]);
	});
});

describe("coordinateHistoryCommand", () => {
	it("syncs current cells once and emits batch-edit after successful mutation undo", () => {
		const store = createSheetStore([["old"]], columns);
		store.setSelection(selectCell({ row: visualRow(0), col: columnIdx(0) }));
		const edit = mutation(0, 0, "old", "new");
		store.setCells([{ row: physicalRow(0), col: 0, value: "new" }]);
		store.pushMutations([edit], store.selection(), store.selection());

		const formula = createFakeFormula();
		const operations: SheetOperation[] = [];

		const result = coordinateHistoryCommand({
			beginTransition: () => store.beginUndo(),
			getCells: () => store.cells.map((row) => [...row]),
			emitOperation: (operation) => operations.push(operation),
			formula: formula.port,
		});

		expectApplied(result);
		expect(store.cells[0]?.[0]).toBe("old");
		expect(store.canUndo()).toBe(false);
		expect(store.canRedo()).toBe(true);
		expect(formula.syncAllCalls).toEqual([[["old"]]]);
		expect(operations).toEqual([
			{
				type: "batch-edit",
				mutations: [mutation(0, 0, "new", "old")],
			},
		]);
	});

	it("routes structural row-insert undo through full sync then host notify", () => {
		const store = createSheetStore([["a"], ["b"]], columns);
		store.insertRows(physicalRow(1), 1);
		store.pushRowOperation(
			{ type: "insertRows", atIndex: 1, count: 1 },
			store.selection(),
			store.selection(),
		);

		const formula = createFakeFormula();
		const operations: SheetOperation[] = [];

		const result = coordinateHistoryCommand({
			beginTransition: () => store.beginUndo(),
			getCells: () => store.cells.map((row) => [...row]),
			emitOperation: (operation) => operations.push(operation),
			formula: formula.port,
		});

		expectApplied(result);
		expect(store.rowCount()).toBe(2);
		expect(formula.syncAllCalls).toHaveLength(1);
		expect(operations).toEqual([{ type: "row-delete", atIndex: 1, count: 1 }]);
	});

	it("routes row-reorder undo through setRowOrder then host notify", () => {
		const store = createSheetStore([["a"], ["b"]], columns, [rowId("r0"), rowId("r1")]);
		store.reorderRows([rowId("r1"), rowId("r0")]);
		store.pushRowReorder(
			{
				columnId: "A",
				direction: "asc",
				oldOrder: [rowId("r0"), rowId("r1")],
				newOrder: [rowId("r1"), rowId("r0")],
			},
			store.selection(),
			store.selection(),
		);

		const formula = createFakeFormula();
		const operations: SheetOperation[] = [];

		const result = coordinateHistoryCommand({
			beginTransition: () => store.beginUndo(),
			getCells: () => store.cells.map((row) => [...row]),
			emitOperation: (operation) => operations.push(operation),
			formula: formula.port,
		});

		expectApplied(result);
		expect(store.rowIds()).toEqual([rowId("r0"), rowId("r1")]);
		expect(formula.setRowOrderCalls).toEqual([[1, 0]]);
		expect(operations).toHaveLength(1);
		expect(operations[0]?.type).toBe("row-reorder");
	});

	it("rolls back cells and history when formula sync fails on undo", () => {
		const store = createSheetStore([["old"]], columns);
		const edit = mutation(0, 0, "old", "new");
		store.setCells([{ row: physicalRow(0), col: 0, value: "new" }]);
		store.pushMutations([edit], store.selection(), store.selection());

		const formula = createFakeFormula({
			syncAll: () => Result.err(syncError()),
		});
		const operations: SheetOperation[] = [];

		const result = coordinateHistoryCommand({
			beginTransition: () => store.beginUndo(),
			getCells: () => store.cells.map((row) => [...row]),
			emitOperation: (operation) => operations.push(operation),
			formula: formula.port,
		});

		expectError(result);
		expect(store.cells[0]?.[0]).toBe("new");
		expect(store.canUndo()).toBe(true);
		expect(store.canRedo()).toBe(false);
		expect(operations).toEqual([]);
	});

	it("rolls back structural undo when formula sync fails", () => {
		const store = createSheetStore([["a"], ["b"], ["c"]], columns);
		const previousCells = store.cells.map((row) => [...row]);
		const removedData = store.deleteRows(physicalRow(1), 1);
		store.pushRowOperation(
			{ type: "deleteRows", atIndex: 1, count: 1, removedData, previousCells },
			store.selection(),
			store.selection(),
		);

		const formula = createFakeFormula({
			syncAll: () => Result.err(syncError()),
		});
		const operations: SheetOperation[] = [];
		const preIds = [...store.rowIds()];

		const result = coordinateHistoryCommand({
			beginTransition: () => store.beginUndo(),
			getCells: () => store.cells.map((row) => [...row]),
			emitOperation: (operation) => operations.push(operation),
			formula: formula.port,
		});

		expectError(result);
		expect(store.rowCount()).toBe(2);
		expect(store.cells.map((row) => [...row])).toEqual([["a"], ["c"]]);
		expect(store.rowIds()).toEqual(preIds);
		expect(store.canUndo()).toBe(true);
		expect(store.canRedo()).toBe(false);
		expect(operations).toEqual([]);
	});

	it("retries successfully after clearing an injected formula failure", () => {
		const store = createSheetStore([["old"]], columns);
		const edit = mutation(0, 0, "old", "new");
		store.setCells([{ row: physicalRow(0), col: 0, value: "new" }]);
		store.pushMutations([edit], store.selection(), store.selection());

		const formula = createFakeFormula({ failUntil: 1 });
		const operations: SheetOperation[] = [];

		const failed = coordinateHistoryCommand({
			beginTransition: () => store.beginUndo(),
			getCells: () => store.cells.map((row) => [...row]),
			emitOperation: (operation) => operations.push(operation),
			formula: formula.port,
		});
		expectError(failed);
		expect(store.cells[0]?.[0]).toBe("new");
		expect(store.canUndo()).toBe(true);
		expect(operations).toEqual([]);

		const succeeded = coordinateHistoryCommand({
			beginTransition: () => store.beginUndo(),
			getCells: () => store.cells.map((row) => [...row]),
			emitOperation: (operation) => operations.push(operation),
			formula: formula.port,
		});
		expectApplied(succeeded);
		expect(store.cells[0]?.[0]).toBe("old");
		expect(store.canUndo()).toBe(false);
		expect(store.canRedo()).toBe(true);
		expect(operations).toHaveLength(1);
	});

	it("rolls back redo when formula sync fails, then succeeds on retry", () => {
		const store = createSheetStore([["old"]], columns);
		const edit = mutation(0, 0, "old", "new");
		store.setCells([{ row: physicalRow(0), col: 0, value: "new" }]);
		store.pushMutations([edit], store.selection(), store.selection());
		store.undo();

		expect(store.cells[0]?.[0]).toBe("old");
		expect(store.canRedo()).toBe(true);

		const formula = createFakeFormula({ failUntil: 1 });
		const operations: SheetOperation[] = [];

		const failed = coordinateHistoryCommand({
			beginTransition: () => store.beginRedo(),
			getCells: () => store.cells.map((row) => [...row]),
			emitOperation: (operation) => operations.push(operation),
			formula: formula.port,
		});
		expectError(failed);
		expect(store.cells[0]?.[0]).toBe("old");
		expect(store.canRedo()).toBe(true);
		expect(operations).toEqual([]);

		const succeeded = coordinateHistoryCommand({
			beginTransition: () => store.beginRedo(),
			getCells: () => store.cells.map((row) => [...row]),
			emitOperation: (operation) => operations.push(operation),
			formula: formula.port,
		});
		expectApplied(succeeded);
		expect(store.cells[0]?.[0]).toBe("new");
		expect(store.canUndo()).toBe(true);
		expect(store.canRedo()).toBe(false);
		expect(operations).toHaveLength(1);
	});

	it("no-ops when beginTransition returns null", () => {
		const formula = createFakeFormula();
		const operations: SheetOperation[] = [];

		const result = coordinateHistoryCommand({
			beginTransition: () => null,
			getCells: () => [],
			emitOperation: (operation) => operations.push(operation),
			formula: formula.port,
		});

		expectNoop(result, "no-transition");
		expect(formula.syncAllCalls).toEqual([]);
		expect(operations).toEqual([]);
	});

	it("notifies resize adapters without formula sync", () => {
		const store = createSheetStore([["a"]], columns);
		store.setColumnWidth("A", 120);
		store.pushColumnResize(
			{ columnId: "A", oldWidth: 100, newWidth: 120 },
			store.selection(),
			store.selection(),
		);

		const formula = createFakeFormula();
		const columnResizes: Array<{ columnId: string; width: number }> = [];

		const result = coordinateHistoryCommand({
			beginTransition: () => store.beginUndo(),
			getCells: () => store.cells.map((row) => [...row]),
			emitOperation: () => {
				throw new Error("should not emit sheet operation for resize-only");
			},
			formula: formula.port,
			onColumnResize: (columnId, width) => columnResizes.push({ columnId, width }),
		});

		expectApplied(result);
		expect(formula.syncAllCalls).toEqual([]);
		expect(columnResizes).toEqual([{ columnId: "A", width: 100 }]);
		expect(store.columnWidths().get("A")).toBe(100);
	});

	it("rolls back a fake transaction when sync fails before emit", () => {
		let rolledBack = false;
		const transaction: HistoryTransitionTransaction = {
			result: { mutations: [mutation(0, 0, "new", "old")] },
			rollback: () => {
				rolledBack = true;
			},
		};
		const formula = createFakeFormula({
			syncAll: () => Result.err(syncError()),
		});
		const operations: SheetOperation[] = [];

		const result = coordinateHistoryCommand({
			beginTransition: () => transaction,
			getCells: () => [["old"]],
			emitOperation: (operation) => operations.push(operation),
			formula: formula.port,
		});

		expectError(result);
		expect(rolledBack).toBe(true);
		expect(operations).toEqual([]);
	});
});
