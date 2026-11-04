import { describe, expect, it } from "bun:test";
import type { CellValue, ColumnDef } from "../types";
import { columnIdx, physicalRow, rowId } from "./brands";
import { createCellRows } from "./cellRows";
import { commitCellEdit } from "./commands";
import { createSheetStore } from "./state";

const count = 60032;
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

describe("compact integer rows", () => {
	it("preserves every CellValue and numbers outside the integer encoding", () => {
		const specials: CellValue[] = [
			-0,
			NaN,
			Infinity,
			-Infinity,
			2147483648,
			-2147483649,
			1.5,
			null,
			false,
			"",
			"=A2",
		];
		for (const value of specials) {
			const data = Array.from({ length: count }, (_, row): CellValue[] => [row, row + 1]);
			const target = data[64];
			if (!target) throw new Error("Missing test row");
			target[0] = value;
			const rows = createCellRows(data);
			expect(Object.is(rows.readCell(64, 0), value)).toBe(true);
			expect(rows.copy()).toEqual(data);
			expect(rows.materialize()).toEqual(data);
		}
	});
	it("keeps integer writes compact and promotes edited blocks without losing values", () => {
		const data = Array.from({ length: count }, (_, row): CellValue[] => [
			row,
			-row - 1,
			2147483647,
		]);
		const rows = createCellRows(data),
			expected = data.map((row) => [...row]);
		expect(rows.readRow(5)).toBeInstanceOf(Int32Array);
		rows.write(5, 1, -2147483648, 3);
		const target = expected[5];
		if (!target) throw new Error("Missing expected row");
		target[1] = -2147483648;
		expect(rows.readRow(5)?.[1]).toBe(-2147483648);
		expect(rows.readRow(5)).toBeInstanceOf(Int32Array);
		expect(data[5]?.[1]).toBe(-6);
		for (let row = 0; row < 64; row++) {
			rows.write(row, 0, `text-${row}`, 3);
			const target = expected[row];
			if (!target) throw new Error("Missing expected row");
			target[0] = `text-${row}`;
		}
		expect(Array.isArray(rows.readRow(100))).toBe(true);
		expect(rows.copy()).toEqual(expected);
		expect(rows.materialize().every(Array.isArray)).toBe(true);
	});
	it("supports different block widths, ragged rows, and partial final blocks", () => {
		const data = Array.from({ length: count + 93 }, (_, row) =>
			Array.from({ length: row < 128 ? 7 : row < 256 ? 13 : 2 }, (_, col) => row * 19 + col),
		);
		data[193]?.push(77);
		const rows = createCellRows(data);
		for (const index of [0, 127, 128, 193, 255, 256, 348, data.length - 1])
			expect(Array.from(rows.readRow(index) ?? [])).toEqual(data[index]);
		expect(rows.readRow(1.5)).toBeUndefined();
		expect(rows.readCell(1.5, 0)).toBeUndefined();
		expect(rows.copy()).toEqual(data);
	});
	it("copies host accessors and custom iterators once while preserving sparse outer rows", () => {
		const data: CellValue[][] = Array.from({ length: count }, (_, row) => [row, 1, 2]);
		let reads = 0,
			iterations = 0;
		const first = data[0],
			second = data[1];
		if (!first || !second) throw new Error("Missing test rows");
		Object.defineProperty(first, 0, {
			configurable: true,
			enumerable: true,
			get: () => {
				reads++;
				return 9;
			},
		});
		second[Symbol.iterator] = function* () {
			iterations++;
			yield 7;
			yield 8;
			yield 9;
		};
		delete data[147];
		const rows = createCellRows(data);
		expect(reads).toBe(1);
		expect(iterations).toBe(1);
		expect(rows.copy()[0]).toEqual([9, 1, 2]);
		expect(rows.copy()[1]).toEqual([7, 8, 9]);
		expect(Object.hasOwn(rows.copy(), 147)).toBe(false);
	});
	it("keeps reads and snapshots correct after repeated window traversal and mixed edits", () => {
		const data = Array.from({ length: count }, (_, row): CellValue[] => [
			row,
			row + 1,
			row + 2,
			row + 3,
		]);
		const rows = createCellRows(data),
			expected = data.map((row) => [...row]);
		for (let row = 0; row < 1500; row++) expect(rows.readRow(row)?.[0]).toBe(row);
		for (let index = 0; index < 700; index++) {
			const row = (index * 97) % data.length,
				col = index % 4,
				value = index % 3 === 0 ? `edit-${index}` : index % 3 === 1 ? -0 : index;
			rows.write(row, col, value, 4);
			const target = expected[row];
			if (!target) throw new Error("Missing expected row");
			target[col] = value;
			expect(Object.is(rows.readCell(row, col), value)).toBe(true);
		}
		expect(rows.copy()).toEqual(expected);
		const copy = rows.copy();
		rows.replace(copy);
		expect(rows.copy()).toEqual(expected);
		rows.replace(rows.values);
		expect(rows.copy()).toEqual(expected);
	});
});
