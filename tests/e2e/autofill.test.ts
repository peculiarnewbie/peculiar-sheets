import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import {
	getStagehand,
	navigateTo,
	getCellValue,
	getMutations,
	clearMutations,
	clickCell,
	shiftClickCell,
	dragFillHandle,
	startFillHandleDrag,
	press,
	getPage,
} from "./setup";
import type { Stagehand } from "@browserbasehq/stagehand";

/**
 * Autofill fixture (from routes/autofill.tsx):
 *
 *   | Sequence | Labels | Values |
 *   |----------|--------|--------|
 *   |    1     | alpha  |  100   |
 *   |    2     | beta   |  200   |
 *   |    3     | gamma  |  300   |
 *   |  (null)  | (null) | (null) | ← row 3
 *   |  (null)  | (null) | (null) | ← row 4
 *   |  (null)  | (null) | (null) | ← row 5
 *   |  (null)  | (null) | (null) | ← row 6
 *   |  (null)  | (null) | (null) | ← row 7
 */

describe("autofill", () => {
	let sh: Stagehand;

	beforeAll(async () => {
		sh = await getStagehand();
	});

	describe("linear series", () => {
		beforeEach(async () => {
			// Fresh page each test so fill state is clean
			await navigateTo(sh, "/autofill");
			await clearMutations(sh);
		});

		it("fills a numeric column downward with linear series", async () => {
			// Select the Sequence column source: rows 0-2 (values 1, 2, 3)
			await clickCell(sh, 0, 0);
			await shiftClickCell(sh, 2, 0);

			// Drag fill handle down to row 5
			await dragFillHandle(sh, 5, 0);

			// Step is 1 (2-1=1, 3-2=1), so: row3=4, row4=5, row5=6
			expect(await getCellValue(sh, 3, 0)).toBe(4);
			expect(await getCellValue(sh, 4, 0)).toBe(5);
			expect(await getCellValue(sh, 5, 0)).toBe(6);

			// Verify mutations were recorded with source "fill"
			const mutations = await getMutations(sh);
			expect(mutations).toHaveLength(3);
			expect(mutations.every((m) => m.source === "fill")).toBe(true);
		});

		it("fills the Values column (step=100) downward", async () => {
			// Select Values column: rows 0-2 (100, 200, 300)
			await clickCell(sh, 0, 2);
			await shiftClickCell(sh, 2, 2);

			// Drag down to row 5
			await dragFillHandle(sh, 5, 2);

			// Step is 100, so: row3=400, row4=500, row5=600
			expect(await getCellValue(sh, 3, 2)).toBe(400);
			expect(await getCellValue(sh, 4, 2)).toBe(500);
			expect(await getCellValue(sh, 5, 2)).toBe(600);
		});
	});

	describe("copy mode", () => {
		beforeEach(async () => {
			await navigateTo(sh, "/autofill");
			await clearMutations(sh);
		});

		it("fills text values by repeating (copy mode)", async () => {
			// Select Labels column: rows 0-2 ("alpha", "beta", "gamma")
			await clickCell(sh, 0, 1);
			await shiftClickCell(sh, 2, 1);

			// Drag down to row 7
			await dragFillHandle(sh, 7, 1);

			// Copy mode wraps: row3=alpha, row4=beta, row5=gamma, row6=alpha, row7=beta
			expect(await getCellValue(sh, 3, 1)).toBe("alpha");
			expect(await getCellValue(sh, 4, 1)).toBe("beta");
			expect(await getCellValue(sh, 5, 1)).toBe("gamma");
			expect(await getCellValue(sh, 6, 1)).toBe("alpha");
			expect(await getCellValue(sh, 7, 1)).toBe("beta");
		});

		it("fills a single cell by copying it", async () => {
			// Select just one cell: row 0, col 1 ("alpha")
			await clickCell(sh, 0, 1);

			// Drag down to row 3
			await dragFillHandle(sh, 3, 1);

			expect(await getCellValue(sh, 1, 1)).toBe("alpha");
			expect(await getCellValue(sh, 2, 1)).toBe("alpha");
			expect(await getCellValue(sh, 3, 1)).toBe("alpha");
		});
	});

	describe("multi-column fill", () => {
		beforeEach(async () => {
			await navigateTo(sh, "/autofill");
			await clearMutations(sh);
		});

		it("fills multiple columns at once with per-column modes", async () => {
			// Select all 3 columns across rows 0-2
			await clickCell(sh, 0, 0);
			await shiftClickCell(sh, 2, 2);

			// Drag fill handle down to row 4
			await dragFillHandle(sh, 4, 2);

			// Col 0 (Sequence): linear series, step=1 → row3=4, row4=5
			expect(await getCellValue(sh, 3, 0)).toBe(4);
			expect(await getCellValue(sh, 4, 0)).toBe(5);

			// Col 1 (Labels): copy mode → row3=alpha, row4=beta
			expect(await getCellValue(sh, 3, 1)).toBe("alpha");
			expect(await getCellValue(sh, 4, 1)).toBe("beta");

			// Col 2 (Values): linear series, step=100 → row3=400, row4=500
			expect(await getCellValue(sh, 3, 2)).toBe(400);
			expect(await getCellValue(sh, 4, 2)).toBe(500);
		});
	});

	describe("edge cases", () => {
		beforeEach(async () => {
			await navigateTo(sh, "/autofill");
			await clearMutations(sh);
		});

		it("does nothing when fill handle is not dragged outside source range", async () => {
			await clickCell(sh, 0, 0);
			await shiftClickCell(sh, 2, 0);

			// "Drag" to a cell still within the source range
			await dragFillHandle(sh, 1, 0);

			const mutations = await getMutations(sh);
			expect(mutations).toHaveLength(0);
		});

		it("cancels fill drag on Escape", async () => {
			await clickCell(sh, 0, 0);
			await shiftClickCell(sh, 2, 0);

			// Start the drag manually so we can cancel mid-way
			const drag = await startFillHandleDrag();

			// Move to row 5
			await drag.moveTo(5, 0);

			// Escape cancels the fill
			await press(sh, "Escape");
			await drag.release(5, 0);

			const mutations = await getMutations(sh);
			expect(mutations).toHaveLength(0);

			// Original empty cells should still be null
			expect(await getCellValue(sh, 3, 0)).toBeNull();
			expect(await getCellValue(sh, 4, 0)).toBeNull();
		});
	});
});
