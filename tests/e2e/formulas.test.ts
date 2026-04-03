import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import {
	getStagehand,
	closeStagehand,
	navigateTo,
	getCellValue,
	clearMutations,
	clickCell,
	doubleClickCell,
	typeIntoCell,
} from "./setup";
import type { Stagehand } from "@browserbasehq/stagehand";

describe("formulas", () => {
	let sh: Stagehand;

	beforeAll(async () => {
		sh = await getStagehand();
		await navigateTo(sh, "/formulas");
	});

	beforeEach(async () => {
		await clearMutations(sh);
	});

	afterAll(async () => {
		await closeStagehand();
	});

	// ── Computed values ───────────────────────────────────────────────

	it("displays computed formula results", async () => {
		// C1 = A1 + B1 = 10 + 20 = 30
		const display = await sh.page.evaluate(
			() => window.__SHEET_CONTROLLER__?.getDisplayCellValue(0, 2),
		);
		expect(display).toBe(30);
	});

	it("computes SUM correctly", async () => {
		// C4 = SUM(C1:C3) = 30 + 70 + 110 = 210
		const display = await sh.page.evaluate(
			() => window.__SHEET_CONTROLLER__?.getDisplayCellValue(3, 2),
		);
		expect(display).toBe(210);
	});

	// ── Formula bar ───────────────────────────────────────────────────

	it("shows formula text in formula bar when cell is selected", async () => {
		await clickCell(sh, 0, 2);
		const formulaBar = sh.page.locator(".se-formula-bar input");
		const text = await formulaBar.inputValue();
		expect(text).toBe("=A1+B1");
	});

	// ── Editing a formula input ───────────────────────────────────────

	it("updates dependents when editing a source cell", async () => {
		await doubleClickCell(sh, 0, 0);
		await typeIntoCell(sh, "100");

		// C1 = A1 + B1 should now be 100 + 20 = 120
		const display = await sh.page.evaluate(
			() => window.__SHEET_CONTROLLER__?.getDisplayCellValue(0, 2),
		);
		expect(display).toBe(120);
	});
});
