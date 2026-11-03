import { describe, expect, it } from "bun:test";
import type { CellValue, ColumnDef } from "../types";
import { columnIdx, physicalRow, rowId } from "./brands";
import { createCellRows } from "./cellRows";
import { commitCellEdit } from "./commands";
import { createSheetStore } from "./state";

const count = 4099;
const columns: ColumnDef[] = Array.from({ length: 20 }, (_, col) => ({
	id: `c${col}`,
	header: String(col),
}));
const makeData = (): CellValue[][] =>
	Array.from({ length: count }, (_, row) => Array.from({ length: 20 }, (_, col) => row * 20 + col));

describe("owned cell rows", () => {
	it("owns values before a row is read, without materializing unrelated rows for snapshots", () => {
		const input = makeData();
		const first = input[0];
		const distant = input[4098];
		if (!first || !distant) throw new Error("Missing test row");
		first.splice(0, 5, 0, false, "", null, "=A2");
		delete first[5];
		const expected = input.map((row) => [...row]);
		const rows = createCellRows(input);
		distant[0] = "host mutation";
		expect(rows.readCell(4098, 0)).toBe(4098 * 20);
		expect(rows.values[4098]).toBeUndefined();
		const snapshot = rows.copy();
		expect(snapshot).toEqual(expected);
		expect(Object.hasOwn(snapshot[0] ?? [], 5)).toBe(true);
		expect(rows.values[4098]).toBeUndefined();
		const snapshotRow = snapshot[4098];
		if (!snapshotRow) throw new Error("Missing snapshot row");
		snapshotRow[0] = "snapshot mutation";
		const owned = rows.getRow(4098);
		expect(owned?.[0]).toBe(4098 * 20);
		expect(rows.getRow(4098)).toBe(owned);
		rows.write(4098, 0, "grid mutation", 20);
		expect(distant[0]).toBe("host mutation");
		expect(rows.materialize()[4098]).toBe(owned);
		expect(owned?.[0]).toBe("grid mutation");
	});

	it("keeps values across block edges, row growth, and structural mutation", () => {
		const input = makeData();
		const rows = createCellRows(input);
		for (const index of [0, 127, 128, 255, 256, 4098]) {
			expect(rows.getRow(index)).toEqual(input[index]);
		}
		expect(rows.getRow(-1)).toBeUndefined();
		expect(rows.getRow(count)).toBeUndefined();
		expect(rows.readCell(127, 20)).toBeUndefined();
		rows.write(count, 22, "new", 20);
		expect(rows.copy()[count]).toEqual([...new Array<CellValue>(22).fill(null), "new"]);
		rows.mutate((values) => values.splice(127, 1));
		expect(rows.readCell(127, 0)).toBe(128 * 20);
		expect(rows.readCell(count - 1, 22)).toBe("new");
	});

	it("preserves blank-tail compaction, ragged widths, and independently mutable empty rows", () => {
		const sparse = Array.from({ length: count }, (_, row) => [
			row,
			...new Array<CellValue>(19).fill(null),
		]);
		const compact = createCellRows(sparse);
		expect(compact.getRow(0)?.length).toBe(1);
		expect(compact.copy()[count - 1]).toEqual(sparse[count - 1]);
		const ragged = makeData();
		ragged[count - 1]?.push("extra");
		expect(
			createCellRows(ragged)
				.copy()
				.map((row) => row.length),
		).toEqual(ragged.map((row) => row.length));
		const empty = createCellRows(Array.from({ length: count }, () => []));
		empty.write(128, 0, "one row", 0);
		expect(empty.getRow(127)).toEqual([]);
		expect(empty.getRow(128)).toEqual(["one row"]);
		expect(empty.getRow(129)).toEqual([]);
		expect(new Set(empty.materialize()).size).toBe(count);
	});

	it("keeps host reconciliation and transactional history correct for packed store values", () => {
		const input = makeData();
		const ids = input.map((_, index) => rowId(`r${index}`));
		const store = createSheetStore(input, columns, ids);
		expect(store.reconcileFromHost(input, columns, ids).didChange).toBe(false);
		commitCellEdit(store, physicalRow(4098), columnIdx(3), "edited", columns);
		expect(store.getRowValues(physicalRow(4098))?.[3]).toBe("edited");
		expect(input[4098]?.[3]).toBe(4098 * 20 + 3);
		const transition = store.beginUndo();
		if (!transition) throw new Error("Missing undo transition");
		expect(store.getRowValues(physicalRow(4098))?.[3]).toBe(4098 * 20 + 3);
		transition.rollback();
		expect(store.getRowValues(physicalRow(4098))?.[3]).toBe("edited");
		store.undo();
		expect(store.copyCells()).toEqual(input);
		store.redo();
		expect(store.getRowValues(physicalRow(4098))?.[3]).toBe("edited");
		const host = input.map((row) => [...row]);
		const row = host[128];
		if (!row) throw new Error("Missing host row");
		row[0] = "authoritative";
		store.reconcileFromHost(host, columns, ids);
		expect(store.copyCells()).toEqual(host);
	});

	it("rewrites formulas and preserves rows through insert, delete, reorder, and restore", () => {
		const input = makeData();
		const first = input[0];
		if (!first) throw new Error("Missing formula row");
		first[0] = "=A200";
		const ids = input.map((_, index) => rowId(`r${index}`));
		const store = createSheetStore(input, columns, ids);
		store.insertRows(physicalRow(127), 2);
		expect(store.getRowValues(physicalRow(0))?.[0]).toBe("=A202");
		expect(store.getRowValues(physicalRow(129))).toEqual(input[127]);
		store.deleteRows(physicalRow(127), 2);
		expect(store.copyCells()).toEqual(input);
		store.reorderRows([...ids].reverse());
		expect(store.getRowValues(physicalRow(0))).toEqual(input[count - 1]);
		store.restoreSnapshot(input, ids);
		expect(store.copyCells()).toEqual(input);
		expect(store.rowIds()).toEqual(ids);
	});
});
