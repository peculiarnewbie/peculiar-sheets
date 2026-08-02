import { describe, expect, it } from "bun:test";
import type { CellValue, ColumnDef } from "../types";
import { autoRowId, columnIdx, physicalRow, rowId, visualRow } from "./brands";
import { isProvisionalRowId, validateRowIds } from "./row-identity";
import { selectCell } from "./selection";
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

	it("keeps local history while folding a provisional row ID into a host ID", () => {
		const store = createSheetStore(makeData([["a", 1]]), columns, [rowId("a")]);
		store.insertRows(1, 1);
		store.pushRowOperation(
			{ type: "insertRows", atIndex: 1, count: 1 },
			store.selection(),
			store.selection(),
		);

		store.reconcileFromHost(
			makeData([
				["a", 1],
				["new", null],
			]),
			columns,
			[rowId("a"), rowId("new")],
			{ lastHostRowCount: 1 },
		);

		expect(store.rowIds()).toEqual([rowId("a"), rowId("new")]);
		expect(store.canUndo()).toBe(true);
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

	it("uses one bulk replacement without structural row operations", () => {
		const previousIds = Array.from({ length: 1_000 }, (_, index) => rowId(`old-${index}`));
		const nextIds = Array.from({ length: 10 }, (_, index) => rowId(`new-${index}`));
		const store = createSheetStore(
			previousIds.map((_, index) => [index]),
			columns,
			previousIds,
		);
		const diagnosticHost = globalThis as typeof globalThis & {
			__PECULIAR_SHEETS_RECONCILIATION__?: {
				counts: Record<string, number>;
				durations: Record<string, number>;
			};
		};
		diagnosticHost.__PECULIAR_SHEETS_RECONCILIATION__ = { counts: {}, durations: {} };

		store.reconcileFromHost(
			nextIds.map((_, index) => [`next-${index}`]),
			columns,
			nextIds,
		);

		const profile = diagnosticHost.__PECULIAR_SHEETS_RECONCILIATION__;
		delete diagnosticHost.__PECULIAR_SHEETS_RECONCILIATION__;
		expect(profile?.counts["identity.bulkReplaceCalls"]).toBe(1);
		expect(profile?.counts["structure.bulkCellStoreWrites"]).toBe(1);
		expect(profile?.counts["revision.structuralBumps"]).toBe(1);
		expect(profile?.counts["structure.deleteCalls"] ?? 0).toBe(0);
		expect(profile?.counts["structure.insertCalls"] ?? 0).toBe(0);
		expect(profile?.durations["formula.deleteScan"] ?? 0).toBe(0);
		expect(profile?.durations["formula.insertScan"] ?? 0).toBe(0);
		expect(store.rowIds()).toEqual(nextIds);
		expect(store.cells).toEqual(nextIds.map((_, index) => [`next-${index}`, null]));
	});

	it("keeps the sparse path for stable row identity and only bumps changed rows", () => {
		const ids = Array.from({ length: 100 }, (_, index) => rowId(`row-${index}`));
		const store = createSheetStore(ids.map((_, index) => [index]), columns, ids);
		const nextData: CellValue[][] = ids.map((_, index) => [index]);
		nextData[0] = ["changed-0"];
		nextData[50] = ["changed-50"];
		nextData[99] = ["changed-99"];
		const diagnosticHost = globalThis as typeof globalThis & {
			__PECULIAR_SHEETS_RECONCILIATION__?: {
				counts: Record<string, number>;
				durations: Record<string, number>;
			};
		};
		diagnosticHost.__PECULIAR_SHEETS_RECONCILIATION__ = { counts: {}, durations: {} };

		store.reconcileFromHost(nextData, columns, ids);

		const profile = diagnosticHost.__PECULIAR_SHEETS_RECONCILIATION__;
		delete diagnosticHost.__PECULIAR_SHEETS_RECONCILIATION__;
		expect(profile?.counts["identity.bulkReplaceCalls"] ?? 0).toBe(0);
		expect(profile?.counts["identity.stableCellMutations"]).toBe(3);
		expect(profile?.counts["revision.structuralBumps"] ?? 0).toBe(0);
		expect(store.rowRevision(ids[0]!)).toBe(1);
		expect(store.rowRevision(ids[50]!)).toBe(1);
		expect(store.rowRevision(ids[99]!)).toBe(1);
	});

	it("clears incompatible history and prunes removed identity state during replacement", () => {
		const ids = [rowId("gone"), rowId("retained")];
		const store = createSheetStore([["gone"], ["retained"]], columns, ids);
		store.setSelection(selectCell({ row: visualRow(0), col: columnIdx(0) }));
		store.setCell(physicalRow(0), 0, "edited");
		store.setRowHeight(ids[0], 48);
		store.setRowHeight(ids[1], 52);
		store.pushMutations(
			[{
				address: { row: physicalRow(0), col: columnIdx(0) },
				rowId: ids[0],
				columnId: "col0",
				oldValue: "gone",
				newValue: "edited",
				source: "external",
			}],
			store.selection(),
			store.selection(),
		);

		store.reconcileFromHost([["retained-host"]], columns, [ids[1]!]);

		expect(store.cells).toEqual([["retained-host", null]]);
		expect(store.rowIds()).toEqual([ids[1]]);
		expect(store.rowHeights().has(ids[0]!)).toBe(false);
		expect(store.rowHeights().get(ids[1]!)).toBe(52);
		expect(store.rowRevision(ids[0]!)).toBe(0);
		expect(store.canUndo()).toBe(false);
	});

	it("uses host formula text exactly during a structural replacement", () => {
		const store = createSheetStore(
			[["discard"], ["=A2"], [10]],
			columns,
			[rowId("discard"), rowId("formula"), rowId("value")],
		);

		store.reconcileFromHost(
			[["=A2"], [10]],
			columns,
			[rowId("formula"), rowId("value")],
		);

		expect(store.cells[0]?.[0]).toBe("=A2");
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
