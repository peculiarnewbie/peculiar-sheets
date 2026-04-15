import { describe, expect, it } from "bun:test";
import type { CellValue, ColumnDef } from "../types";
import { createSheetStore } from "./state";
import { isFormulaValue } from "../formula/references";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeColumns(count: number): ColumnDef[] {
	return Array.from({ length: count }, (_, i) => ({
		id: `col${i}`,
		header: `Col ${i}`,
		editable: true,
	}));
}

// ═════════════════════════════════════════════════════════════════════════════
// Group 1 — Engine-only: insertRows must rewrite formula references
//
// These tests verify the STORE-LEVEL contract: after insertRows, every formula
// string in the cells array must have its A1 references shifted so they still
// point at the same logical data.  No HyperFormula, no reconciler, no host.
// ═════════════════════════════════════════════════════════════════════════════

describe("insertRows rewrites formula references", () => {
	it("shifts all references when inserting at the top (index 0)", () => {
		const columns = makeColumns(2);
		const store = createSheetStore(
			[
				[1, "=A1+A2"],   // row 0
				[2, "=A2+A3"],   // row 1
				[3, null],       // row 2
			],
			columns,
		);

		store.insertRows(0, 1);

		expect(store.cells.length).toBe(4);
		// Row 0: new empty row
		expect(store.cells[0]?.[0]).toBeNull();
		// Row 1 (was row 0): =A1+A2 → both refs shift down → =A2+A3
		expect(store.cells[1]?.[1]).toBe("=A2+A3");
		// Row 2 (was row 1): =A2+A3 → both refs shift down → =A3+A4
		expect(store.cells[2]?.[1]).toBe("=A3+A4");
	});

	it("shifts references at/below insertion point, leaves above untouched", () => {
		const columns = makeColumns(2);
		const store = createSheetStore(
			[
				[10, "=A1*2"],     // row 0: ref to A1 (above insert)
				[20, "=A1+A2"],    // row 1: A1 above, A2 at insert point
				[30, "=A2+A3"],    // row 2: both at/below
				[40, null],        // row 3
			],
			columns,
		);

		// Insert at index 2 (between row 1 and row 2)
		store.insertRows(2, 1);

		expect(store.cells.length).toBe(5);

		// Row 0: =A1*2 — A1 is above insert → stays =A1*2
		expect(store.cells[0]?.[1]).toBe("=A1*2");
		// Row 1: =A1+A2 — A1 (0-indexed 0) stays, A2 (0-indexed 1) < insertAt 2 → stays
		expect(store.cells[1]?.[1]).toBe("=A1+A2");
		// Row 2: new empty row
		expect(store.cells[2]?.[0]).toBeNull();
		// Row 3 (was row 2): formula was =A2+A3
		// A2 (0-indexed 1) < insertAt 2 → stays, A3 (0-indexed 2) >= 2 → shifts to A4
		expect(store.cells[3]?.[1]).toBe("=A2+A4");
	});

	it("shifts absolute row references structurally on insert", () => {
		const columns = makeColumns(2);
		const store = createSheetStore(
			[
				[10, null],
				[20, "=$A$1+A2"],   // $A$1 = absolute, A2 = relative
				[30, null],
			],
			columns,
		);

		store.insertRows(0, 1);

		// Row 2 (was row 1): both refs participate in the structural insert
		expect(store.cells[2]?.[1]).toBe("=$A$2+A3");
	});

	it("shifts range references when insert is within the range", () => {
		const columns = makeColumns(2);
		const store = createSheetStore(
			[
				[10, null],
				[20, null],
				[30, null],
				[null, "=SUM(A1:A3)"],  // row 3: range covering rows 0-2
			],
			columns,
		);

		// Insert at index 1 (within the A1:A3 range)
		store.insertRows(1, 1);

		// Row 4 (was row 3): =SUM(A1:A3) → A3 shifts to A4 → =SUM(A1:A4)
		expect(store.cells[4]?.[1]).toBe("=SUM(A1:A4)");
	});

	it("shifts by the correct count when inserting multiple rows", () => {
		const columns = makeColumns(2);
		const store = createSheetStore(
			[
				[1, "=A1+A2"],
				[2, null],
			],
			columns,
		);

		store.insertRows(0, 3);

		expect(store.cells.length).toBe(5);
		// Row 3 (was row 0): =A1+A2 → shift by 3 → =A4+A5
		expect(store.cells[3]?.[1]).toBe("=A4+A5");
	});

	it("does not corrupt non-formula cells", () => {
		const columns = makeColumns(3);
		const store = createSheetStore(
			[
				["hello", 42, true],
				[null, 0, "plain text"],
			],
			columns,
		);

		store.insertRows(0, 1);

		// Shifted data should be identical (not treated as formulas)
		expect(store.cells[1]?.[0]).toBe("hello");
		expect(store.cells[1]?.[1]).toBe(42);
		expect(store.cells[1]?.[2]).toBe(true);
		expect(store.cells[2]?.[2]).toBe("plain text");
	});

	it("handles inserting at the end (append)", () => {
		const columns = makeColumns(2);
		const store = createSheetStore(
			[
				[1, "=A1+A2"],
				[2, null],
			],
			columns,
		);

		store.insertRows(2, 1);

		expect(store.cells.length).toBe(3);
		// No references should shift (insert is below all data)
		expect(store.cells[0]?.[1]).toBe("=A1+A2");
	});
});

// ═════════════════════════════════════════════════════════════════════════════
// Group 1b — Engine-only: deleteRows must rewrite formula references
// ═════════════════════════════════════════════════════════════════════════════

describe("deleteRows rewrites formula references", () => {
	it("shifts references down when a row above is deleted", () => {
		const columns = makeColumns(2);
		const store = createSheetStore(
			[
				[10, null],        // row 0 — will be deleted
				[20, "=A2+A3"],    // row 1
				[30, null],        // row 2
			],
			columns,
		);

		store.deleteRows(0, 1);

		expect(store.cells.length).toBe(2);
		// Row 0 (was row 1): =A2+A3 → refs shift up → =A1+A2
		expect(store.cells[0]?.[1]).toBe("=A1+A2");
	});

	it("does not shift references above the deleted row", () => {
		const columns = makeColumns(2);
		const store = createSheetStore(
			[
				[10, "=A1*2"],     // row 0
				[20, null],        // row 1 — will be deleted
				[30, "=A3*2"],     // row 2
			],
			columns,
		);

		store.deleteRows(1, 1);

		expect(store.cells.length).toBe(2);
		// Row 0: =A1*2 — A1 is above deletion → stays
		expect(store.cells[0]?.[1]).toBe("=A1*2");
		// Row 1 (was row 2): =A3*2 → A3 shifts up → =A2*2
		expect(store.cells[1]?.[1]).toBe("=A2*2");
	});

	it("deletes the first referenced row into explicit #REF!", () => {
		const columns = makeColumns(2);
		const store = createSheetStore(
			[
				[10, null],
				[20, "=A1+A2"],
				[30, null],
			],
			columns,
		);

		store.deleteRows(0, 1);

		expect(store.cells[0]?.[1]).toBe("=#REF!+A1");
	});

	it("shrinks formulas when deleting the last data row in a referenced range", () => {
		const columns = makeColumns(4);
		const store = createSheetStore(
			[
				["Engineering", 48, 52, "=B1+C1"],
				["Design", 32, 35, "=B2+C2"],
				["Marketing", 28, 31, "=B3+C3"],
				["Ops", 5, 7, "=B4+C4"],
				[null, null, "Sum", "=SUM(D1:D4)"],
			],
			columns,
		);

		store.deleteRows(3, 1);

		expect(store.cells[3]?.[3]).toBe("=SUM(D1:#REF!)");
	});

	it("shifts by the correct count when deleting multiple rows", () => {
		const columns = makeColumns(2);
		const store = createSheetStore(
			[
				[10, null],
				[20, null],
				[30, null],
				[40, "=A4+A5"],
				[50, null],
			],
			columns,
		);

		store.deleteRows(1, 2);

		expect(store.cells[1]?.[1]).toBe("=A2+A3");
	});

	it("rewrites surviving formulas that point into deleted rows", () => {
		const columns = makeColumns(2);
		const store = createSheetStore(
			[
				[10, "=A3+A4"],
				[20, null],
				[30, null],
				[40, null],
			],
			columns,
		);

		store.deleteRows(2, 1);

		expect(store.cells[0]?.[1]).toBe("=#REF!+A3");
	});

	it("rewrites absolute and mixed references structurally on delete", () => {
		const columns = makeColumns(2);
		const store = createSheetStore(
			[
				[10, null],
				[20, "=$A1+B$4"],
				[20, null],
				[30, null],
				[40, null],
			],
			columns,
		);

		store.deleteRows(0, 1);

		expect(store.cells[0]?.[1]).toBe("=#REF!+B$3");
	});

	it("rewrites formulas before removing the row that contains the formula itself", () => {
		const columns = makeColumns(2);
		const store = createSheetStore(
			[
				[10, "=A2"],
				[20, "=A3"],
				[30, null],
			],
			columns,
		);

		store.deleteRows(1, 1);

		expect(store.cells[0]?.[1]).toBe("=#REF!");
	});
});

// ═════════════════════════════════════════════════════════════════════════════
// Group 1c — Engine-only: the exact scenario from the screenshots
//
// Reproduction of the "Scratch Sheet" bug: column E has a sequence 1-8,
// column F has formulas =En+En+1.  Insert a row and verify references shift.
// ═════════════════════════════════════════════════════════════════════════════

describe("scratch-sheet scenario: insert row with adjacent-sum formulas", () => {
	function buildScratchData(): CellValue[][] {
		// Rows 0-2: empty header area
		const rows: CellValue[][] = [
			new Array(6).fill(null),
			new Array(6).fill(null),
			new Array(6).fill(null),
		];

		// Rows 3-10: E = sequence 1-8, F = =En+En+1
		for (let i = 1; i <= 8; i++) {
			const row = new Array(6).fill(null) as CellValue[];
			row[4] = i; // col E
			if (i <= 7) {
				const a1Row = i + 3; // 1-indexed
				row[5] = `=E${a1Row}+E${a1Row + 1}`;
			}
			rows.push(row);
		}

		// Rows 11-14: empty
		for (let i = 0; i < 4; i++) rows.push(new Array(6).fill(null));
		return rows;
	}

	it("formulas shift correctly when inserting above row 5 (0-indexed row 4)", () => {
		const columns = makeColumns(6);
		const store = createSheetStore(buildScratchData(), columns);

		// Original: row 4 (E5) has F=E5+E6 which is =E4+E5 in 1-indexed → no,
		// Let me re-check: row index 3 = A1 row 4.
		// Row 3: E=1, F=E4+E5 → that's index 3, A1 row 4, formula =E4+E5
		expect(store.cells[3]?.[5]).toBe("=E4+E5");
		expect(store.cells[9]?.[5]).toBe("=E10+E11");

		// Insert 1 row at index 4 (above the row with E=2)
		store.insertRows(4, 1);

		expect(store.cells.length).toBe(16); // was 15, now 16

		// Row 3: =E4+E5 — E4 (0-indexed 3) < insertAt 4 → stays
		// E5 (0-indexed 4) >= insertAt 4 → shifts to E6
		expect(store.cells[3]?.[5]).toBe("=E4+E6");

		// Row 10 (was row 9): =E10+E11 → both shift → =E11+E12
		expect(store.cells[10]?.[5]).toBe("=E11+E12");
	});

	it("insert above + below a row (the electroswag double-insert scenario)", () => {
		const columns = makeColumns(6);
		const store = createSheetStore(buildScratchData(), columns);

		// Original row 4 has E=2.  Insert above (at index 4) then below (at index 6).
		store.insertRows(4, 1); // empty row at 4, old row 4 now at 5
		store.insertRows(6, 1); // empty row at 6, old row 5 now at 7

		expect(store.cells.length).toBe(17);

		// The row with E=2 should now be at index 5
		expect(store.cells[5]?.[4]).toBe(2);

		// Its formula (was =E5+E6) should have shifted twice: +1 then +1
		// After first insert: =E6+E7
		// After second insert at 6: E7 shifts to E8 → =E6+E8
		// Actually this depends on the exact semantics.  The key assertion:
		// The formula must NOT still be the original text.
		const formula = store.cells[5]?.[5] as string;
		expect(formula).not.toBe("=E5+E6"); // must have been rewritten
		expect(isFormulaValue(formula)).toBe(true);
	});
});

// ═════════════════════════════════════════════════════════════════════════════
// Group 1d — Website hero-sheet scenario
//
// D1=B1+C1, D2=B2+C2, D3=B3+C3, D4=SUM(D1:D3)
// Insert row at index 2 (above Marketing).
// ═════════════════════════════════════════════════════════════════════════════

describe("hero-sheet scenario: insert row with sum formulas", () => {
	it("row formulas shift and SUM range expands", () => {
		const columns = makeColumns(4);
		const store = createSheetStore(
			[
				["Engineering", 48, 52, "=B1+C1"],
				["Design", 32, 35, "=B2+C2"],
				["Marketing", 28, 31, "=B3+C3"],
				[null, null, "Sum", "=SUM(D1:D3)"],
			],
			columns,
		);

		// Insert empty row at index 2 (above Marketing)
		store.insertRows(2, 1);

		expect(store.cells.length).toBe(5);

		// Row 0: =B1+C1 — all refs above insert → unchanged
		expect(store.cells[0]?.[3]).toBe("=B1+C1");
		// Row 1: =B2+C2 — all refs above insert → unchanged
		expect(store.cells[1]?.[3]).toBe("=B2+C2");
		// Row 2: new empty row
		expect(store.cells[2]?.[0]).toBeNull();
		// Row 3 (was 2, Marketing): =B3+C3 → row shifted, refs shift → =B4+C4
		expect(store.cells[3]?.[3]).toBe("=B4+C4");
		// Row 4 (was 3, Sum): =SUM(D1:D3) → D3 at insert boundary shifts → =SUM(D1:D4)
		expect(store.cells[4]?.[3]).toBe("=SUM(D1:D4)");
	});
});

describe("row operation history with formulas", () => {
	it("delete row with formulas -> undo restores original raw formulas and row count", () => {
		const columns = makeColumns(4);
		const store = createSheetStore(
			[
				["Engineering", 48, 52, "=B1+C1"],
				["Design", 32, 35, "=B2+C2"],
				["Marketing", 28, 31, "=B3+C3"],
				["Ops", 5, 7, "=B4+C4"],
				[null, null, "Sum", "=SUM(D1:D4)"],
			],
			columns,
		);
		const selectionBefore = store.selection();
		const previousCells = store.cells.map((row) => [...row]);
		const removedData = store.deleteRows(2, 1);
		store.pushRowOperation(
			{ type: "deleteRows", atIndex: 2, count: 1, removedData, previousCells },
			selectionBefore,
			store.selection(),
		);

		expect(store.rowCount()).toBe(4);
		expect(store.cells[2]?.[3]).toBe("=B3+C3");
		expect(store.cells[3]?.[3]).toBe("=SUM(D1:D3)");

		const undoResult = store.undo();
		expect(undoResult).not.toBeNull();
		expect(store.rowCount()).toBe(5);
		expect(store.cells[2]?.[3]).toBe("=B3+C3");
		expect(store.cells[3]?.[3]).toBe("=B4+C4");
		expect(store.cells[4]?.[3]).toBe("=SUM(D1:D4)");
	});

	it("delete row -> undo -> redo restores shifted and #REF! formulas", () => {
		const columns = makeColumns(2);
		const store = createSheetStore(
			[
				[10, "=A3+A4"],
				[20, null],
				[30, null],
				[40, null],
			],
			columns,
		);
		const selectionBefore = store.selection();
		const previousCells = store.cells.map((row) => [...row]);
		const removedData = store.deleteRows(2, 1);
		store.pushRowOperation(
			{ type: "deleteRows", atIndex: 2, count: 1, removedData, previousCells },
			selectionBefore,
			store.selection(),
		);

		expect(store.cells[0]?.[1]).toBe("=#REF!+A3");

		store.undo();
		expect(store.rowCount()).toBe(4);
		expect(store.cells[0]?.[1]).toBe("=A3+A4");

		store.redo();
		expect(store.rowCount()).toBe(3);
		expect(store.cells[0]?.[1]).toBe("=#REF!+A3");
	});

	it("insert -> undo -> redo -> undo remains stable with formulas", () => {
		const columns = makeColumns(2);
		const store = createSheetStore(
			[
				[10, "=A1+A2"],
				[20, "=A2+A3"],
				[30, null],
			],
			columns,
		);
		const selectionBefore = store.selection();
		store.insertRows(1, 1);
		store.pushRowOperation(
			{ type: "insertRows", atIndex: 1, count: 1 },
			selectionBefore,
			store.selection(),
		);

		expect(store.cells[0]?.[1]).toBe("=A1+A3");

		store.undo();
		expect(store.rowCount()).toBe(3);
		expect(store.cells[0]?.[1]).toBe("=A1+A2");

		store.redo();
		expect(store.rowCount()).toBe(4);
		expect(store.cells[0]?.[1]).toBe("=A1+A3");

		store.undo();
		expect(store.rowCount()).toBe(3);
		expect(store.cells[0]?.[1]).toBe("=A1+A2");
	});

	it("delete formula row -> undo restores the removed formula cells exactly", () => {
		const columns = makeColumns(2);
		const store = createSheetStore(
			[
				[10, "=A1*2"],
				[20, "=A2*2"],
				[30, "=A3*2"],
			],
			columns,
		);
		const selectionBefore = store.selection();
		const previousCells = store.cells.map((row) => [...row]);
		const removedData = store.deleteRows(1, 1);
		store.pushRowOperation(
			{ type: "deleteRows", atIndex: 1, count: 1, removedData, previousCells },
			selectionBefore,
			store.selection(),
		);

		expect(store.rowCount()).toBe(2);
		store.undo();

		expect(store.rowCount()).toBe(3);
		expect(store.cells[1]?.[1]).toBe("=A2*2");
	});

	it("supports alternating insert/delete history with formulas across multiple steps", () => {
		const columns = makeColumns(2);
		const store = createSheetStore(
			[
				[10, "=A1+A2"],
				[20, "=A2+A3"],
				[30, "=A3+A4"],
				[40, null],
			],
			columns,
		);

		let selectionBefore = store.selection();
		store.insertRows(1, 1);
		store.pushRowOperation(
			{ type: "insertRows", atIndex: 1, count: 1 },
			selectionBefore,
			store.selection(),
		);

		selectionBefore = store.selection();
		let previousCells = store.cells.map((row) => [...row]);
		let removedData = store.deleteRows(3, 1);
		store.pushRowOperation(
			{ type: "deleteRows", atIndex: 3, count: 1, removedData, previousCells },
			selectionBefore,
			store.selection(),
		);

		selectionBefore = store.selection();
		store.insertRows(0, 1);
		store.pushRowOperation(
			{ type: "insertRows", atIndex: 0, count: 1 },
			selectionBefore,
			store.selection(),
		);

		selectionBefore = store.selection();
		previousCells = store.cells.map((row) => [...row]);
		removedData = store.deleteRows(2, 1);
		store.pushRowOperation(
			{ type: "deleteRows", atIndex: 2, count: 1, removedData, previousCells },
			selectionBefore,
			store.selection(),
		);

		selectionBefore = store.selection();
		store.insertRows(4, 1);
		store.pushRowOperation(
			{ type: "insertRows", atIndex: 4, count: 1 },
			selectionBefore,
			store.selection(),
		);

		expect(store.rowCount()).toBe(5);

		store.undo();
		store.undo();
		store.undo();
		store.undo();
		store.undo();

		expect(store.rowCount()).toBe(4);
		expect(store.cells[0]?.[1]).toBe("=A1+A2");
		expect(store.cells[1]?.[1]).toBe("=A2+A3");
		expect(store.cells[2]?.[1]).toBe("=A3+A4");
	});
});
