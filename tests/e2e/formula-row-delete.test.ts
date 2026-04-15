import { beforeAll, beforeEach, describe, expect, it } from "bun:test";
import {
	doubleClickCell,
	focusGrid,
	getCellText,
	getCellValue,
	getPage,
	getRowCount,
	getStagehand,
	navigateTo,
	press,
	typeIntoCell,
} from "./setup";
import type { Stagehand } from "@browserbasehq/stagehand";

describe("formula + row delete (E2E)", () => {
	let sh: Stagehand;

	beforeAll(async () => {
		sh = await getStagehand();
	});

	beforeEach(async () => {
		await navigateTo(sh, "/formula-row-delete");
	});

	it("rewrites neighboring raw formulas when a referenced row is deleted", async () => {
		await getPage().evaluate(() => {
			(window as any).__SHEET_CONTROLLER__.deleteRows(2, 1);
		});

		expect(await getRowCount(sh)).toBe(6);
		expect(await getCellValue(sh, 2, 3)).toBe("=B3+C3");
		expect(await getCellValue(sh, 3, 3)).toBe("=SUM(D1:D3)");
		expect(await getCellValue(sh, 4, 3)).toBe("=#REF!");
		expect(await getCellValue(sh, 5, 3)).toBe("=#REF!+B3");
	});

	it("shrinks the SUM range when deleting a row inside the range", async () => {
		await getPage().evaluate(() => {
			(window as any).__SHEET_CONTROLLER__.deleteRows(2, 1);
		});

		expect(await getCellValue(sh, 3, 3)).toBe("=SUM(D1:D3)");
		const display = await getPage().evaluate(
			() => (window as any).__SHEET_CONTROLLER__?.getDisplayCellValue(3, 3),
		);
		expect(display).toBe(179);
	});

	it("recomputes display values after deleting a row containing a formula", async () => {
		await getPage().evaluate(() => {
			(window as any).__SHEET_CONTROLLER__.deleteRows(3, 1);
		});

		expect(await getCellValue(sh, 3, 3)).toBe("=SUM(D1:#REF!)");

		const refDisplay = await getPage().evaluate(
			() => (window as any).__SHEET_CONTROLLER__?.getDisplayCellValue(4, 3),
		);
		expect(refDisplay).toBe(28);

		const pairDisplay = await getPage().evaluate(
			() => (window as any).__SHEET_CONTROLLER__?.getDisplayCellValue(5, 3),
		);
		expect(pairDisplay).toBe("#REF!");
	});

	it("supports delete -> undo -> redo with formulas", async () => {
		await getPage().evaluate(() => {
			(window as any).__SHEET_CONTROLLER__.deleteRows(2, 1);
		});

		await focusGrid();
		await press(sh, "Control+z");

		expect(await getRowCount(sh)).toBe(7);
		expect(await getCellValue(sh, 2, 3)).toBe("=B3+C3");
		expect(await getCellValue(sh, 4, 3)).toBe("=SUM(D1:D4)");
		expect(await getCellValue(sh, 5, 3)).toBe("=B3");

		await press(sh, "Control+y");
		expect(await getRowCount(sh)).toBe(6);
		expect(await getCellValue(sh, 4, 3)).toBe("=#REF!");
	});

	it("updates references correctly when deleting the first row", async () => {
		await getPage().evaluate(() => {
			(window as any).__SHEET_CONTROLLER__.deleteRows(0, 1);
		});

		expect(await getRowCount(sh)).toBe(6);
		expect(await getCellValue(sh, 0, 3)).toBe("=B1+C1");
		expect(await getCellValue(sh, 4, 3)).toBe("=B2");
		expect(await getCellValue(sh, 5, 3)).toBe("=B2+B3");
	});

	it("updates references correctly when deleting the last row still used by the SUM", async () => {
		await getPage().evaluate(() => {
			(window as any).__SHEET_CONTROLLER__.deleteRows(3, 1);
		});

		expect(await getCellValue(sh, 3, 3)).toBe("=SUM(D1:#REF!)");
		expect(await getCellValue(sh, 5, 3)).toBe("=B3+#REF!");
	});

	it("keeps the deleted layout after a later edit triggers host sync", async () => {
		await getPage().evaluate(() => {
			(window as any).__SHEET_CONTROLLER__.deleteRows(2, 1);
		});

		await doubleClickCell(sh, 2, 0);
		await typeIntoCell(sh, "Operations");

		expect(await getRowCount(sh)).toBe(6);
		expect(await getCellValue(sh, 2, 0)).toBe("Operations");
		expect(await getCellValue(sh, 3, 3)).toBe("=SUM(D1:D3)");
		expect(await getCellValue(sh, 4, 3)).toBe("=#REF!");
	});

	it("shows #REF! display output for formulas invalidated by delete", async () => {
		await getPage().evaluate(() => {
			(window as any).__SHEET_CONTROLLER__.deleteRows(2, 1);
		});

		const display = await getPage().evaluate(
			() => (window as any).__SHEET_CONTROLLER__?.getDisplayCellValue(4, 3),
		);
		expect(display).toBe("#REF!");

		const text = await getCellText(sh, 4, 3);
		expect(text).toContain("#REF!");
	});
});
