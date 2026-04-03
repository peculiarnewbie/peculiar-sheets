import { Stagehand } from "@browserbasehq/stagehand";
import type { CellMutation, CellValue } from "@peculiarnewbie/spreadsheets";

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3141";

let _stagehand: Stagehand | null = null;

/** Get or create the shared Stagehand instance. */
export async function getStagehand(): Promise<Stagehand> {
	if (!_stagehand) {
		_stagehand = new Stagehand({ env: "LOCAL" });
		await _stagehand.init();
	}
	return _stagehand;
}

/** Tear down the shared Stagehand instance. */
export async function closeStagehand(): Promise<void> {
	if (_stagehand) {
		await _stagehand.close();
		_stagehand = null;
	}
}

/** Navigate to a test route and wait for the harness to mount. */
export async function navigateTo(stagehand: Stagehand, route: string) {
	const page = stagehand.page;
	await page.goto(`${BASE_URL}${route}`);
	await page.waitForSelector('[data-testid="harness"]');
	// Give SolidJS a tick to hydrate and expose globals
	await page.waitForFunction(() => window.__SHEET_DATA__ !== undefined);
}

// ── Data helpers ──────────────────────────────────────────────────────────

/** Read the current sheet data from the harness. */
export async function getSheetData(stagehand: Stagehand): Promise<CellValue[][]> {
	return stagehand.page.evaluate(() => window.__SHEET_DATA__);
}

/** Read a single cell value from the harness. */
export async function getCellValue(
	stagehand: Stagehand,
	row: number,
	col: number,
): Promise<CellValue> {
	return stagehand.page.evaluate(
		({ r, c }) => window.__SHEET_DATA__[r]?.[c] ?? null,
		{ r: row, c: col },
	);
}

/** Get all recorded mutations. */
export async function getMutations(stagehand: Stagehand): Promise<CellMutation[]> {
	return stagehand.page.evaluate(() => window.__MUTATIONS__);
}

/** Clear the mutation log (useful between test cases sharing a route). */
export async function clearMutations(stagehand: Stagehand): Promise<void> {
	await stagehand.page.evaluate(() => {
		window.__MUTATIONS__ = [];
	});
}

// ── Interaction helpers ───────────────────────────────────────────────────

/**
 * Build a Playwright locator for a cell at the given row/col.
 * The grid uses aria-rowindex (1-indexed) on rows and aria-colindex (1-indexed) on cells.
 */
function cellLocator(stagehand: Stagehand, row: number, col: number) {
	return stagehand.page.locator(
		`[role="row"][aria-rowindex="${row + 1}"] [role="gridcell"][aria-colindex="${col + 1}"]`,
	);
}

/** Click a cell at the given (0-indexed) row/col position. */
export async function clickCell(
	stagehand: Stagehand,
	row: number,
	col: number,
) {
	await cellLocator(stagehand, row, col).click();
}

/** Double-click a cell to enter edit mode. */
export async function doubleClickCell(
	stagehand: Stagehand,
	row: number,
	col: number,
) {
	await cellLocator(stagehand, row, col).dblclick();
}

/** Get the displayed text content of a cell element. */
export async function getCellText(
	stagehand: Stagehand,
	row: number,
	col: number,
): Promise<string> {
	return (await cellLocator(stagehand, row, col).textContent()) ?? "";
}

/** Type into the currently active cell editor and press Enter. */
export async function typeIntoCell(
	stagehand: Stagehand,
	value: string,
	{ confirm = true }: { confirm?: boolean } = {},
) {
	const page = stagehand.page;
	await page.keyboard.type(value);
	if (confirm) {
		await page.keyboard.press("Enter");
	}
}

/** Press a key or key combo (e.g. "Control+z", "Delete", "Tab"). */
export async function press(stagehand: Stagehand, key: string) {
	await stagehand.page.keyboard.press(key);
}
