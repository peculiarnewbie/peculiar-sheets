import { describe, expect, it } from "bun:test";
import type { ColumnDef } from "../types";
import { physicalRow, rowId } from "./brands";
import { createSheetStore } from "./state";

function makeColumns(count: number): ColumnDef[] {
	return Array.from({ length: count }, (_, i) => ({
		id: `col${i}`,
		header: `Col ${i}`,
		editable: true,
	}));
}

describe("row-granular cell revisions", () => {
	it("bumps only affected row revisions on independent cell writes", () => {
		const store = createSheetStore(
			[
				["a", 1],
				["b", 2],
				["c", 3],
			],
			makeColumns(2),
			[rowId("r0"), rowId("r1"), rowId("r2")],
		);

		expect(store.rowRevision(rowId("r0"))).toBe(0);
		expect(store.rowRevision(rowId("r1"))).toBe(0);
		expect(store.structuralRevision()).toBe(0);
		expect(store.dataRevision()).toBe(0);

		store.setCell(physicalRow(1), 0, "b2");

		expect(store.rowRevision(rowId("r0"))).toBe(0);
		expect(store.rowRevision(rowId("r1"))).toBe(1);
		expect(store.rowRevision(rowId("r2"))).toBe(0);
		expect(store.structuralRevision()).toBe(0);
		expect(store.dataRevision()).toBe(1);

		store.setCells([
			{ row: physicalRow(0), col: 1, value: 10 },
			{ row: physicalRow(2), col: 1, value: 30 },
		]);

		expect(store.rowRevision(rowId("r0"))).toBe(1);
		expect(store.rowRevision(rowId("r1"))).toBe(1);
		expect(store.rowRevision(rowId("r2"))).toBe(1);
		expect(store.structuralRevision()).toBe(0);
		expect(store.dataRevision()).toBe(2);
	});

	it("bumps structural revision on insert/delete without touching unrelated row revisions", () => {
		const store = createSheetStore(
			[
				["a"],
				["b"],
			],
			makeColumns(1),
			[rowId("r0"), rowId("r1")],
		);

		store.setCell(physicalRow(0), 0, "a2");
		expect(store.rowRevision(rowId("r0"))).toBe(1);
		expect(store.structuralRevision()).toBe(0);

		store.insertRows(physicalRow(1), 1);
		expect(store.structuralRevision()).toBe(1);
		expect(store.rowRevision(rowId("r0"))).toBe(1);
		expect(store.rowRevision(rowId("r1"))).toBe(0);
		expect(store.dataRevision()).toBe(2);

		store.deleteRows(physicalRow(1), 1);
		expect(store.structuralRevision()).toBe(2);
		expect(store.rowRevision(rowId("r0"))).toBe(1);
		expect(store.dataRevision()).toBe(3);
	});

	it("forgets row revision entries for deleted row ids", () => {
		const store = createSheetStore(
			[["a"], ["b"]],
			makeColumns(1),
			[rowId("r0"), rowId("r1")],
		);

		store.setCell(physicalRow(1), 0, "b2");
		expect(store.rowRevision(rowId("r1"))).toBe(1);

		store.deleteRows(physicalRow(1), 1);
		expect(store.rowRevision(rowId("r1"))).toBe(0);
		expect(store.rowIds()).toEqual([rowId("r0")]);
	});
});
