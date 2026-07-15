import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { Stagehand } from "@browserbasehq/stagehand";
import {
	clickCell,
	clickColumnHeader,
	clickContextMenuItem,
	closePage,
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
	logMemory,
	navigateTo,
	newPage,
	press,
	rightClickColumnHeader,
	typeIntoCell,
} from "./setup";

describe("sorting", () => {
	let sh: Stagehand;

	beforeAll(async () => {
		sh = await getStagehand();
		await newPage();
	});

	afterAll(async () => {
		await logMemory("sort");
		await closePage();
	});

	it("keeps external sorting as UI state and fires sort intent including clear", async () => {
		await navigateTo(sh, "/sort-external");
		await getPage().evaluate(() => {
			window.__SORT_INTENTS__ = [];
		});

		await rightClickColumnHeader(sh, "Score");
		await clickContextMenuItem(sh, "Sort A-Z");
		await rightClickColumnHeader(sh, "Score");
		await clickContextMenuItem(sh, "Sort Z-A");
		await rightClickColumnHeader(sh, "Score");
		await clickContextMenuItem(sh, "Clear sort");

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

	it("clicking a column header selects the full column", async () => {
		await navigateTo(sh, "/sort-view");
		await clickColumnHeader(sh, "Score");

		const selection = await getPage().evaluate(
			() => window.__SHEET_CONTROLLER__?.getSelection(),
		);
		expect(selection?.ranges).toEqual([
			{
				start: { row: 0, col: 3 },
				end: { row: 3, col: 3 },
			},
		]);
		expect(selection?.anchor).toEqual({ row: 0, col: 3 });
		expect(selection?.focus).toEqual({ row: 3, col: 3 });
	});

	it("view sort reorders visible rows, shows backing row numbers, and tooltips view row numbers", async () => {
		await navigateTo(sh, "/sort-view");
		await rightClickColumnHeader(sh, "Score");
		await clickContextMenuItem(sh, "Sort A-Z");

		expect(await getCellText(sh, 0, 0)).toBe("Dave");
		expect(await getRowHeaderText(sh, 0)).toBe("4");
		expect(await getRowHeaderTitle(sh, 0)).toBe("View row 1");

		const data = await getSheetData(sh);
		expect(data[0]?.[0]).toBe("Alice");
		expect(data[3]?.[0]).toBe("Dave");
	});

	it("clearing a view sort restores the normal row order", async () => {
		await navigateTo(sh, "/sort-view");
		await rightClickColumnHeader(sh, "Score");
		await clickContextMenuItem(sh, "Sort A-Z");
		await rightClickColumnHeader(sh, "Score");
		await clickContextMenuItem(sh, "Sort Z-A");
		await rightClickColumnHeader(sh, "Score");
		await clickContextMenuItem(sh, "Clear sort");

		expect(await getCellText(sh, 0, 0)).toBe("Alice");
		expect(await getRowHeaderText(sh, 0)).toBe("1");

		const sortState = await getPage().evaluate(() => window.__SORT_STATE__);
		expect(sortState).toBeNull();
	});

	it("editing a view-sorted row mutates the backing row and reports viewAddress", async () => {
		await navigateTo(sh, "/sort-view");
		await rightClickColumnHeader(sh, "Score");
		await clickContextMenuItem(sh, "Sort A-Z");
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
		// Auto row ids are string indices (`RowId`); Dave is physical row 3.
		expect(mutations[0]?.rowId).toBe("3");
	});

	it("keeps the selected column active when view sort direction changes", async () => {
		await navigateTo(sh, "/sort-view");
		await clickColumnHeader(sh, "Score");
		await rightClickColumnHeader(sh, "Score");
		await clickContextMenuItem(sh, "Sort A-Z");
		await rightClickColumnHeader(sh, "Score");
		await clickContextMenuItem(sh, "Sort Z-A");

		const selection = await getPage().evaluate(
			() => window.__SHEET_CONTROLLER__?.getSelection(),
		);
		const range = selection?.ranges?.[0];
		expect(range).toBeDefined();
		expect(range?.start.col).toBe(3);
		expect(range?.end.col).toBe(3);
		expect(Math.min(range!.start.row, range!.end.row)).toBe(0);
		expect(Math.max(range!.start.row, range!.end.row)).toBe(3);
		expect(await getCellText(sh, 0, 0)).toBe("Carol");
	});

	it("disables row insertion while a view sort is active", async () => {
		await navigateTo(sh, "/sort-view");
		await rightClickColumnHeader(sh, "Score");
		await clickContextMenuItem(sh, "Sort A-Z");

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

		await rightClickColumnHeader(sh, "Score");
		await clickContextMenuItem(sh, "Sort A-Z");
		await rightClickColumnHeader(sh, "Score");
		await clickContextMenuItem(sh, "Sort Z-A");

		expect(await getCellText(sh, 0, 0)).toBe("Carol");
		expect(await getCellText(sh, 3, 0)).toBe("Alice");
	});

	it("mutation sort reorders backing data and supports undo/redo", async () => {
		await navigateTo(sh, "/sort-mutation");
		await rightClickColumnHeader(sh, "Score");
		await clickContextMenuItem(sh, "Sort A-Z");

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

	it("clearing a mutation sort restores the pre-sort physical order", async () => {
		await navigateTo(sh, "/sort-mutation");
		await rightClickColumnHeader(sh, "Score");
		await clickContextMenuItem(sh, "Sort A-Z");
		await rightClickColumnHeader(sh, "Score");
		await clickContextMenuItem(sh, "Sort Z-A");
		await rightClickColumnHeader(sh, "Score");
		await clickContextMenuItem(sh, "Clear sort");

		expect(await getCellText(sh, 0, 0)).toBe("Alice");

		const data = await getSheetData(sh);
		expect(data.map((row) => row?.[0])).toEqual(["Alice", "Bob", "Carol", "Dave"]);

		const sortState = await getPage().evaluate(() => window.__SORT_STATE__);
		expect(sortState).toBeNull();
	});

	it("mutation sort with formulas preserves evaluated results", async () => {
		await navigateTo(sh, "/sort-mutation-formulas");
		await rightClickColumnHeader(sh, "A");
		await clickContextMenuItem(sh, "Sort A-Z");
		await rightClickColumnHeader(sh, "A");
		await clickContextMenuItem(sh, "Sort Z-A");

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
