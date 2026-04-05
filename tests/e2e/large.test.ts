import { beforeAll, describe, expect, it } from "bun:test";
import {
	getStagehand,
	navigateTo,
	getCellValue,
	doubleClickCell,
	typeIntoCell,
	getPage,
} from "./setup";
import type { Stagehand } from "@browserbasehq/stagehand";

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
		const inDom = await page.evaluate(
			(sel: string) => !!document.querySelector(sel),
			selector,
		);
		if (inDom) return;
		await page.waitForTimeout(25);
	}
	throw new Error(`Row ${row + 1} did not appear within ${timeoutMs}ms`);
}

async function measure<T>(label: string, fn: () => Promise<T>): Promise<{ result: T; elapsedMs: number }> {
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
		await navigateTo(sh, "/large");
	});

	it("renders without crashing", async () => {
		const data = await getPage().evaluate(() => (window as any).__SHEET_DATA__);
		expect(data.length).toBe(10_000);
	});

	it("can scroll to and edit a distant cell", async () => {
		const flowStart = performance.now();

		await measure("scrollToCell(500,0)", () =>
			getPage().evaluate(() => {
				(window as any).__SHEET_CONTROLLER__?.scrollToCell(500, 0);
			}),
		);

		const rowVisible = await measure("row 501 in DOM", () => waitForRowInDom(500));
		expect(rowVisible.elapsedMs).toBeLessThan(PERF_BUDGETS.scrollVisibleMs);

		const enterEdit = await measure("doubleClickCell(500,0)", () =>
			doubleClickCell(sh, 500, 0),
		);
		expect(enterEdit.elapsedMs).toBeLessThan(PERF_BUDGETS.enterEditMs);

		const commitEdit = await measure("typeIntoCell", () =>
			typeIntoCell(sh, "hello-500"),
		);
		expect(commitEdit.elapsedMs).toBeLessThan(PERF_BUDGETS.commitEditMs);

		const valueRead = await measure("getCellValue", () => getCellValue(sh, 500, 0));
		const totalFlowMs = performance.now() - flowStart;
		console.log(`  total large-flow: ${totalFlowMs.toFixed(0)}ms`);
		expect(totalFlowMs).toBeLessThan(PERF_BUDGETS.totalFlowMs);

		expect(valueRead.result).toBe("hello-500");
	});

	it("maintains data integrity after scrolling", async () => {
		// Scroll to top and verify untouched data
		await getPage().evaluate(() => {
			(window as any).__SHEET_CONTROLLER__?.scrollToCell(0, 0);
		});
		await getPage().waitForTimeout(200);

		// Row 0, Col 0 should be 0 * 20 + 0 = 0
		const value = await getCellValue(sh, 0, 0);
		expect(value).toBe(0);
	});
});
