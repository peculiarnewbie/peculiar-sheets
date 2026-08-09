import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { Stagehand } from "@browserbasehq/stagehand";
import { closePage, getPage, getStagehand, navigateTo, newPage } from "./setup";

describe("formula-enabled lazy route production mount", () => {
	let sh: Stagehand;

	beforeAll(async () => {
		sh = await getStagehand();
		await newPage();
	});

	afterAll(async () => {
		await closePage();
	});

	it("recovers from a mount-turn detach and renders cells after a fresh load", async () => {
		await navigateTo(sh, "/formula-lazy?document=1&simulate-late-detach=1");
		await getPage().waitForTimeout(100);
		await getPage().waitForSelector('[data-testid="harness"]');

		const state = await getPage().evaluate(() => ({
			buildMode: document.querySelector('[data-testid="harness"]')?.getAttribute("data-build-mode"),
			viewport: (() => {
				const rect = document.querySelector(".se-body")?.getBoundingClientRect();
				return rect ? { width: rect.width, height: rect.height } : null;
			})(),
			virtualizers: (window.__VIRTUALIZERS__ ?? []).map((virtualizer) => ({
				horizontal: virtualizer.options.horizontal,
				width: virtualizer.scrollRect?.width ?? 0,
				height: virtualizer.scrollRect?.height ?? 0,
				items: virtualizer.getVirtualItems().length,
				hasTargetWindow: virtualizer.targetWindow !== null,
			})),
			rowOne: document.querySelector('.se-row[aria-rowindex="1"]') !== null,
			rowHeaders: document.querySelectorAll(".se-row-header-cell").length,
			cells: document.querySelectorAll(".se-cell").length,
		}));

		const expectedBuildMode = process.env.E2E_PRODUCTION_BUNDLE === "true" ? "production" : "development";
		expect(state.buildMode).toBe(expectedBuildMode);
		expect(state.viewport?.width ?? 0).toBeGreaterThan(0);
		expect(state.viewport?.height ?? 0).toBeGreaterThan(0);
		expect(state.virtualizers).toHaveLength(2);
		for (const virtualizer of state.virtualizers) {
			expect(virtualizer.width).toBeGreaterThan(0);
			expect(virtualizer.height).toBeGreaterThan(0);
			expect(virtualizer.items).toBeGreaterThan(0);
			expect(virtualizer.hasTargetWindow).toBe(true);
		}
		expect(state.rowOne).toBe(true);
		expect(state.rowHeaders).toBeGreaterThan(0);
		expect(state.cells).toBeGreaterThan(0);

		// Use a normal observer-backed document for the separate stale-resize
		// recovery contract below.
		await navigateTo(sh, "/formula-lazy?document=2");
		await getPage().waitForTimeout(100);

		const detachedCellCount = await getPage().evaluate(() => {
			for (const virtualizer of window.__VIRTUALIZERS__ ?? []) {
				const viewport = virtualizer.scrollElement;
				virtualizer._didMount()();
				virtualizer.scrollElement = viewport;
				virtualizer.scrollRect = { width: 0, height: 0 };
				virtualizer.range = null;
				virtualizer.options.onChange(virtualizer, false);
			}
			return document.querySelectorAll(".se-cell").length;
		});
		expect(detachedCellCount).toBe(0);

		await getPage().evaluate(() => {
			const harness = document.querySelector<HTMLElement>('[data-testid="harness"]');
			if (harness) harness.style.width = "calc(100vw - 2px)";
		});
		await getPage().waitForTimeout(100);

		const recovered = await getPage().evaluate(() => ({
			virtualizers: (window.__VIRTUALIZERS__ ?? []).map((virtualizer) => ({
				width: virtualizer.scrollRect?.width ?? 0,
				height: virtualizer.scrollRect?.height ?? 0,
				items: virtualizer.getVirtualItems().length,
				hasTargetWindow: virtualizer.targetWindow !== null,
			})),
			cells: document.querySelectorAll(".se-cell").length,
		}));
		for (const virtualizer of recovered.virtualizers) {
			expect(virtualizer.width).toBeGreaterThan(0);
			expect(virtualizer.height).toBeGreaterThan(0);
			expect(virtualizer.items).toBeGreaterThan(0);
			expect(virtualizer.hasTargetWindow).toBe(true);
		}
		expect(recovered.cells).toBeGreaterThan(0);
	});
});
