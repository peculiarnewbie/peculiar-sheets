import { describe, expect, it } from "bun:test";
import { columnIdx, physicalRow, rowId, formulaSheetId } from "../core/brands";
import type { UndoRedoResult } from "../core/state";
import { FormulaEngineSyncError } from "../internal/errors";
import {
	Result,
	applied,
	isApplied,
	isNoop,
	noop,
} from "../internal/result";
import type { CellMutation, CellValue, SheetOperation } from "../types";
import {
	buildCellsAfterMutations,
	coordinateBatchMutations,
	coordinateHistoryTransition,
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
}): {
	port: FormulaSyncPort;
	syncAllCalls: CellValue[][][];
	setRowOrderCalls: number[][];
} {
	const syncAllCalls: CellValue[][][] = [];
	const setRowOrderCalls: number[][] = [];
	return {
		syncAllCalls,
		setRowOrderCalls,
		port: {
			syncAll: (cells) => {
				syncAllCalls.push(cells.map((row) => [...row]));
				return options?.syncAll?.(cells) ?? Result.ok(applied(0));
			},
			setRowOrder: (indexOrder) => {
				setRowOrderCalls.push([...indexOrder]);
				return options?.setRowOrder?.(indexOrder) ?? Result.ok(applied(0));
			},
		},
	};
}

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

describe("coordinateHistoryTransition", () => {
	it("syncs current cells once and emits batch-edit after successful mutation undo", () => {
		const formula = createFakeFormula();
		const operations: SheetOperation[] = [];
		const cells: CellValue[][] = [["restored"]];
		const mutations = [mutation(0, 0, "new", "restored")];
		const transition: UndoRedoResult = { mutations };

		const result = coordinateHistoryTransition(
			{
				getCells: () => cells,
				emitOperation: (operation) => operations.push(operation),
				formula: formula.port,
			},
			transition,
		);

		expectApplied(result);
		expect(formula.syncAllCalls).toEqual([[["restored"]]]);
		expect(operations).toEqual([{ type: "batch-edit", mutations }]);
	});

	it("routes structural row-insert transitions through full sync then host notify", () => {
		const formula = createFakeFormula();
		const operations: SheetOperation[] = [];
		const cells: CellValue[][] = [["a"], ["b"], ["c"]];

		const result = coordinateHistoryTransition(
			{
				getCells: () => cells,
				emitOperation: (operation) => operations.push(operation),
				formula: formula.port,
			},
			{
				mutations: [],
				rowChange: { type: "insertRows", atIndex: 1, count: 1 },
			},
		);

		expectApplied(result);
		expect(formula.syncAllCalls).toEqual([cells]);
		expect(operations).toEqual([{ type: "row-insert", atIndex: 1, count: 1 }]);
	});

	it("routes row-reorder transitions through setRowOrder then host notify", () => {
		const formula = createFakeFormula();
		const operations: SheetOperation[] = [];
		const rowReorder = {
			columnId: "A",
			direction: "asc" as const,
			oldOrder: [rowId("0"), rowId("1")],
			newOrder: [rowId("1"), rowId("0")],
			indexOrder: [physicalRow(1), physicalRow(0)],
			source: "undo" as const,
		};

		const result = coordinateHistoryTransition(
			{
				getCells: () => [["a"], ["b"]],
				emitOperation: (operation) => operations.push(operation),
				formula: formula.port,
			},
			{ mutations: [], rowReorder },
		);

		expectApplied(result);
		expect(formula.setRowOrderCalls).toEqual([[1, 0]]);
		expect(operations).toEqual([{ type: "row-reorder", mutation: rowReorder }]);
	});

	it("suppresses host operation when formula sync fails after history already applied", () => {
		const formula = createFakeFormula({
			syncAll: () => Result.err(syncError()),
		});
		const operations: SheetOperation[] = [];
		const mutations = [mutation(0, 0, "new", "restored")];

		const result = coordinateHistoryTransition(
			{
				getCells: () => [["restored"]],
				emitOperation: (operation) => operations.push(operation),
				formula: formula.port,
			},
			{ mutations },
		);

		expectError(result);
		expect(operations).toEqual([]);
	});

	it("no-ops when the history transition carries no work", () => {
		const formula = createFakeFormula();
		const operations: SheetOperation[] = [];

		const result = coordinateHistoryTransition(
			{
				getCells: () => [],
				emitOperation: (operation) => operations.push(operation),
				formula: formula.port,
			},
			{ mutations: [] },
		);

		expectNoop(result, "no-transition");
		expect(formula.syncAllCalls).toEqual([]);
		expect(operations).toEqual([]);
	});

	it("notifies resize adapters without formula sync", () => {
		const formula = createFakeFormula();
		const columnResizes: Array<{ columnId: string; width: number }> = [];
		const rowResizes: Array<{ rowId: string; height: number }> = [];

		const result = coordinateHistoryTransition(
			{
				getCells: () => [],
				emitOperation: () => {
					throw new Error("should not emit sheet operation for resize-only");
				},
				formula: formula.port,
				onColumnResize: (columnId, width) => columnResizes.push({ columnId, width }),
				onRowResize: (id, height) => rowResizes.push({ rowId: id, height }),
			},
			{
				mutations: [],
				columnResize: { columnId: "A", width: 120 },
				rowResize: { rowId: rowId("r1"), height: 40 },
			},
		);

		expectApplied(result);
		expect(formula.syncAllCalls).toEqual([]);
		expect(columnResizes).toEqual([{ columnId: "A", width: 120 }]);
		expect(rowResizes).toEqual([{ rowId: "r1", height: 40 }]);
	});
});

describe("Plan 002 failure contract (pending)", () => {
	/**
	 * Desired end-state after a failed undo/redo formula sync:
	 * local cells and history remain at pre-command values, and no host
	 * operation is emitted. SheetStore.undo()/redo() currently mutate
	 * synchronously before coordination, so this seam cannot enforce rollback yet.
	 */
	it.skip("TODO(Plan 002): undo keeps pre-command cells/history when formula sync fails", () => {
		const preCommandCells: CellValue[][] = [["committed"]];
		const cells = preCommandCells.map((row) => [...row]);
		const historyDepth = { undo: 1, redo: 0 };
		const operations: SheetOperation[] = [];

		// Stand-in for the eventual propose→sync→commit API.
		const proposed: UndoRedoResult = {
			mutations: [mutation(0, 0, "committed", "previous")],
		};
		cells[0]![0] = "previous";
		historyDepth.undo = 0;
		historyDepth.redo = 1;

		const formula = createFakeFormula({
			syncAll: () => Result.err(syncError()),
		});
		coordinateHistoryTransition(
			{
				getCells: () => cells,
				emitOperation: (operation) => operations.push(operation),
				formula: formula.port,
			},
			proposed,
		);

		// Plan 002 must restore these after sync failure:
		expect(cells).toEqual(preCommandCells);
		expect(historyDepth).toEqual({ undo: 1, redo: 0 });
		expect(operations).toEqual([]);
	});

	it.skip("TODO(Plan 002): redo keeps pre-command cells/history when formula sync fails", () => {
		const preCommandCells: CellValue[][] = [["previous"]];
		const cells = preCommandCells.map((row) => [...row]);
		const historyDepth = { undo: 0, redo: 1 };
		const operations: SheetOperation[] = [];

		const proposed: UndoRedoResult = {
			mutations: [mutation(0, 0, "previous", "committed")],
		};
		cells[0]![0] = "committed";
		historyDepth.undo = 1;
		historyDepth.redo = 0;

		const formula = createFakeFormula({
			syncAll: () => Result.err(syncError()),
		});
		coordinateHistoryTransition(
			{
				getCells: () => cells,
				emitOperation: (operation) => operations.push(operation),
				formula: formula.port,
			},
			proposed,
		);

		expect(cells).toEqual(preCommandCells);
		expect(historyDepth).toEqual({ undo: 0, redo: 1 });
		expect(operations).toEqual([]);
	});
});
