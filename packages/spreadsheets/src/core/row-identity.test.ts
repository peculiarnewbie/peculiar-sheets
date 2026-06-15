import { describe, expect, it } from "bun:test";
import type { CellValue, ColumnDef } from "../types";
import { autoRowId, rowId } from "./brands";
import { isProvisionalRowId, validateRowIds } from "./row-identity";
import { createSheetStore } from "./state";

function makeColumns(count: number): ColumnDef[] {
	return Array.from({ length: count }, (_, i) => ({
		id: `col${i}`,
		header: `Col ${i}`,
		editable: true,
	}));
}

function makeData(rows: CellValue[][]): CellValue[][] {
	return rows.map((row) => [...row]);
}

describe("validateRowIds", () => {
	it("throws on length mismatch", () => {
		expect(() => validateRowIds([rowId("a")], 2)).toThrow(/length/);
	});

	it("throws on duplicate keys", () => {
		expect(() => validateRowIds([rowId("a"), rowId("a")], 2)).toThrow(/Duplicate/);
	});
});

describe("identity reconciliation via reconcileFromHost", () => {
	const columns = makeColumns(2);

	it("removes a row when host drops its string key", () => {
		const store = createSheetStore(
			makeData([
				["a", 1],
				["b", 2],
				["c", 3],
			]),
			columns,
			[rowId("a"), rowId("b"), rowId("c")],
		);

		store.reconcileFromHost(
			makeData([
				["a", 1],
				["c", 3],
			]),
			columns,
			[rowId("a"), rowId("c")],
		);

		expect(store.rowIds()).toEqual([rowId("a"), rowId("c")]);
		expect(store.cells[0]?.[0]).toBe("a");
		expect(store.cells[1]?.[0]).toBe("c");
	});

	it("reorders rows when host permutes keys", () => {
		const store = createSheetStore(
			makeData([
				["a", 1],
				["b", 2],
				["c", 3],
			]),
			columns,
			[rowId("a"), rowId("b"), rowId("c")],
		);

		store.reconcileFromHost(
			makeData([
				["c", 3],
				["a", 1],
				["b", 2],
			]),
			columns,
			[rowId("c"), rowId("a"), rowId("b")],
		);

		expect(store.rowIds()).toEqual([rowId("c"), rowId("a"), rowId("b")]);
		expect(store.cells[0]?.[0]).toBe("c");
		expect(store.cells[1]?.[0]).toBe("a");
		expect(store.cells[2]?.[0]).toBe("b");
	});

	it("inserts a row at the host index with empty cells", () => {
		const store = createSheetStore(
			makeData([
				["a", 1],
				["c", 3],
			]),
			columns,
			[rowId("a"), rowId("c")],
		);

		store.reconcileFromHost(
			makeData([
				["a", 1],
				[null, null],
				["c", 3],
			]),
			columns,
			[rowId("a"), rowId("new"), rowId("c")],
		);

		expect(store.rowIds()).toEqual([rowId("a"), rowId("new"), rowId("c")]);
		expect(store.cells[1]?.[0]).toBeNull();
		expect(store.cells[2]?.[0]).toBe("c");
	});

	it("replaces provisional insert keys when host assigns a domain key", () => {
		const store = createSheetStore(
			makeData([["a", 1]]),
			columns,
			[rowId("a")],
		);

		store.insertRows(1, 1);
		const provisional = store.rowIds()[1];
		expect(provisional).toBeDefined();
		expect(isProvisionalRowId(provisional!)).toBe(true);

		store.reconcileFromHost(
			makeData([
				["a", 1],
				[null, null],
			]),
			columns,
			[rowId("a"), rowId("NewRow")],
		);

		expect(store.rowIds()).toEqual([rowId("a"), rowId("NewRow")]);
		expect(store.rowCount()).toBe(2);
	});

	it("discards a staged row when host shrinks after adopting the new key", () => {
		const store = createSheetStore(
			makeData([["a", 1]]),
			columns,
			[rowId("a")],
		);

		store.insertRows(1, 1);
		store.reconcileFromHost(
			makeData([
				["a", 1],
				[null, null],
			]),
			columns,
			[rowId("a"), rowId("NewRow")],
			{ lastHostRowCount: 1 },
		);
		expect(store.rowIds()).toEqual([rowId("a"), rowId("NewRow")]);

		store.reconcileFromHost(
			makeData([["a", 1]]),
			columns,
			[rowId("a")],
			{ lastHostRowCount: 2 },
		);

		expect(store.rowCount()).toBe(1);
		expect(store.rowIds()).toEqual([rowId("a")]);
	});
});

describe("auto-generated row IDs", () => {
	it("uses string indices when rowIds omitted", () => {
		const columns = makeColumns(2);
		const store = createSheetStore(makeData([["a", 1]]), columns);
		expect(store.hasHostRowIds()).toBe(false);
		expect(store.rowIds()).toEqual([autoRowId(0)]);
	});
});
