/**
 * Basic editing scenarios.
 *
 * Test bodies are declarative `Scenario` data in
 * `packages/sheet-scenarios/src/scenarios/basic.ts`. This file just loops
 * over them, drives each through `StagehandDriver`, and fails via the
 * runner's `hard` mode (the default) so Bun's `it(...)` catches the throw.
 *
 * The same scenario data powers the showcase's live replay view; one source
 * of truth for CI + the marketing demo.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { Stagehand } from "@browserbasehq/stagehand";
import { runScenario } from "sheet-scenarios";
import { basicScenarios } from "sheet-scenarios/scenarios";
import { StagehandDriver } from "sheet-scenarios/stagehand";
import { closePage, getPage, getStagehand, navigateTo, newPage, withSheetCtrl } from "./setup";

describe("basic", () => {
	let driver: StagehandDriver;

	beforeAll(async () => {
		const sh: Stagehand = await getStagehand();
		await newPage();
		driver = new StagehandDriver(sh);
	});

	afterAll(async () => {
		await closePage();
	});

	it("centers default text and clips long values without covering the next cell", async () => {
		await navigateTo(await getStagehand(), "/basic");
		const centerError = await getPage().evaluate(() => {
			const cell = document.querySelector<HTMLElement>(
				'.se-body [aria-rowindex="1"] [aria-colindex="1"]',
			);
			const span = cell?.querySelector(".se-cell__text");
			if (!cell || !span) throw new Error("Default text cell missing");
			const range = document.createRange();
			range.selectNodeContents(span);
			const text = range.getBoundingClientRect();
			const bounds = cell.getBoundingClientRect();
			return Math.abs((text.top + text.bottom - bounds.top - bounds.bottom) / 2);
		});
		expect(centerError).toBeLessThanOrEqual(2);
		await withSheetCtrl((controller) =>
			controller.setCellValue(0, 0, "wide spreadsheet value ".repeat(20)),
		);
		await getPage().evaluate(
			() =>
				new Promise<void>((resolve) =>
					requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
				),
		);
		const clipped = await getPage().evaluate(() => {
			const row = document.querySelector('.se-body [aria-rowindex="1"]');
			const cell = row?.querySelector<HTMLElement>('[aria-colindex="1"]');
			const next = row?.querySelector<HTMLElement>('[aria-colindex="2"]');
			if (!cell || !next) throw new Error("Adjacent cells missing");
			const bounds = next.getBoundingClientRect();
			const hit = document.elementFromPoint(
				(bounds.left + bounds.right) / 2,
				(bounds.top + bounds.bottom) / 2,
			);
			const style = getComputedStyle(cell);
			return {
				text: cell.querySelector(".se-cell__text")?.textContent,
				title: cell.title,
				overflows: cell.scrollWidth > cell.clientWidth,
				overflow: style.overflow,
				ellipsis: style.textOverflow,
				neighborReceivesPointer: hit?.closest('[role="gridcell"]') === next,
			};
		});
		expect(clipped).toEqual({
			text: "wide spreadsheet value ".repeat(20),
			title: "wide spreadsheet value ".repeat(20),
			overflows: true,
			overflow: "hidden",
			ellipsis: "ellipsis",
			neighborReceivesPointer: true,
		});
	});

	it("preserves flex centering for custom cell renderers", async () => {
		await navigateTo(await getStagehand(), "/custom-rendering");
		const layout = await getPage().evaluate(() => {
			const pill = document.querySelector('[data-testid="status-pill"]');
			const cell = pill?.closest(".se-cell");
			if (!pill || !cell) throw new Error("Custom cell missing");
			const style = getComputedStyle(cell);
			return { display: style.display, alignment: style.alignItems };
		});
		expect(layout).toEqual({ display: "flex", alignment: "center" });
	});

	for (const scenario of basicScenarios) {
		it(scenario.title, async () => {
			await runScenario(scenario, driver);
		});
	}
});
