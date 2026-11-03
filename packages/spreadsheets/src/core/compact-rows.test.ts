import { describe, expect, it } from "bun:test";
import type { CellValue, ColumnDef } from "../types";
import { physicalRow, type RowId, rowId } from "./brands";
import { createSheetStore } from "./state";

const columns: ColumnDef[] = Array.from({ length: 64 }, (_, index) => ({
	id: `c${index}`,
	header: String(index),
}));
function sparseRow(value: CellValue): CellValue[] {
	const row = new Array<CellValue>(64).fill(null);
	row[0] = value;
	return row;
}

describe("owned sparse rows", () => {
	it("owns input values and preserves complete independent snapshots", () => {
		const input = sparseRow("owned");
		const expected = [...input];
		const store = createSheetStore([input], columns);
		const owned = store.getRowValues(physicalRow(0));
		input[0] = "host mutation";
		input[40] = 99;
		expect(owned?.[0]).toBe("owned");
		expect(owned?.length).toBeLessThan(input.length);
		const snapshot = store.copyCells();
		expect(snapshot).toEqual([expected]);
		const snapshotRow = snapshot[0];
		if (!snapshotRow) throw new Error("Snapshot row missing");
		snapshotRow[0] = "snapshot mutation";
		expect(owned?.[0]).toBe("owned");
		expect(store.cells).toEqual([expected]);
		expect(store.cells[0]).toBe(owned);
	});

	it("preserves blank tails through editing, identity reconciliation, and reordering", () => {
		const first = sparseRow("first");
		const second = sparseRow("second");
		const ids: [RowId, RowId] = [rowId("first"), rowId("second")];
		const store = createSheetStore([first, second], columns, ids);
		store.setCell(physicalRow(0), 63, 42);
		expect(store.copyCells()[0]?.[63]).toBe(42);
		expect(first[63]).toBeNull();
		store.setCell(physicalRow(0), 63, null);
		store.reconcileFromHost([second, first], columns, [ids[1], ids[0]]);
		expect(store.copyCells()).toEqual([second, first]);
		store.reorderRows(ids);
		expect(store.copyCells()).toEqual([first, second]);
	});

	it("restores complete deleted rows through history", () => {
		const ids: [RowId, RowId] = [rowId("first"), rowId("second")];
		const store = createSheetStore([sparseRow("first"), sparseRow("second")], columns, ids);
		const previousCells = store.copyCells();
		const before = store.selection();
		const removedData = store.deleteRows(physicalRow(0), 1);
		expect(removedData).toEqual([previousCells[0]]);
		store.pushRowOperation(
			{ type: "deleteRows", atIndex: 0, count: 1, removedData, previousCells },
			before,
			store.selection(),
		);
		store.undo();
		expect(store.copyCells()).toEqual(previousCells);
	});

	it("keeps ragged input widths, extra columns, and undefined prefix slots intact", () => {
		const holes = new Array<CellValue>(64).fill(null, 2);
		holes[0] = "prefix";
		const extra = new Array<CellValue>(80).fill(null);
		extra[63] = "last schema value";
		const data = [
			holes,
			["short"],
			extra,
			sparseRow(0),
			sparseRow(false),
			sparseRow(""),
			sparseRow(null),
		];
		const expected = data.map((row) => [...row]);
		const store = createSheetStore(data, columns);
		expect(store.copyCells()).toEqual(expected);
		expect(store.cells).toEqual(expected);
		expect(store.cells.map((row) => row.length)).toEqual([64, 1, 80, 64, 64, 64, 64]);
	});
});
