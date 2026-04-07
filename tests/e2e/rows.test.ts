import { beforeAll, beforeEach, describe, expect, it } from "bun:test";
import {
	getStagehand,
	navigateTo,
	getCellValue,
	getRowCount,
	press,
	focusGrid,
	getPage,
} from "./setup";
import type { Stagehand } from "@browserbasehq/stagehand";

/**
 * Row operations tests — using the imperative SheetController API.
 *
 * Starting data (3 rows × 2 cols):
 *   row 0: ["alpha", 10]
 *   row 1: ["beta",  20]
 *   row 2: ["gamma", 30]
 */
describe("row operations", () => {
	let sh: Stagehand;

	beforeAll(async () => {
		sh = await getStagehand();
	});

	// Navigate fresh before each test to get a clean 3-row dataset
	beforeEach(async () => {
		await navigateTo(sh, "/rows");
	});

	// ── Insert Rows ─────────────────────────────────────────────────

	it("inserts a row above via controller", async () => {
		expect(await getRowCount(sh)).toBe(3);

		// Insert 1 row at index 1 (above "beta")
		await getPage().evaluate(() => {
			(window as any).__SHEET_CONTROLLER__.insertRows(1, 1);
		});

		expect(await getRowCount(sh)).toBe(4);

		// Row 0 unchanged
		expect(await getCellValue(sh, 0, 0)).toBe("alpha");
		expect(await getCellValue(sh, 0, 1)).toBe(10);
		// Row 1 is the inserted empty row
		expect(await getCellValue(sh, 1, 0)).toBeNull();
		expect(await getCellValue(sh, 1, 1)).toBeNull();
		// "beta" shifted to row 2
		expect(await getCellValue(sh, 2, 0)).toBe("beta");
		// "gamma" shifted to row 3
		expect(await getCellValue(sh, 3, 0)).toBe("gamma");
	});

	it("inserts a row below via controller", async () => {
		expect(await getRowCount(sh)).toBe(3);

		// Insert 1 row at index 2 (below "beta")
		await getPage().evaluate(() => {
			(window as any).__SHEET_CONTROLLER__.insertRows(2, 1);
		});

		expect(await getRowCount(sh)).toBe(4);

		// Rows 0–1 unchanged
		expect(await getCellValue(sh, 0, 0)).toBe("alpha");
		expect(await getCellValue(sh, 1, 0)).toBe("beta");
		// Row 2 is the inserted empty row
		expect(await getCellValue(sh, 2, 0)).toBeNull();
		// "gamma" shifted to row 3
		expect(await getCellValue(sh, 3, 0)).toBe("gamma");
	});

	// ── Delete Rows ─────────────────────────────────────────────────

	it("deletes a row via controller", async () => {
		expect(await getRowCount(sh)).toBe(3);

		// Delete row 1 ("beta")
		await getPage().evaluate(() => {
			(window as any).__SHEET_CONTROLLER__.deleteRows(1, 1);
		});

		expect(await getRowCount(sh)).toBe(2);

		// Row 0 unchanged
		expect(await getCellValue(sh, 0, 0)).toBe("alpha");
		// "gamma" moved up to row 1
		expect(await getCellValue(sh, 1, 0)).toBe("gamma");
		expect(await getCellValue(sh, 1, 1)).toBe(30);
	});

	// ── Undo Insert Row ─────────────────────────────────────────────

	it("undoes insert row with Ctrl+Z", async () => {
		// Insert a row at index 1
		await getPage().evaluate(() => {
			(window as any).__SHEET_CONTROLLER__.insertRows(1, 1);
		});
		expect(await getRowCount(sh)).toBe(4);

		// Undo
		await focusGrid();
		await press(sh, "Control+z");

		// Should be back to 3 rows with original data
		expect(await getRowCount(sh)).toBe(3);
		expect(await getCellValue(sh, 0, 0)).toBe("alpha");
		expect(await getCellValue(sh, 1, 0)).toBe("beta");
		expect(await getCellValue(sh, 2, 0)).toBe("gamma");
	});

	// ── Undo Delete Row ─────────────────────────────────────────────

	it("undoes delete row with Ctrl+Z and restores data", async () => {
		// Delete row 1 ("beta", 20)
		await getPage().evaluate(() => {
			(window as any).__SHEET_CONTROLLER__.deleteRows(1, 1);
		});
		expect(await getRowCount(sh)).toBe(2);
		expect(await getCellValue(sh, 1, 0)).toBe("gamma");

		// Undo
		await focusGrid();
		await press(sh, "Control+z");

		// Should be back to 3 rows with original data fully restored
		expect(await getRowCount(sh)).toBe(3);
		expect(await getCellValue(sh, 0, 0)).toBe("alpha");
		expect(await getCellValue(sh, 0, 1)).toBe(10);
		expect(await getCellValue(sh, 1, 0)).toBe("beta");
		expect(await getCellValue(sh, 1, 1)).toBe(20);
		expect(await getCellValue(sh, 2, 0)).toBe("gamma");
		expect(await getCellValue(sh, 2, 1)).toBe(30);
	});

	// ── Redo ────────────────────────────────────────────────────────

	it("redoes insert row with Ctrl+Y after undo", async () => {
		// Insert row at index 1
		await getPage().evaluate(() => {
			(window as any).__SHEET_CONTROLLER__.insertRows(1, 1);
		});
		expect(await getRowCount(sh)).toBe(4);

		// Undo
		await focusGrid();
		await press(sh, "Control+z");
		expect(await getRowCount(sh)).toBe(3);

		// Redo
		await press(sh, "Control+y");
		expect(await getRowCount(sh)).toBe(4);
		expect(await getCellValue(sh, 0, 0)).toBe("alpha");
		expect(await getCellValue(sh, 1, 0)).toBeNull(); // re-inserted empty row
		expect(await getCellValue(sh, 2, 0)).toBe("beta");
	});

	it("redoes delete row with Ctrl+Y after undo", async () => {
		// Delete row 0 ("alpha")
		await getPage().evaluate(() => {
			(window as any).__SHEET_CONTROLLER__.deleteRows(0, 1);
		});
		expect(await getRowCount(sh)).toBe(2);

		// Undo
		await focusGrid();
		await press(sh, "Control+z");
		expect(await getRowCount(sh)).toBe(3);
		expect(await getCellValue(sh, 0, 0)).toBe("alpha");

		// Redo
		await press(sh, "Control+y");
		expect(await getRowCount(sh)).toBe(2);
		expect(await getCellValue(sh, 0, 0)).toBe("beta");
	});
});
