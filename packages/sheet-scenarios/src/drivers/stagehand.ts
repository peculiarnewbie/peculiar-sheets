/**
 * Stagehand driver — Node-only, runs scenarios against a real browser over CDP.
 *
 * This is a thin wrapper over the existing helpers in `tests/e2e/setup.ts`.
 * The helpers stay there (they're a mature, test-focused API); this driver
 * just adapts them to the `Driver` interface so Bun tests can loop over
 * scenarios via `runScenario(scenario, driver)`.
 *
 * This file is imported via the `"sheet-scenarios/stagehand"` export — never
 * from the default entry — so the Stagehand dependency never lands in the
 * showcase's browser bundle.
 */

import type { Stagehand } from "@browserbasehq/stagehand";
import type { CellValue, SheetController } from "peculiar-sheets";
import type { CellRef, Driver, MutationSnapshot } from "../types";
import {
	clickCell,
	clickColumnHeader,
	clickContextMenuItem,
	clearMutations,
	doubleClickCell,
	dragFillHandle,
	getCellValue,
	getMutations,
	getPage,
	navigateTo,
	press,
	rightClickCell,
	shiftClickCell,
	typeIntoCell,
} from "../../../../tests/e2e/setup";

interface SelectionSnapshot {
	anchor: { row: number; col: number };
	focus: { row: number; col: number };
}

export class StagehandDriver implements Driver {
	readonly kind = "stagehand" as const;

	constructor(private readonly sh: Stagehand) {}

	async navigate(route: `/${string}`): Promise<void> {
		await navigateTo(this.sh, route);
	}

	async reset(): Promise<void> {
		// Re-navigating to the route remounts the harness with `initialData`.
		// Runner only calls this when a scenario explicitly includes a `resetSheet`
		// step — scenarios normally start fresh via `navigate`.
		// We can't know the route here, so reload the current page as a fallback.
		const page = getPage();
		await page.reload();
		// Wait for hydration
		const start = Date.now();
		while (Date.now() - start < 10_000) {
			const ready = await page.evaluate(
				() => (window as unknown as { __SHEET_DATA__?: unknown }).__SHEET_DATA__ !== undefined,
			);
			if (ready) break;
			await page.waitForTimeout(100);
		}
	}

	async click(
		row: number,
		col: number,
		opts?: { shift?: boolean; button?: "left" | "right" },
	): Promise<void> {
		if (opts?.shift) {
			await shiftClickCell(this.sh, row, col);
			return;
		}
		if (opts?.button === "right") {
			await rightClickCell(this.sh, row, col);
			return;
		}
		await clickCell(this.sh, row, col);
	}

	async doubleClick(row: number, col: number): Promise<void> {
		await doubleClickCell(this.sh, row, col);
	}

	async clickColumnHeader(label: string): Promise<void> {
		await clickColumnHeader(this.sh, label);
	}

	async rightClickCell(row: number, col: number): Promise<void> {
		await rightClickCell(this.sh, row, col);
	}

	async clickContextMenuItem(label: string): Promise<void> {
		await clickContextMenuItem(this.sh, label);
	}

	async dragFill(to: CellRef): Promise<void> {
		await dragFillHandle(this.sh, to.row, to.col);
	}

	async type(text: string, opts?: { confirm?: boolean }): Promise<void> {
		// setup.ts default matches the harness default
		if (opts?.confirm === undefined) {
			await typeIntoCell(this.sh, text);
		} else {
			await typeIntoCell(this.sh, text, { confirm: opts.confirm });
		}
	}

	async press(key: string): Promise<void> {
		await press(this.sh, key);
	}

	async wait(ms: number): Promise<void> {
		await getPage().waitForTimeout(ms);
	}

	async getSelection(): Promise<{ anchor: CellRef; focus: CellRef } | null> {
		return getPage().evaluate(() => {
			const ctrl = (window as unknown as { __SHEET_CONTROLLER__: SheetController | null })
				.__SHEET_CONTROLLER__;
			const sel = ctrl?.getSelection();
			if (!sel) return null;
			return {
				anchor: { row: sel.anchor.row, col: sel.anchor.col },
				focus: { row: sel.focus.row, col: sel.focus.col },
			} satisfies SelectionSnapshot;
		});
	}

	async getRawCellValue(row: number, col: number): Promise<CellValue> {
		return getCellValue(this.sh, row, col);
	}

	async getDisplayCellValue(row: number, col: number): Promise<CellValue> {
		return getPage().evaluate(
			({ r, c }: { r: number; c: number }) => {
				const ctrl = (
					window as unknown as { __SHEET_CONTROLLER__: SheetController | null }
				).__SHEET_CONTROLLER__;
				return ctrl?.getDisplayCellValue(r, c) ?? null;
			},
			{ r: row, c: col },
		);
	}

	async getMutations(): Promise<MutationSnapshot[]> {
		const muts = await getMutations(this.sh);
		return muts.map((m) => ({
			source: m.source,
			newValue: m.newValue,
			oldValue: m.oldValue,
		}));
	}

	async clearMutations(): Promise<void> {
		await clearMutations(this.sh);
	}

	/** Direct `page` access for scenarios using the `custom` step escape hatch. */
	get page() {
		return getPage();
	}
}
