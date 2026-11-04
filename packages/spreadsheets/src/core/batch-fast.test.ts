import { describe, expect, it } from "bun:test";
import { flush } from "solid-js";
import { rowId } from "./brands";
import { createSheetStore } from "./state";

const columns = [
	{ id: "a", header: "A" },
	{ id: "b", header: "B" },
];

describe("distinct batch capability", () => {
	it("preflights duplicates and invalid addresses without writing or recording history", () => {
		const store = createSheetStore([[1, 2]], columns);
		for (const tail of [
			{ row: 0, col: 0, value: 9 },
			{ row: 1, col: 0, value: 9 },
			{ row: 0, col: 2, value: 9 },
		]) {
			expect(
				store.trySetDistinctCells?.([{ row: 0, col: 0, value: 3 }, tail], columns),
			).toBeUndefined();
			expect(store.copyCells()).toEqual([[1, 2]]);
			expect(store.canUndo()).toBe(false);
		}
	});

	it("records ordered mutations, one revision per changed row, and complete undo/redo", () => {
		const store = createSheetStore(
			[
				[1, 2],
				[3, 4],
			],
			columns,
			[rowId("a"), rowId("b")],
		);
		const batch = store.trySetDistinctCells?.(
			[
				{ row: 1, col: 1, value: 8 },
				{ row: 0, col: 0, value: 5 },
				{ row: 1, col: 0, value: 7 },
				{ row: 0, col: 1, value: 2 },
			],
			columns,
		);
		expect(batch?.map((m) => [m.oldValue, m.newValue])).toEqual([
			[4, 8],
			[1, 5],
			[3, 7],
		]);
		flush();
		expect(store.rowRevision(rowId("a"))).toBe(1);
		expect(store.rowRevision(rowId("b"))).toBe(1);
		expect(store.dataRevision()).toBe(1);
		store.undo();
		expect(store.copyCells()).toEqual([
			[1, 2],
			[3, 4],
		]);
		store.redo();
		expect(store.copyCells()).toEqual([
			[5, 2],
			[7, 8],
		]);
		expect(store.trySetDistinctCells?.([{ row: 0, col: 0, value: 5 }], columns)).toEqual([]);
		expect(store.history().undoStack).toHaveLength(1);
	});

	it("writes compact blank tails and packed numeric rows through owned storage", () => {
		for (const data of [
			Array.from({ length: 2 }, () => Array(40).fill(null)),
			Array.from({ length: 45000 }, () => [1, 2]),
		]) {
			const store = createSheetStore(data, columns);
			store.trySetDistinctCells?.([{ row: 1, col: 1, value: "changed" }], columns);
			expect(store.copyCells()[1]?.[1]).toBe("changed");
			store.undo();
			expect(store.copyCells()).toEqual(data);
		}
	});
});
