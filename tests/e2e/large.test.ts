import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
	getStagehand,
	closeStagehand,
	navigateTo,
	getCellValue,
	clickCell,
	doubleClickCell,
	typeIntoCell,
} from "./setup";
import type { Stagehand } from "@browserbasehq/stagehand";

describe("large dataset", () => {
	let sh: Stagehand;

	beforeAll(async () => {
		sh = await getStagehand();
		await navigateTo(sh, "/large");
	});

	afterAll(async () => {
		await closeStagehand();
	});

	it("renders without crashing", async () => {
		const data = await sh.page.evaluate(() => window.__SHEET_DATA__);
		expect(data.length).toBe(10_000);
	});

	it("can scroll to and edit a distant cell", async () => {
		// Use the controller to scroll to a far-away row
		await sh.page.evaluate(() => {
			window.__SHEET_CONTROLLER__?.scrollToCell(500, 0);
		});
		// Small wait for virtual scroll to settle
		await sh.page.waitForTimeout(200);

		await doubleClickCell(sh, 500, 0);
		await typeIntoCell(sh, "hello-500");

		const value = await getCellValue(sh, 500, 0);
		expect(value).toBe("hello-500");
	});

	it("maintains data integrity after scrolling", async () => {
		// Scroll to top and verify untouched data
		await sh.page.evaluate(() => {
			window.__SHEET_CONTROLLER__?.scrollToCell(0, 0);
		});
		await sh.page.waitForTimeout(200);

		// Row 0, Col 0 should be 0 * 20 + 0 = 0
		const value = await getCellValue(sh, 0, 0);
		expect(value).toBe(0);
	});
});
