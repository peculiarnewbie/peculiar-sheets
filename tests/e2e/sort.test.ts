import { beforeAll, describe, expect, it } from "bun:test";
import type { Stagehand } from "@browserbasehq/stagehand";
import {
	clickCell,
	clickColumnHeader,
	doubleClickCell,
	focusGrid,
	getCellText,
	getMutations,
	getPage,
	getRowHeaderText,
	getRowHeaderTitle,
	getRowCount,
	getSheetData,
	getStagehand,
	navigateTo,
	press,
	typeIntoCell,
} from "./setup";

describe("sorting", () => {
	let sh: Stagehand;

	beforeAll(async () => {
		sh = await getStagehand();
	});

	it("keeps external sorting as UI state and fires sort intent including clear", async () => {
		await navigateTo(sh, "/sort-external");
		await getPage().evaluate(() => {
			window.__SORT_INTENTS__ = [];
		});

		await clickColumnHeader(sh, "Score");
		await clickColumnHeader(sh, "Score");
		await clickColumnHeader(sh, "Score");

		expect(await getCellText(sh, 0, 0)).toBe("Alice");

		const sortState = await getPage().evaluate(() => window.__SORT_STATE__);
		expect(sortState).toBeNull();

		const intents = await getPage().evaluate(() => window.__SORT_INTENTS__);
		expect(intents).toEqual([
			{ columnId: "score", direction: "asc" },
			{ columnId: "score", direction: "desc" },
			{ columnId: "score", direction: null },
		]);
	});

	it("view sort reorders visible rows, shows backing row numbers, and tooltips view row numbers", async () => {
		await navigateTo(sh, "/sort-view");
		await clickColumnHeader(sh, "Score");

		expect(await getCellText(sh, 0, 0)).toBe("Dave");
		expect(await getRowHeaderText(sh, 0)).toBe("4");
		expect(await getRowHeaderTitle(sh, 0)).toBe("View row 1");

		const data = await getSheetData(sh);
		expect(data[0]?.[0]).toBe("Alice");
		expect(data[3]?.[0]).toBe("Dave");
	});

	it("third click clears a view sort back to the normal row order", async () => {
		await navigateTo(sh, "/sort-view");
		await clickColumnHeader(sh, "Score");
		await clickColumnHeader(sh, "Score");
		await clickColumnHeader(sh, "Score");

		expect(await getCellText(sh, 0, 0)).toBe("Alice");
		expect(await getRowHeaderText(sh, 0)).toBe("1");

		const sortState = await getPage().evaluate(() => window.__SORT_STATE__);
		expect(sortState).toBeNull();
	});

	it("editing a view-sorted row mutates the backing row and reports viewAddress", async () => {
		await navigateTo(sh, "/sort-view");
		await clickColumnHeader(sh, "Score");
		await doubleClickCell(sh, 0, 0);
		await typeIntoCell(sh, "Daphne");

		expect(await getCellText(sh, 0, 0)).toBe("Daphne");

		const data = await getSheetData(sh);
		expect(data[3]?.[0]).toBe("Daphne");
		expect(data[0]?.[0]).toBe("Alice");

		const mutations = await getMutations(sh);
		expect(mutations).toHaveLength(1);
		expect(mutations[0]?.address).toEqual({ row: 3, col: 0 });
		expect(mutations[0]?.viewAddress).toEqual({ row: 0, col: 0 });
		expect(typeof mutations[0]?.rowId).toBe("number");
	});

	it("keeps selection attached to the same backing row when view sort direction changes", async () => {
		await navigateTo(sh, "/sort-view");
		await clickColumnHeader(sh, "Score");
		await clickCell(sh, 0, 0);
		await clickColumnHeader(sh, "Score");

		const selection = await getPage().evaluate(
			() => window.__SHEET_CONTROLLER__?.getSelection(),
		);
		expect(selection?.anchor).toEqual({ row: 3, col: 0 });
		expect(await getCellText(sh, 3, 0)).toBe("Dave");
	});

	it("disables row insertion while a view sort is active", async () => {
		await navigateTo(sh, "/sort-view");
		await clickColumnHeader(sh, "Score");

		expect(await getRowCount(sh)).toBe(4);
		await getPage().evaluate(() => {
			window.__SHEET_CONTROLLER__?.insertRows(0, 1);
		});
		expect(await getRowCount(sh)).toBe(4);
	});

	it("keeps blank sort keys at the bottom even for descending view sort", async () => {
		await navigateTo(sh, "/sort-view");
		await getPage().evaluate(() => {
			window.__SHEET_CONTROLLER__?.setCellValue(0, 3, null);
		});

		await clickColumnHeader(sh, "Score");
		await clickColumnHeader(sh, "Score");

		expect(await getCellText(sh, 0, 0)).toBe("Carol");
		expect(await getCellText(sh, 3, 0)).toBe("Alice");
	});

	it("mutation sort reorders backing data and supports undo/redo", async () => {
		await navigateTo(sh, "/sort-mutation");
		await clickColumnHeader(sh, "Score");

		expect(await getCellText(sh, 0, 0)).toBe("Dave");

		let data = await getSheetData(sh);
		expect(data[0]?.[0]).toBe("Dave");

		let rowReorders = await getPage().evaluate(() => window.__ROW_REORDERS__);
		expect(rowReorders).toHaveLength(1);
		expect(rowReorders[0]?.source).toBe("sort");

		await focusGrid();
		await press(sh, "Control+z");
		expect(await getCellText(sh, 0, 0)).toBe("Alice");

		await press(sh, "Control+y");
		expect(await getCellText(sh, 0, 0)).toBe("Dave");

		rowReorders = await getPage().evaluate(() => window.__ROW_REORDERS__);
		expect(rowReorders.map((entry: any) => entry.source)).toEqual(["sort", "undo", "redo"]);
	});

	it("third click clears a mutation sort back to the pre-sort physical order", async () => {
		await navigateTo(sh, "/sort-mutation");
		await clickColumnHeader(sh, "Score");
		await clickColumnHeader(sh, "Score");
		await clickColumnHeader(sh, "Score");

		expect(await getCellText(sh, 0, 0)).toBe("Alice");

		const data = await getSheetData(sh);
		expect(data.map((row) => row?.[0])).toEqual(["Alice", "Bob", "Carol", "Dave"]);

		const sortState = await getPage().evaluate(() => window.__SORT_STATE__);
		expect(sortState).toBeNull();
	});

	it("mutation sort with formulas preserves evaluated results", async () => {
		await navigateTo(sh, "/sort-mutation-formulas");
		await clickColumnHeader(sh, "A");
		await clickColumnHeader(sh, "A");

		const topA = await getPage().evaluate(
			() => window.__SHEET_CONTROLLER__?.getRawCellValue(0, 0),
		);
		const c0 = await getPage().evaluate(
			() => window.__SHEET_CONTROLLER__?.getDisplayCellValue(0, 2),
		);
		const c1 = await getPage().evaluate(
			() => window.__SHEET_CONTROLLER__?.getDisplayCellValue(1, 2),
		);
		const c2 = await getPage().evaluate(
			() => window.__SHEET_CONTROLLER__?.getDisplayCellValue(2, 2),
		);

		expect(topA).toBe(3);
		expect(c0).toBe(33);
		expect(c1).toBe(22);
		expect(c2).toBe(11);
	});
});
