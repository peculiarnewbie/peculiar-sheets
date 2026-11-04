import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { closePage, getPage, getStagehand, navigateTo, newPage } from "./setup";

describe("partial-row scroll coverage", () => {
	beforeAll(async () => {
		const browser = await getStagehand();
		await newPage();
		await navigateTo(browser, "/contracts");
		await getPage().evaluate(() => {
			const grid = document.querySelector<HTMLElement>(
				'.se-grid[aria-label="Inventory authoring grid"]',
			);
			if (!grid) throw new Error("Contract grid missing");
			grid.style.width = "401px";
			grid.style.height = "251px";
		});
	});
	afterAll(closePage);

	it("covers both viewport edges and preserves sticky geometry across row boundaries", async () => {
		for (const top of [1, 24, 28, 52, 350, 351]) {
			const geometry = await getPage().evaluate(async (top) => {
				const grid = document.querySelector<HTMLElement>(
					'.se-grid[aria-label="Inventory authoring grid"]',
				);
				const viewport = grid?.querySelector<HTMLElement>(".se-viewport");
				const header = grid?.querySelector<HTMLElement>(".se-header");
				if (!grid || !viewport || !header) throw new Error("Contract viewport missing");
				viewport.scrollTop = top;
				viewport.scrollLeft = 125;
				await new Promise<void>((resolve) =>
					requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
				);
				const viewportRect = viewport.getBoundingClientRect();
				const headerRect = header.getBoundingClientRect();
				const bottom = viewportRect.top + viewport.clientTop + viewport.clientHeight;
				const rows = [...grid.querySelectorAll<HTMLElement>(".se-body .se-row")]
					.map((element) => ({
						element,
						rect: element.getBoundingClientRect(),
						index: Number(element.getAttribute("aria-rowindex")),
					}))
					.filter(({ rect }) => rect.bottom > headerRect.bottom && rect.top < bottom)
					.sort((a, b) => a.index - b.index);
				const first = rows[0];
				const last = rows.at(-1);
				const gutter = first?.element.querySelector<HTMLElement>(".se-row-header-cell");
				const pinned = first?.element.querySelector<HTMLElement>(".se-cell--pinned");
				const pinnedHeader = header.querySelector<HTMLElement>(".se-header-cell--pinned");
				if (!first || !last || !gutter || !pinned || !pinnedHeader)
					throw new Error("Visible rows or pinned geometry missing");
				return {
					firstTop: first.rect.top,
					lastBottom: last.rect.bottom,
					visibleTop: headerRect.bottom,
					visibleBottom: bottom,
					indices: rows.map((row) => row.index),
					headerTop: headerRect.top,
					viewportTop: viewportRect.top + viewport.clientTop,
					gutterLeft: gutter.getBoundingClientRect().left,
					viewportLeft: viewportRect.left + viewport.clientLeft,
					pinnedLeft: pinned.getBoundingClientRect().left,
					gutterRight: gutter.getBoundingClientRect().right,
					pinnedHeaderLeft: pinnedHeader.getBoundingClientRect().left,
				};
			}, top);
			expect(geometry.firstTop).toBeLessThanOrEqual(geometry.visibleTop);
			expect(geometry.lastBottom).toBeGreaterThanOrEqual(geometry.visibleBottom);
			expect(geometry.indices).toEqual(
				Array.from(
					{ length: geometry.indices.length },
					(_, index) => (geometry.indices[0] ?? 0) + index,
				),
			);
			expect(Math.abs(geometry.headerTop - geometry.viewportTop)).toBeLessThan(1);
			expect(Math.abs(geometry.gutterLeft - geometry.viewportLeft)).toBeLessThan(1);
			expect(Math.abs(geometry.pinnedLeft - geometry.gutterRight)).toBeLessThan(1);
			expect(Math.abs(geometry.pinnedHeaderLeft - geometry.pinnedLeft)).toBeLessThan(1);
		}
	});

	it("covers the visible rows in the first animation frame after trusted wheel input", async () => {
		const page = getPage();
		for (const delta of [
			{ x: 0, y: 24 },
			{ x: 0, y: 350 },
			{ x: 120, y: 350 },
		]) {
			const point = await page.evaluate(async () => {
				const viewport = document.querySelector<HTMLElement>(
					'.se-grid[aria-label="Inventory authoring grid"] .se-viewport',
				);
				if (!viewport) throw new Error("Contract viewport missing");
				viewport.scrollTop = 0;
				viewport.scrollLeft = 0;
				await new Promise<void>((resolve) =>
					requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
				);
				const box = viewport.getBoundingClientRect();
				return { x: box.left + 250, y: box.top + 120 };
			});
			for (let step = 0; step < 6; step++) {
				await page.sendCDP("Input.dispatchMouseEvent", {
					type: "mouseWheel",
					...point,
					deltaX: delta.x,
					deltaY: delta.y,
				});
				const coverage = await page.evaluate(
					() =>
						new Promise<{ covered: boolean; rowCount: number }>((resolve) => {
							requestAnimationFrame(() => {
								const viewport = document.querySelector<HTMLElement>(
									'.se-grid[aria-label="Inventory authoring grid"] .se-viewport',
								);
								const header = viewport?.querySelector<HTMLElement>(".se-header");
								if (!viewport || !header) throw new Error("Contract viewport missing");
								const top = header.getBoundingClientRect().bottom;
								const bottom =
									viewport.getBoundingClientRect().top + viewport.clientTop + viewport.clientHeight;
								const rows = [...viewport.querySelectorAll<HTMLElement>(".se-body .se-row")]
									.map((row) => row.getBoundingClientRect())
									.filter((box) => box.bottom > top && box.top < bottom)
									.sort((a, b) => a.top - b.top);
								const first = rows[0];
								const last = rows.at(-1);
								resolve({
									rowCount: rows.length,
									covered: Boolean(
										first &&
											last &&
											first.top <= top &&
											last.bottom >= bottom &&
											rows.every(
												(row, index) =>
													index === 0 || row.top <= (rows[index - 1]?.bottom ?? -Infinity),
											),
									),
								});
							});
						}),
				);
				expect(coverage.rowCount).toBeGreaterThan(0);
				expect(coverage.covered).toBe(true);
			}
		}
	});
});
