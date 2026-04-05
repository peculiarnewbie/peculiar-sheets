import { Stagehand } from "@browserbasehq/stagehand";
import type { CellMutation, CellValue } from "@peculiarnewbie/spreadsheets";

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3141";

let _stagehand: Stagehand | null = null;
// Stagehand v3 Page — accessed via stagehand.context.activePage()
let _page: any = null;
// Promise-based lock so concurrent beforeAll hooks don't race on init
let _initPromise: Promise<Stagehand> | null = null;

/** Get or create the shared Stagehand instance. */
export async function getStagehand(): Promise<Stagehand> {
	if (!_initPromise) {
		_initPromise = (async () => {
			_stagehand = new Stagehand({ env: "LOCAL" });
			await _stagehand.init();
			_page = _stagehand.context.activePage();
			if (!_page) throw new Error("No active page after Stagehand init");

			// Close once when the process exits — no per-file teardown needed
			process.on("beforeExit", () => closeStagehand());
			return _stagehand;
		})();
	}
	return _initPromise;
}

/**
 * Get the active Stagehand v3 Page.
 * Must call getStagehand() first (e.g. in beforeAll).
 */
export function getPage() {
	if (!_page) throw new Error("Page not initialized — call getStagehand() first");
	return _page;
}

/** Tear down the shared Stagehand instance. */
export async function closeStagehand(): Promise<void> {
	if (_stagehand) {
		await _stagehand.close();
		_stagehand = null;
		_page = null;
	}
}

// ── Polling helper ───────────────────────────────────────────────────────
// Stagehand v3 has no page.waitForFunction(), so we poll with evaluate.

async function poll(fn: () => any, timeoutMs = 10_000): Promise<void> {
	const page = getPage();
	const start = Date.now();
	while (Date.now() - start < timeoutMs) {
		const result = await page.evaluate(fn);
		if (result) return;
		await page.waitForTimeout(100);
	}
	throw new Error(`poll() timed out after ${timeoutMs}ms`);
}

/** Navigate to a test route and wait for the harness to mount. */
export async function navigateTo(_sh: Stagehand, route: string) {
	const page = getPage();
	await page.goto(`${BASE_URL}${route}`);
	await page.waitForSelector('[data-testid="harness"]');
	// Wait for SolidJS to hydrate and expose globals
	await poll(() => (window as any).__SHEET_DATA__ !== undefined);
}

// ── Data helpers ──────────────────────────────────────────────────────────

/** Read the current sheet data from the harness. */
export async function getSheetData(_sh: Stagehand): Promise<CellValue[][]> {
	return getPage().evaluate(() => (window as any).__SHEET_DATA__);
}

/** Read a single cell value from the harness. */
export async function getCellValue(
	_sh: Stagehand,
	row: number,
	col: number,
): Promise<CellValue> {
	return getPage().evaluate(
		({ r, c }: { r: number; c: number }) => (window as any).__SHEET_DATA__[r]?.[c] ?? null,
		{ r: row, c: col },
	);
}

/** Get all recorded mutations. */
export async function getMutations(_sh: Stagehand): Promise<CellMutation[]> {
	return getPage().evaluate(() => (window as any).__MUTATIONS__);
}

/** Clear the mutation log (useful between test cases sharing a route). */
export async function clearMutations(_sh: Stagehand): Promise<void> {
	await getPage().evaluate(() => {
		(window as any).__MUTATIONS__ = [];
	});
}

// ── Interaction helpers ───────────────────────────────────────────────────

/**
 * Build a locator for a cell at the given row/col.
 * The grid uses aria-rowindex (1-indexed) on rows and aria-colindex (1-indexed) on cells.
 */
function cellLocator(row: number, col: number) {
	return getPage().locator(
		`[role="row"][aria-rowindex="${row + 1}"] [role="gridcell"][aria-colindex="${col + 1}"]`,
	);
}

/** Click a cell at the given (0-indexed) row/col position. */
export async function clickCell(
	_sh: Stagehand,
	row: number,
	col: number,
) {
	await cellLocator(row, col).click();
}

/** Double-click a cell to enter edit mode. */
export async function doubleClickCell(
	_sh: Stagehand,
	row: number,
	col: number,
) {
	await cellLocator(row, col).click({ clickCount: 2 });
}

/** Get the displayed text content of a cell element. */
export async function getCellText(
	_sh: Stagehand,
	row: number,
	col: number,
): Promise<string> {
	return (await cellLocator(row, col).textContent()) ?? "";
}

/** Type into the currently active cell editor and press Enter. */
export async function typeIntoCell(
	_sh: Stagehand,
	value: string,
	{ confirm = true }: { confirm?: boolean } = {},
) {
	const page = getPage();
	await page.type(value);
	if (confirm) {
		await page.keyPress("Enter");
	}
}

/** Press a key or key combo (e.g. "Control+z", "Delete", "Tab"). */
export async function press(_sh: Stagehand, key: string) {
	await getPage().keyPress(key);
}

/**
 * Ensure the .se-grid element has keyboard focus.
 * Call this after operations that move focus away from the grid
 * (e.g. committing an edit removes the CellEditor input, which drops focus to <body>).
 */
export async function focusGrid(): Promise<void> {
	await getPage().evaluate(() => {
		const grid = document.querySelector(".se-grid");
		if (grid instanceof HTMLElement) grid.focus();
	});
}

/**
 * Shift-click a cell to extend the current selection.
 * Dispatches the full mouse sequence via CDP with the Shift modifier flag
 * since Stagehand v3 Locator.click() doesn't support modifier keys.
 */
export async function shiftClickCell(
	_sh: Stagehand,
	row: number,
	col: number,
) {
	const page = getPage();
	const { x, y } = await cellLocator(row, col).centroid();

	const modifiers = 8; // Shift
	await page.sendCDP("Input.dispatchMouseEvent", {
		type: "mouseMoved", x, y, modifiers,
	});
	await page.sendCDP("Input.dispatchMouseEvent", {
		type: "mousePressed", x, y, button: "left", clickCount: 1, modifiers,
	});
	await page.sendCDP("Input.dispatchMouseEvent", {
		type: "mouseReleased", x, y, button: "left", clickCount: 1, modifiers,
	});
}

/**
 * Drag the fill handle from its current position to a target cell.
 *
 * The fill handle (`.se-fill-handle`) sits at the bottom-right corner of the
 * primary selection. Uses Stagehand v3's `page.dragAndDrop()` which dispatches
 * mouseMoved → mousePressed → mouseMoved (steps) → mouseReleased via CDP.
 */
export async function dragFillHandle(
	_sh: Stagehand,
	targetRow: number,
	targetCol: number,
) {
	const page = getPage();
	const handle = page.locator(".se-fill-handle");

	// centroid() returns { x, y } center coordinates
	const { x: handleX, y: handleY } = await handle.centroid();
	const { x: targetX, y: targetY } = await cellLocator(targetRow, targetCol).centroid();

	await page.dragAndDrop(handleX, handleY, targetX, targetY, { steps: 5 });
}

/**
 * Start a fill-handle drag via low-level CDP mouse events.
 * Useful for tests that need to cancel the drag (e.g. press Escape mid-drag).
 * Returns a controller to move and release the mouse.
 */
export async function startFillHandleDrag() {
	const page = getPage();
	const handle = page.locator(".se-fill-handle");
	const { x, y } = await handle.centroid();

	// Move to handle and press
	await page.sendCDP("Input.dispatchMouseEvent", {
		type: "mouseMoved", x, y, button: "none",
	});
	await page.sendCDP("Input.dispatchMouseEvent", {
		type: "mousePressed", x, y, button: "left", clickCount: 1,
	});

	return {
		/** Move the drag to a target cell. */
		async moveTo(row: number, col: number) {
			const { x: tx, y: ty } = await cellLocator(row, col).centroid();
			await page.sendCDP("Input.dispatchMouseEvent", {
				type: "mouseMoved", x: tx, y: ty, button: "left",
			});
		},
		/** Release the mouse at the last moved position. */
		async release(atRow?: number, atCol?: number) {
			if (atRow !== undefined && atCol !== undefined) {
				const { x: rx, y: ry } = await cellLocator(atRow, atCol).centroid();
				await page.sendCDP("Input.dispatchMouseEvent", {
					type: "mouseReleased", x: rx, y: ry, button: "left", clickCount: 1,
				});
			} else {
				await page.sendCDP("Input.dispatchMouseEvent", {
					type: "mouseReleased", x, y, button: "left", clickCount: 1,
				});
			}
		},
	};
}
