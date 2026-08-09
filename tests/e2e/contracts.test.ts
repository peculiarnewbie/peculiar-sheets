import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import type { Stagehand } from "@browserbasehq/stagehand";
import {
	closePage,
	getPage,
	getStagehand,
	navigateTo,
	newPage,
	press,
} from "./setup";

const mainGrid = ".contract-theme";

async function setSelection(row: number, col: number): Promise<void> {
	await getPage().evaluate(({ row, col }: { row: number; col: number }) => {
		window.__SHEET_CONTROLLER__?.setSelection([{
			start: { row, col },
			end: { row, col },
		}]);
		const grid = document.querySelector<HTMLElement>(".contract-theme");
		grid?.focus();
	}, { row, col });
}

async function selection(): Promise<{ anchor: { row: number; col: number }; focus: { row: number; col: number } } | null> {
	return getPage().evaluate(() => window.__SHEET_CONTROLLER__?.getSelection() ?? null);
}

describe("authoring grid contracts", () => {
	let sh: Stagehand;

	beforeAll(async () => {
		sh = await getStagehand();
		await newPage();
	});

	beforeEach(async () => {
		await navigateTo(sh, "/contracts");
	});

	afterAll(async () => {
		await closePage();
	});

	it("applies host theme variables when host CSS loads before package CSS", async () => {
		const styles = await getPage().evaluate(() => {
			const grid = document.querySelector<HTMLElement>(".contract-theme");
			if (!grid) return null;
			const computed = getComputedStyle(grid);
			return {
				background: computed.backgroundColor,
				backgroundVariable: computed.getPropertyValue("--ps-grid-background").trim(),
				focus: computed.getPropertyValue("--ps-focus").trim(),
				text: computed.color,
			};
		});
		expect(styles).toEqual({
			background: "rgb(247, 243, 232)",
			backgroundVariable: "#f7f3e8",
			focus: "#b5582b",
			text: "rgb(43, 38, 30)",
		});
	});

	it("keeps row classes aligned with view sorting, pinned cells, row IDs, and state", async () => {
		await setSelection(0, 0);
		const initial = await getPage().evaluate(() => {
			const row = document.querySelector<HTMLElement>(
				'.contract-theme [role="row"][aria-rowindex="1"]',
			);
			const header = row?.querySelector<HTMLElement>('[role="rowheader"]');
			const pinned = row?.querySelector<HTMLElement>('.se-cell--pinned');
			return {
				row: row?.className ?? "",
				header: header?.className ?? "",
				pinned: pinned?.className ?? "",
				headerText: header?.textContent?.trim() ?? "",
			};
		});

		expect(initial.row).toContain("row-id-contract-79");
		expect(initial.row).toContain("data-row-79");
		expect(initial.row).toContain("visual-row-0");
		expect(initial.row).toContain("row-has-focus");
		expect(initial.row).toContain("row-intersects-selection");
		expect(initial.header).toContain("row-id-contract-79");
		expect(initial.header).toContain("legacy-header-79");
		expect(initial.pinned).toContain("row-id-contract-79");
		expect(initial.pinned).toContain("legacy-cell-row-0");
		expect(initial.headerText).toBe("80");

		await press(sh, "ArrowDown");
		const moved = await getPage().evaluate(() => ({
			first: document.querySelector<HTMLElement>('.contract-theme [aria-rowindex="1"]')?.className ?? "",
			second: document.querySelector<HTMLElement>('.contract-theme [aria-rowindex="2"]')?.className ?? "",
		}));
		expect(moved.first).not.toContain("row-has-focus");
		expect(moved.second).toContain("row-id-contract-78");
		expect(moved.second).toContain("row-has-focus");
	});

	it("supports arrows and Shift+Arrow with visible focus and range state", async () => {
		await setSelection(0, 0);
		await press(sh, "ArrowRight");
		await press(sh, "ArrowDown");
		expect((await selection())?.anchor).toEqual({ row: 1, col: 1 });

		await setSelection(0, 0);
		await press(sh, "Shift+ArrowDown");
		const state = await getPage().evaluate(() => {
			const grid = document.querySelector<HTMLElement>(".contract-theme");
			const activeId = grid?.getAttribute("aria-activedescendant") ?? "";
			const active = document.getElementById(activeId);
			return {
				firstRow: document.querySelector<HTMLElement>('.contract-theme [aria-rowindex="1"]')?.className ?? "",
				secondRow: document.querySelector<HTMLElement>('.contract-theme [aria-rowindex="2"]')?.className ?? "",
				activeSelected: active?.getAttribute("aria-selected"),
				activeOutline: active ? getComputedStyle(active).outlineStyle : "",
			};
		});
		expect(state.firstRow).toContain("row-intersects-selection");
		expect(state.secondRow).toContain("row-intersects-selection");
		expect(state.secondRow).toContain("row-has-focus");
		expect(state.activeSelected).toBe("true");
		expect(state.activeOutline).toBe("solid");
	});

	it("enters, cancels, replaces, and vertically commits edits", async () => {
		await setSelection(0, 1);
		await press(sh, "Enter");
		expect(await getPage().evaluate(() => document.querySelector(".se-cell-editor")?.getAttribute("aria-label"))).toBe("Edit B1");
		await press(sh, "Escape");
		expect(await getPage().evaluate(() => document.querySelector(".se-cell-editor") === null)).toBe(true);

		await press(sh, "F2");
		expect(await getPage().evaluate(() => ({
			row: document.querySelector(".row-has-editor") !== null,
			cell: document.querySelector(".se-cell--editing") !== null,
		}))).toEqual({ row: true, cell: true });
		await press(sh, "Escape");

		await setSelection(0, 1);
		await getPage().type("X");
		expect(await getPage().evaluate(() => (document.querySelector(".se-cell-editor") as HTMLInputElement | null)?.value)).toBe("X");
		await press(sh, "Escape");
		expect(await getPage().evaluate(() => window.__SHEET_CONTROLLER__?.getRawCellValue(0, 1))).toBe("Record 79");

		await press(sh, "F2");
		await press(sh, "Enter");
		expect((await selection())?.anchor).toEqual({ row: 1, col: 1 });
		await press(sh, "F2");
		await press(sh, "Shift+Enter");
		expect((await selection())?.anchor).toEqual({ row: 0, col: 1 });

		await getPage().evaluate(() => window.__SHEET_CONTROLLER__?.setCellValue(0, 3, "=1+1"));
		await setSelection(0, 3);
		await press(sh, "F2");
		await press(sh, "Enter");
		expect((await selection())?.anchor).toEqual({ row: 1, col: 3 });
	});

	it("commits with Tab in-grid and releases focus at both boundaries", async () => {
		await setSelection(0, 0);
		await getPage().type("Q");
		await press(sh, "Tab");
		expect((await selection())?.anchor).toEqual({ row: 0, col: 1 });
		expect(await getPage().evaluate(() => window.__SHEET_CONTROLLER__?.getRawCellValue(0, 0))).toBe("Q");
		await press(sh, "Shift+Tab");
		expect((await selection())?.anchor).toEqual({ row: 0, col: 0 });

		await setSelection(79, 3);
		await press(sh, "F2");
		await press(sh, "Tab");
		expect(await getPage().evaluate(() => document.activeElement?.id)).toBe("after-grid");

		await setSelection(0, 0);
		await press(sh, "Shift+Tab");
		expect(await getPage().evaluate(() => document.activeElement?.id)).toBe("before-grid");
	});

	it("blocks every keyboard edit entry path for read-only cells", async () => {
		await setSelection(0, 2);
		const before = await getPage().evaluate(() => window.__SHEET_CONTROLLER__?.getRawCellValue(0, 2));
		await press(sh, "F2");
		await press(sh, "Z");
		await getPage().evaluate(() => window.__SHEET_CONTROLLER__?.startEditing(0, 2));
		const result = await getPage().evaluate(() => {
			const cell = document.querySelector<HTMLElement>(
				'.contract-theme [aria-rowindex="1"] [aria-colindex="3"]',
			);
			return {
				editor: document.querySelector(".se-cell-editor") !== null,
				readOnly: cell?.getAttribute("aria-readonly"),
				value: window.__SHEET_CONTROLLER__?.getRawCellValue(0, 2),
			};
		});
		expect(result).toEqual({ editor: false, readOnly: "true", value: before });
	});

	it("keeps the active descendant and row hook correct after virtual scrolling", async () => {
		await setSelection(70, 1);
		await getPage().waitForTimeout(100);
		const state = await getPage().evaluate(() => {
			const grid = document.querySelector<HTMLElement>(".contract-theme");
			const activeId = grid?.getAttribute("aria-activedescendant") ?? "";
			const cell = document.getElementById(activeId);
			return {
				activeId,
				cellExists: cell !== null,
				rowClass: cell?.closest('[role="row"]')?.className ?? "",
			};
		});
		expect(state.activeId).toContain("cell-70-1");
		expect(state.cellExists).toBe(true);
		expect(state.rowClass).toContain("row-id-contract-9");
		expect(state.rowClass).toContain("row-has-focus");
	});

	it("exposes grid counts, indices, selected state, label, and active cell", async () => {
		const aria = await getPage().evaluate(() => {
			const grid = document.querySelector<HTMLElement>(".contract-theme");
			const activeId = grid?.getAttribute("aria-activedescendant") ?? "";
			const active = document.getElementById(activeId);
			return {
				label: grid?.getAttribute("aria-label"),
				rows: grid?.getAttribute("aria-rowcount"),
				cols: grid?.getAttribute("aria-colcount"),
				activeId,
				activeRow: active?.closest('[role="row"]')?.getAttribute("aria-rowindex"),
				activeCol: active?.getAttribute("aria-colindex"),
				selected: active?.getAttribute("aria-selected"),
			};
		});
		expect(aria.label).toBe("Inventory authoring grid");
		expect(aria.rows).toBe("80");
		expect(aria.cols).toBe("4");
		expect(aria.activeId).not.toBe("");
		expect(aria.activeRow).toBe("1");
		expect(aria.activeCol).toBe("1");
		expect(aria.selected).toBe("true");
	});

	it("renders default and host-provided empty states", async () => {
		const empty = await getPage().evaluate(() => ({
			defaultText: document.querySelector(".default-empty .se-empty-state")?.textContent?.trim(),
			customText: document.querySelector(".custom-empty .se-empty-state")?.textContent?.trim(),
			customButton: document.querySelector(".custom-empty #create-first-row") instanceof HTMLButtonElement,
		}));
		expect(empty).toEqual({
			defaultText: "No data",
			customText: "Create first row",
			customButton: true,
		});
	});
});
