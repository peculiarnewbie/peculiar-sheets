import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { Stagehand } from "@browserbasehq/stagehand";
import {
	closePage,
	getPage,
	getSheetData,
	getStagehand,
	navigateTo,
	newPage,
	withSheetCtrl,
} from "./setup";

describe("batch controller mutations", () => {
	let stagehand: Stagehand;

	beforeAll(async () => {
		stagehand = await getStagehand();
		await newPage();
		await navigateTo(stagehand, "/basic");
	});

	afterAll(async () => {
		await closePage();
	});

	it("applies duplicate-normalized writes as one undoable operation", async () => {
		await withSheetCtrl((controller) => controller.setCellValues([
			{ row: 0, col: 0, value: "first" },
			{ row: 1, col: 1, value: 40 },
			{ row: 0, col: 0, value: "final" },
		]));
		await getPage().waitForTimeout(50);

		let data = await getSheetData(stagehand);
		expect(data[0]?.[0]).toBe("final");
		expect(data[1]?.[1]).toBe(40);

		await withSheetCtrl((controller) => controller.undo());
		await getPage().waitForTimeout(50);
		data = await getSheetData(stagehand);
		expect(data[0]?.[0]).toBe("Alice");
		expect(data[1]?.[1]).toBe(25);
	});
});
