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
	press,
} from "./setup";
import type { Stagehand } from "@browserbasehq/stagehand";

describe("history", () => {
	let sh: Stagehand;

	beforeAll(async () => {
		sh = await getStagehand();
		await navigateTo(sh, "/history");
	});

	beforeEach(async () => {
		await clearMutations(sh);
	});

	afterAll(async () => {
		await closeStagehand();
	});

	it("undoes a cell edit with Ctrl+Z", async () => {
		const original = await getCellValue(sh, 0, 0);

		await doubleClickCell(sh, 0, 0);
		await typeIntoCell(sh, "changed");
		expect(await getCellValue(sh, 0, 0)).toBe("changed");

		await press(sh, "Control+z");
		expect(await getCellValue(sh, 0, 0)).toBe(original);
	});

	it("redoes with Ctrl+Y", async () => {
		await doubleClickCell(sh, 0, 1);
		await typeIntoCell(sh, "999");

		await press(sh, "Control+z");
		expect(await getCellValue(sh, 0, 1)).toBe(100);

		await press(sh, "Control+y");
		expect(await getCellValue(sh, 0, 1)).toBe("999");
	});

	it("supports multiple undo steps", async () => {
		// Navigate fresh to get clean history
		await navigateTo(sh, "/history");

		await doubleClickCell(sh, 1, 0);
		await typeIntoCell(sh, "step1");

		await doubleClickCell(sh, 1, 0);
		await typeIntoCell(sh, "step2");

		await doubleClickCell(sh, 1, 0);
		await typeIntoCell(sh, "step3");

		expect(await getCellValue(sh, 1, 0)).toBe("step3");

		await press(sh, "Control+z");
		expect(await getCellValue(sh, 1, 0)).toBe("step2");

		await press(sh, "Control+z");
		expect(await getCellValue(sh, 1, 0)).toBe("step1");

		await press(sh, "Control+z");
		expect(await getCellValue(sh, 1, 0)).toBe("untouched");
	});
});
