import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { Stagehand } from "@browserbasehq/stagehand";
import {
	closePage,
	doubleClickCell,
	getPage,
	getStagehand,
	navigateTo,
	newPage,
	typeIntoCell,
	withSheetCtrlMaybe,
} from "./setup";

async function getMountState() {
	return getPage().evaluate(() => ({
		buildMode: document.querySelector('[data-testid="harness"]')?.getAttribute("data-build-mode"),
		rowOne: document.querySelector('.se-row[aria-rowindex="1"]') !== null,
		rowHeaders: document.querySelectorAll(".se-row-header-cell").length,
		cells: document.querySelectorAll(".se-cell").length,
	}));
}

function expectVisibleGrid(state: Awaited<ReturnType<typeof getMountState>>) {
	const expectedBuildMode = process.env.E2E_PRODUCTION_BUNDLE === "true" ? "production" : "development";
	expect(state.buildMode).toBe(expectedBuildMode);
	expect(state.rowOne).toBe(true);
	expect(state.rowHeaders).toBeGreaterThan(0);
	expect(state.cells).toBeGreaterThan(0);
}

describe("formula-enabled production bundle clean mount", () => {
	let sh: Stagehand;

	beforeAll(async () => {
		sh = await getStagehand();
		await newPage();
	});

	afterAll(async () => {
		await closePage();
	});

	it("renders on two fresh documents and evaluates an edited formula", async () => {
		await navigateTo(sh, "/formula-mount?document=1");
		expectVisibleGrid(await getMountState());

		await navigateTo(sh, "/formula-mount?document=2");
		expectVisibleGrid(await getMountState());

		await doubleClickCell(sh, 0, 0);
		await typeIntoCell(sh, "=1+2");

		const display = await withSheetCtrlMaybe(
			(controller) => controller?.getDisplayCellValue(0, 0),
		);
		expect(display).toBe(3);
	});
});
