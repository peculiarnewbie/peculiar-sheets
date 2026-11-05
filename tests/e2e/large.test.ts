import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { Stagehand } from "@browserbasehq/stagehand";
import {
	closePage,
	doubleClickCell,
	getCellValue,
	getPage,
	getStagehand,
	logMemory,
	navigateTo,
	newPage,
	typeIntoCell,
	withSheetCtrlMaybe,
} from "./setup";

function getPerfBudget(envName: string, fallbackMs: number): number {
	const raw = process.env[envName];
	if (!raw) return fallbackMs;
	const parsed = Number(raw);
	if (!Number.isFinite(parsed) || parsed <= 0) {
		throw new Error(`Invalid ${envName}: ${raw}`);
	}
	return parsed;
}

const PERF_BUDGETS = {
	scrollVisibleMs: getPerfBudget("E2E_LARGE_SCROLL_VISIBLE_MAX_MS", 400),
	enterEditMs: getPerfBudget("E2E_LARGE_ENTER_EDIT_MAX_MS", 1200),
	commitEditMs: getPerfBudget("E2E_LARGE_COMMIT_EDIT_MAX_MS", 4000),
	totalFlowMs: getPerfBudget("E2E_LARGE_TOTAL_FLOW_MAX_MS", 5500),
};

async function waitForRowInDom(row: number, timeoutMs = 2_000): Promise<void> {
	const page = getPage();
	const selector = `[role="row"][aria-rowindex="${row + 1}"]`;
	const start = performance.now();
	while (performance.now() - start < timeoutMs) {
		const inDom = await page.evaluate((sel: string) => !!document.querySelector(sel), selector);
		if (inDom) return;
		await page.waitForTimeout(25);
	}
	throw new Error(`Row ${row + 1} did not appear within ${timeoutMs}ms`);
}

async function measure<T>(
	label: string,
	fn: () => Promise<T>,
): Promise<{ result: T; elapsedMs: number }> {
	const start = performance.now();
	const result = await fn();
	const elapsedMs = performance.now() - start;
	console.log(`  ${label}: ${elapsedMs.toFixed(0)}ms`);
	return { result, elapsedMs };
}

describe("large dataset", () => {
	let sh: Stagehand;

	beforeAll(async () => {
		sh = await getStagehand();
		await newPage();
		await navigateTo(sh, "/large");
	});

	afterAll(async () => {
		await logMemory("large");
		await closePage();
	});

	it("renders without crashing", async () => {
		const data = await getPage().evaluate(() => window.__SHEET_DATA__);
		expect(data.length).toBe(10_000);
	});

	it("can scroll to and edit a distant cell", async () => {
		const flowStart = performance.now();

		await measure("scrollToCell(500,0)", () =>
			withSheetCtrlMaybe((ctrl) => ctrl?.scrollToCell(500, 0)),
		);

		const rowVisible = await measure("row 501 in DOM", () => waitForRowInDom(500));
		expect(rowVisible.elapsedMs).toBeLessThan(PERF_BUDGETS.scrollVisibleMs);

		const enterEdit = await measure("doubleClickCell(500,0)", () => doubleClickCell(sh, 500, 0));
		expect(enterEdit.elapsedMs).toBeLessThan(PERF_BUDGETS.enterEditMs);

		const commitEdit = await measure("typeIntoCell", () => typeIntoCell(sh, "hello-500"));
		expect(commitEdit.elapsedMs).toBeLessThan(PERF_BUDGETS.commitEditMs);

		const valueRead = await measure("getCellValue", () => getCellValue(sh, 500, 0));
		const totalFlowMs = performance.now() - flowStart;
		console.log(`  total large-flow: ${totalFlowMs.toFixed(0)}ms`);
		expect(totalFlowMs).toBeLessThan(PERF_BUDGETS.totalFlowMs);

		expect(valueRead.result).toBe("hello-500");
	});

	it("maintains data integrity after scrolling", async () => {
		// Scroll to top and verify untouched data
		await withSheetCtrlMaybe((ctrl) => ctrl?.scrollToCell(0, 0));
		await getPage().waitForTimeout(200);

		// Row 0, Col 0 should be 0 * 20 + 0 = 0
		const value = await getCellValue(sh, 0, 0);
		expect(value).toBe(0);
	});

	it("keeps virtual column headers aligned with cells after horizontal scrolling", async () => {
		await withSheetCtrlMaybe((ctrl) => ctrl?.scrollToCell(0, 19));
		await getPage().waitForTimeout(200);
		const layout = await getPage().evaluate(() => {
			const header = document.querySelector<HTMLElement>('.se-header-cell[data-col-index="19"]');
			const cell = document.querySelector<HTMLElement>(
				'.se-row[aria-rowindex="1"] .se-cell[aria-colindex="20"]',
			);
			if (!header || !cell) throw new Error("Last column did not render");
			return {
				headerCount: document.querySelectorAll(".se-header-cell").length,
				headerLeft: header.getBoundingClientRect().left,
				cellLeft: cell.getBoundingClientRect().left,
				headerWidth: header.getBoundingClientRect().width,
				cellWidth: cell.getBoundingClientRect().width,
				text: header.textContent,
			};
		});
		expect(layout.headerCount).toBeLessThan(20);
		expect(Math.abs(layout.headerLeft - layout.cellLeft)).toBeLessThan(1);
		expect(layout.headerWidth).toBe(layout.cellWidth);
		expect(layout.text).toContain("Col 19");
	});

	it("updates both virtual ranges after viewport shrink and expansion", async () => {
		await navigateTo(sh, "/large");
		const page = getPage();
		const before = await page.evaluate(() => {
			const grid = document.querySelector<HTMLElement>(".se-grid");
			const viewport = grid?.querySelector<HTMLElement>(".se-viewport");
			if (!grid || !viewport) throw new Error("Large grid missing");
			return {
				style: grid.style.cssText,
				width: viewport.clientWidth,
				height: viewport.clientHeight,
				rows: grid.querySelectorAll(".se-body .se-row").length,
				columns: grid.querySelectorAll(".se-body .se-row:first-child .se-cell").length,
			};
		});
		try {
			await page.evaluate(async () => {
				const grid = document.querySelector<HTMLElement>(".se-grid");
				if (!grid) throw new Error("Large grid missing");
				grid.style.width = "400px";
				grid.style.height = "250px";
				await new Promise<void>((resolve) =>
					requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
				);
			});
			const shrunk = await page.evaluate(() => {
				const viewport = document.querySelector<HTMLElement>(".se-viewport");
				if (!viewport) throw new Error("Large viewport missing");
				return {
					width: viewport.clientWidth,
					height: viewport.clientHeight,
					rows: document.querySelectorAll(".se-body .se-row").length,
					columns: document.querySelectorAll(".se-body .se-row:first-child .se-cell").length,
				};
			});
			expect(shrunk.width).toBeLessThan(before.width);
			expect(shrunk.height).toBeLessThan(before.height);
			expect(shrunk.rows).toBeLessThan(before.rows);
			expect(shrunk.columns).toBeLessThan(before.columns);

			await page.evaluate(async (style: string) => {
				const grid = document.querySelector<HTMLElement>(".se-grid");
				if (!grid) throw new Error("Large grid missing");
				grid.style.cssText = style;
				await new Promise<void>((resolve) =>
					requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
				);
			}, before.style);
			const expanded = await page.evaluate(() => ({
				rows: document.querySelectorAll(".se-body .se-row").length,
				columns: document.querySelectorAll(".se-body .se-row:first-child .se-cell").length,
			}));
			expect(expanded.rows).toBe(before.rows);
			expect(expanded.columns).toBe(before.columns);

			await withSheetCtrlMaybe((ctrl) => ctrl?.scrollToCell(9_999, 19));
			await waitForRowInDom(9_999);
			expect(
				await page.evaluate(
					() =>
						document.querySelector('.se-row[aria-rowindex="10000"] .se-cell[aria-colindex="20"]')
							?.textContent,
				),
			).toBe("199999");
		} finally {
			await page.evaluate((style: string) => {
				const grid = document.querySelector<HTMLElement>(".se-grid");
				if (grid) grid.style.cssText = style;
			}, before.style);
		}
	});
});
