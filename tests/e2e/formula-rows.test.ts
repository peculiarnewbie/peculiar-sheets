import { beforeAll, beforeEach, describe, expect, it } from "bun:test";
import {
	getStagehand,
	navigateTo,
	getCellValue,
	getCellText,
	getRowCount,
	clickCell,
	shiftClickCell,
	doubleClickCell,
	typeIntoCell,
	dragFillHandle,
	press,
	focusGrid,
	getPage,
} from "./setup";
import type { Stagehand } from "@browserbasehq/stagehand";

/**
 * E2E tests: formula cells + row insert + autofill.
 *
 * Test fixture (routes/formula-rows.tsx):
 *   Row 0: Engineering  48  52  =B1+C1  (displays 100)
 *   Row 1: Design       32  35  =B2+C2  (displays 67)
 *   Row 2: Marketing    28  31  =B3+C3  (displays 59)
 *   Row 3: null         —   Sum =SUM(D1:D3)  (displays 226)
 *   Rows 4-7: empty
 *
 * The harness has onRowInsert wired up, so the host data stays in sync.
 */

describe("formula + row operations (E2E)", () => {
	let sh: Stagehand;

	beforeAll(async () => {
		sh = await getStagehand();
	});

	// ── Baseline ────────────────────────────────────────────────────

	describe("baseline", () => {
		beforeEach(async () => {
			await navigateTo(sh, "/formula-rows");
		});

		it("displays computed formula values on initial load", async () => {
			const d0 = await getPage().evaluate(
				() => (window as any).__SHEET_CONTROLLER__?.getDisplayCellValue(0, 3),
			);
			expect(d0).toBe(100); // 48+52

			const d2 = await getPage().evaluate(
				() => (window as any).__SHEET_CONTROLLER__?.getDisplayCellValue(2, 3),
			);
			expect(d2).toBe(59); // 28+31

			const d3 = await getPage().evaluate(
				() => (window as any).__SHEET_CONTROLLER__?.getDisplayCellValue(3, 3),
			);
			expect(d3).toBe(226); // 100+67+59
		});
	});

	// ── Insert row: rows must persist ────────────────────────────────

	describe("insert row persistence", () => {
		beforeEach(async () => {
			await navigateTo(sh, "/formula-rows");
		});

		it("inserted row persists after committing a cell edit", async () => {
			// Insert at index 2 (above Marketing)
			await getPage().evaluate(() => {
				(window as any).__SHEET_CONTROLLER__.insertRows(2, 1);
			});
			expect(await getRowCount(sh)).toBe(9); // was 8, now 9

			// Row 2 is the new empty row
			expect(await getCellValue(sh, 2, 0)).toBeNull();
			// Marketing shifted to row 3
			expect(await getCellValue(sh, 3, 0)).toBe("Marketing");

			// Now edit a cell (this triggers onCellEdit → host data update → reconciler)
			await doubleClickCell(sh, 2, 0);
			await typeIntoCell(sh, "NewRow");

			// The grid must still have 9 rows — the inserted row must NOT vanish
			expect(await getRowCount(sh)).toBe(9);
			expect(await getCellValue(sh, 2, 0)).toBe("NewRow");
			expect(await getCellValue(sh, 3, 0)).toBe("Marketing");
		});

		it("double insert (above + below) persists after cell edit", async () => {
			// Insert above row 1
			await getPage().evaluate(() => {
				(window as any).__SHEET_CONTROLLER__.insertRows(1, 1);
			});
			// Insert below original row 1 (now at index 2)
			await getPage().evaluate(() => {
				(window as any).__SHEET_CONTROLLER__.insertRows(3, 1);
			});

			expect(await getRowCount(sh)).toBe(10); // 8 + 2

			// Edit a cell to trigger reconciler
			await doubleClickCell(sh, 1, 0);
			await typeIntoCell(sh, "above");

			// Both inserted rows must survive
			expect(await getRowCount(sh)).toBe(10);
			expect(await getCellValue(sh, 1, 0)).toBe("above");
		});
	});

	// ── Insert row: formula references ───────────────────────────────

	describe("insert row formula references", () => {
		beforeEach(async () => {
			await navigateTo(sh, "/formula-rows");
		});

		it("formula text is rewritten after row insert", async () => {
			// Insert at index 2 (above Marketing)
			await getPage().evaluate(() => {
				(window as any).__SHEET_CONTROLLER__.insertRows(2, 1);
			});

			// Marketing's formula (was =B3+C3) should now be =B4+C4
			const formula = await getCellValue(sh, 3, 3);
			expect(formula).toBe("=B4+C4");
		});

		it("SUM range expands when row is inserted within it", async () => {
			// Insert at index 2 (within the D1:D3 range)
			await getPage().evaluate(() => {
				(window as any).__SHEET_CONTROLLER__.insertRows(2, 1);
			});

			// =SUM(D1:D3) should become =SUM(D1:D4)
			const formula = await getCellValue(sh, 4, 3);
			expect(formula).toBe("=SUM(D1:D4)");
		});

		it("formula display values are correct after insert (no stale HF cache)", async () => {
			await getPage().evaluate(() => {
				(window as any).__SHEET_CONTROLLER__.insertRows(2, 1);
			});

			// D4 (Marketing, was D3) should display 59, NOT 226 or any stale value
			const d4 = await getPage().evaluate(
				() => (window as any).__SHEET_CONTROLLER__?.getDisplayCellValue(3, 3),
			);
			expect(d4).toBe(59);

			// D5 (Sum row) should display a number, not literal "=SUM(D1:D3)"
			const d5text = await getCellText(sh, 4, 3);
			expect(d5text).not.toContain("=");
		});

		it("typing a formula after insert evaluates against the new layout", async () => {
			// Insert at index 2
			await getPage().evaluate(() => {
				(window as any).__SHEET_CONTROLLER__.insertRows(2, 1);
			});

			// Type =C4 in a cell (C4 in post-insert layout = Marketing's Q2 = 31)
			await doubleClickCell(sh, 2, 1);
			await typeIntoCell(sh, "=C4");

			// The display value should be 31 (Marketing's Q2), NOT "Sum"
			const display = await getPage().evaluate(
				() => (window as any).__SHEET_CONTROLLER__?.getDisplayCellValue(2, 1),
			);
			expect(display).toBe(31);
		});
	});

	// ── Insert row: undo ─────────────────────────────────────────────

	describe("insert row undo", () => {
		beforeEach(async () => {
			await navigateTo(sh, "/formula-rows");
		});

		it("undo fully restores original state after row insert", async () => {
			const origD2 = await getCellValue(sh, 2, 3);
			const origD3 = await getCellValue(sh, 3, 3);

			await getPage().evaluate(() => {
				(window as any).__SHEET_CONTROLLER__.insertRows(2, 1);
			});
			expect(await getRowCount(sh)).toBe(9);

			await focusGrid();
			await press(sh, "Control+z");

			expect(await getRowCount(sh)).toBe(8);
			expect(await getCellValue(sh, 2, 3)).toBe(origD2);
			expect(await getCellValue(sh, 3, 3)).toBe(origD3);

			// Display values should be restored
			const d2 = await getPage().evaluate(
				() => (window as any).__SHEET_CONTROLLER__?.getDisplayCellValue(2, 3),
			);
			expect(d2).toBe(59);
		});
	});

	// ── Autofill formulas after insert ───────────────────────────────

	describe("autofill formulas", () => {
		beforeEach(async () => {
			await navigateTo(sh, "/formula-rows");
		});

		it("autofilled formulas land in the correct rows (no off-by-one)", async () => {
			// Select D1:D2 (=B2+C2 and =B3+C3)
			await clickCell(sh, 1, 3);
			await shiftClickCell(sh, 2, 3);

			// Drag fill handle down to row 5
			await dragFillHandle(sh, 5, 3);

			// D3 (first fill row) must have a value, NOT be blank
			const d3 = await getCellValue(sh, 3, 3);
			expect(d3).not.toBeNull();

			// If there was an off-by-one, D3 would be null and D4 would have the value
			const d4 = await getCellValue(sh, 4, 3);
			expect(d4).not.toBeNull();
		});

		it("autofilled formula references shift correctly", async () => {
			// Select D0:D2 (3 formulas)
			await clickCell(sh, 0, 3);
			await shiftClickCell(sh, 2, 3);

			// Drag fill down to row 5
			await dragFillHandle(sh, 5, 3);

			// D3 tiles from D0 shifted by +3: =B1+C1 → =B4+C4
			expect(await getCellValue(sh, 3, 3)).toBe("=B4+C4");

			// D4 tiles from D1 shifted by +3: =B2+C2 → =B5+C5
			expect(await getCellValue(sh, 4, 3)).toBe("=B5+C5");

			// D5 tiles from D2 shifted by +3: =B3+C3 → =B6+C6
			expect(await getCellValue(sh, 5, 3)).toBe("=B6+C6");
		});

		it("insert row then autofill over the gap uses the post-insert layout", async () => {
			await getPage().evaluate(() => {
				(window as any).__SHEET_CONTROLLER__.insertRows(2, 1);
			});

			await clickCell(sh, 0, 3);
			await shiftClickCell(sh, 1, 3);
			await dragFillHandle(sh, 3, 3);

			expect(await getCellValue(sh, 2, 3)).toBe("=B3+C3");
			expect(await getCellValue(sh, 3, 3)).toBe("=B4+C4");

			const display = await getPage().evaluate(
				() => (window as any).__SHEET_CONTROLLER__?.getDisplayCellValue(3, 3),
			);
			expect(display).toBe(59);
		});

		it("autofilled formulas display computed values, not literal text", async () => {
			await clickCell(sh, 0, 3);
			await shiftClickCell(sh, 2, 3);

			await dragFillHandle(sh, 4, 3);

			// D3 and D4 should show numbers, not "=B4+C4" as text
			const text3 = await getCellText(sh, 3, 3);
			expect(text3).not.toContain("=");

			const text4 = await getCellText(sh, 4, 3);
			expect(text4).not.toContain("=");
		});
	});
});
