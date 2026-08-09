import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import {
	closePage,
	getStagehand,
	getPage,
	logMemory,
	navigateTo,
	newPage,
	getCellValue,
	clearMutations,
	clickCell,
	doubleClickCell,
	typeIntoCell,
	withSheetCtrlMaybe,
} from "./setup";
import type { Stagehand } from "@browserbasehq/stagehand";

describe("formulas", () => {
	let sh: Stagehand;

	beforeAll(async () => {
		sh = await getStagehand();
		await newPage();
		await navigateTo(sh, "/formulas");
	});

	afterAll(async () => {
		await logMemory("formulas");
		await closePage();
	});

	beforeEach(async () => {
		await clearMutations(sh);
	});

	// ── Computed values ───────────────────────────────────────────────

	it("displays computed formula results", async () => {
		// C1 = A1 + B1 = 10 + 20 = 30
		const display = await withSheetCtrlMaybe(
			(ctrl) => ctrl?.getDisplayCellValue(0, 2),
		);
		expect(display).toBe(30);
	});

	it("computes SUM correctly", async () => {
		// C4 = SUM(C1:C3) = 30 + 70 + 110 = 210
		const display = await withSheetCtrlMaybe(
			(ctrl) => ctrl?.getDisplayCellValue(3, 2),
		);
		expect(display).toBe(210);
	});

	// ── Formula bar ───────────────────────────────────────────────────

	it("shows formula text in formula bar when cell is selected", async () => {
		await clickCell(sh, 0, 2);
		const formulaBar = getPage().locator(".se-formula-bar input");
		const text = await formulaBar.inputValue();
		expect(text).toBe("=A1+B1");
	});

	// ── Editing a formula input ───────────────────────────────────────

	it("updates dependents when editing a source cell", async () => {
		await doubleClickCell(sh, 0, 0);
		await typeIntoCell(sh, "100");

		// C1 = A1 + B1 should now be 100 + 20 = 120
		const display = await withSheetCtrlMaybe(
			(ctrl) => ctrl?.getDisplayCellValue(0, 2),
		);
		expect(display).toBe(120);
	});
});

describe("formula-enabled mount", () => {
	let sh: Stagehand;

	beforeAll(async () => {
		sh = await getStagehand();
		await newPage();
		await navigateTo(sh, "/formula-mount");
	});

	afterAll(async () => {
		await closePage();
	});

	it("renders virtual rows and evaluates an edited formula", async () => {
		const rendered = await getPage().evaluate(() => ({
			rowOne: document.querySelector('.se-row[aria-rowindex="1"]') !== null,
			rowHeaders: document.querySelectorAll(".se-row-header-cell").length,
			cells: document.querySelectorAll(".se-cell").length,
		}));
		expect(rendered.rowOne).toBe(true);
		expect(rendered.rowHeaders).toBeGreaterThan(0);
		expect(rendered.cells).toBeGreaterThan(0);

		await doubleClickCell(sh, 0, 0);
		await typeIntoCell(sh, "=1+2");

		const display = await withSheetCtrlMaybe(
			(controller) => controller?.getDisplayCellValue(0, 0),
		);
		expect(display).toBe(3);
	});
});
