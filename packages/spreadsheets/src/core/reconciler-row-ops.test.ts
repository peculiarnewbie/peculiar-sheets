/**
 * Reconciler + row operation tests.
 *
 * IMPORTANT: SolidJS `createEffect` does NOT fire in Bun's test runner (no DOM
 * scheduler). Since `createReconciler` is implemented as a reactive effect, it
 * cannot be exercised as a unit test.
 *
 * The reconciler / row-operation interaction (Bug C — pending row ops blocking
 * host shrink on discard) is covered in `createReconciler` via `lastHostRowCount`.
 * Solid effects cannot run here — see tests/e2e/formula-rows.test.ts for E2E.
 *
 * This file contains STRUCTURAL unit tests for the reconciler-adjacent logic
 * that CAN run without SolidJS effects — specifically, that `resizeGrid` does
 * the right thing when called directly, and that the store tracks row
 * operations correctly for the reconciler to respect.
 */
import { describe, expect, it } from "bun:test";
import type { CellValue, ColumnDef } from "../types";
import { createSheetStore } from "./state";

function makeColumns(count: number): ColumnDef[] {
	return Array.from({ length: count }, (_, i) => ({
		id: `col${i}`,
		header: `Col ${i}`,
		editable: true,
	}));
}

describe("resizeGrid after insertRows (structural)", () => {
	it("resizeGrid to fewer rows than the store currently has deletes trailing rows", () => {
		const columns = makeColumns(2);
		const store = createSheetStore(
			[
				["a", 1],
				["b", 2],
				["c", 3],
			],
			columns,
		);

		store.insertRows(1, 1);
		expect(store.rowCount()).toBe(4);

		// This is what the reconciler does when it sees fewer rows in host data.
		// Today: it nukes the inserted row (Bug C).
		// After the fix: it should NOT be called when the difference is from
		// an internal row operation.
		store.resizeGrid(3, 2);

		// Current behavior: store is now 3 rows (inserted row lost)
		// This test documents the current (broken) behavior.
		// When Bug C is fixed, resizeGrid should either:
		//   (a) not be called by the reconciler in this case, or
		//   (b) be smart enough to preserve internal inserts.
		expect(store.rowCount()).toBe(3);
	});

	it("resizeGrid preserves data when growing", () => {
		const columns = makeColumns(2);
		const store = createSheetStore(
			[
				["a", 1],
				["b", 2],
			],
			columns,
		);

		store.resizeGrid(4, 2);

		expect(store.rowCount()).toBe(4);
		expect(store.cells[0]?.[0]).toBe("a");
		expect(store.cells[1]?.[0]).toBe("b");
		expect(store.cells[2]?.[0]).toBeNull();
		expect(store.cells[3]?.[0]).toBeNull();
	});
});

describe("insertRows / deleteRows track dimensions correctly", () => {
	it("insertRows increases rowCount", () => {
		const columns = makeColumns(2);
		const store = createSheetStore([["a", 1]], columns);

		store.insertRows(0, 3);
		expect(store.rowCount()).toBe(4);
	});

	it("deleteRows decreases rowCount", () => {
		const columns = makeColumns(2);
		const store = createSheetStore(
			[
				["a", 1],
				["b", 2],
				["c", 3],
			],
			columns,
		);

		store.deleteRows(1, 1);
		expect(store.rowCount()).toBe(2);
	});

	it("insert then delete returns to original rowCount", () => {
		const columns = makeColumns(2);
		const store = createSheetStore(
			[
				["a", 1],
				["b", 2],
			],
			columns,
		);

		store.insertRows(1, 2);
		expect(store.rowCount()).toBe(4);

		store.deleteRows(1, 2);
		expect(store.rowCount()).toBe(2);
		expect(store.cells[0]?.[0]).toBe("a");
		expect(store.cells[1]?.[0]).toBe("b");
	});
});
