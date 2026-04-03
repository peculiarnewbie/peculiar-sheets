import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import {
	getStagehand,
	closeStagehand,
	navigateTo,
	getCellValue,
	getMutations,
	clearMutations,
	clickCell,
	doubleClickCell,
	typeIntoCell,
	press,
} from "./setup";
import type { Stagehand } from "@browserbasehq/stagehand";

describe("readonly", () => {
	let sh: Stagehand;

	beforeAll(async () => {
		sh = await getStagehand();
		await navigateTo(sh, "/readonly");
	});

	beforeEach(async () => {
		await clearMutations(sh);
	});

	afterAll(async () => {
		await closeStagehand();
	});

	it("prevents editing on non-editable columns", async () => {
		const original = await getCellValue(sh, 0, 0);

		await doubleClickCell(sh, 0, 0);
		await sh.page.keyboard.type("hacked");
		await press(sh, "Enter");

		const after = await getCellValue(sh, 0, 0);
		expect(after).toBe(original);

		const mutations = await getMutations(sh);
		expect(mutations).toHaveLength(0);
	});

	it("allows editing on editable columns", async () => {
		await doubleClickCell(sh, 0, 1);
		await typeIntoCell(sh, "edited");

		const value = await getCellValue(sh, 0, 1);
		expect(value).toBe("edited");

		const mutations = await getMutations(sh);
		expect(mutations.length).toBeGreaterThan(0);
	});

	it("prevents Delete on non-editable columns", async () => {
		const original = await getCellValue(sh, 1, 2);

		await clickCell(sh, 1, 2);
		await press(sh, "Delete");

		const after = await getCellValue(sh, 1, 2);
		expect(after).toBe(original);
	});
});
