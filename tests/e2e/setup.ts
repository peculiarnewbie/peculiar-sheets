import { Stagehand } from "@browserbasehq/stagehand";
import type { CellMutation, CellValue } from "peculiar-sheets";

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
		const win = window as unknown as {
			__MUTATIONS__: unknown[];
			__ROW_REORDERS__?: unknown[];
			__HARNESS_CLEAR_MUTATIONS__?: () => void;
		};
		// Preferred path: call the harness's explicit flush hook so the shared
		// mutation buffer (see packages/sheet-scenarios/src/mutationBuffer.ts)
		// actually drops its state. Without this, the buffer's internal signal
		// would re-sync the pre-clear log back onto `window.__MUTATIONS__`
		// on the next reactive tick.
		if (typeof win.__HARNESS_CLEAR_MUTATIONS__ === "function") {
			win.__HARNESS_CLEAR_MUTATIONS__();
			return;
		}
		// Fallback for routes that don't mount the Harness component
		// (e.g. cross-sheet.tsx installs its own __MUTATIONS__ directly).
		win.__MUTATIONS__ = [];
		if (Array.isArray(win.__ROW_REORDERS__)) {
			win.__ROW_REORDERS__ = [];
		}
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

function rowHeaderLocator(row: number) {
	return getPage().locator(
		`[role="row"][aria-rowindex="${row + 1}"] [role="rowheader"]`,
	);
}

async function getColumnHeaderCenter(label: string): Promise<{ x: number; y: number }> {
	return getPage().evaluate((targetLabel: string) => {
		const headers = Array.from(
			document.querySelectorAll<HTMLElement>(".se-header-row--columns .se-header-cell"),
		);
		const header = headers.find((element) =>
			(element.textContent ?? "").trim().startsWith(targetLabel),
		);
		if (!header) {
			throw new Error(`Column header not found: ${targetLabel}`);
		}
		const rect = header.getBoundingClientRect();
		return {
			x: rect.left + rect.width / 2,
			y: rect.top + rect.height / 2,
		};
	}, label);
}

/** Click a cell at the given (0-indexed) row/col position. */
export async function clickCell(
	_sh: Stagehand,
	row: number,
	col: number,
) {
	await cellLocator(row, col).click();
}

/** Click a column header in the main header row by its label text. */
export async function clickColumnHeader(
	_sh: Stagehand,
	label: string,
) {
	const page = getPage();
	const { x, y } = await getColumnHeaderCenter(label);

	await page.sendCDP("Input.dispatchMouseEvent", {
		type: "mouseMoved", x, y, button: "none",
	});
	await page.sendCDP("Input.dispatchMouseEvent", {
		type: "mousePressed", x, y, button: "left", clickCount: 1,
	});
	await page.sendCDP("Input.dispatchMouseEvent", {
		type: "mouseReleased", x, y, button: "left", clickCount: 1,
	});
}

export async function rightClickColumnHeader(
	_sh: Stagehand,
	label: string,
) {
	const page = getPage();
	await page.evaluate((targetLabel: string) => {
		const headers = Array.from(
			document.querySelectorAll<HTMLElement>(".se-header-row--columns .se-header-cell"),
		);
		const header = headers.find((element) =>
			(element.textContent ?? "").trim().startsWith(targetLabel),
		);
		if (!header) {
			throw new Error(`Column header not found: ${targetLabel}`);
		}
		const rect = header.getBoundingClientRect();
		const clientX = rect.left + rect.width / 2;
		const clientY = rect.top + rect.height / 2;
		header.dispatchEvent(new MouseEvent("mousedown", {
			bubbles: true,
			button: 2,
			buttons: 2,
			clientX,
			clientY,
		}));
		header.dispatchEvent(new MouseEvent("contextmenu", {
			bubbles: true,
			button: 2,
			buttons: 2,
			clientX,
			clientY,
		}));
		header.dispatchEvent(new MouseEvent("mouseup", {
			bubbles: true,
			button: 2,
			buttons: 0,
			clientX,
			clientY,
		}));
	}, label);

	await poll(() => Boolean(document.querySelector(".se-context-menu")));
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

export async function getRowHeaderText(
	_sh: Stagehand,
	row: number,
): Promise<string> {
	return ((await rowHeaderLocator(row).textContent()) ?? "").trim();
}

export async function getRowHeaderTitle(
	_sh: Stagehand,
	row: number,
): Promise<string | null> {
	return getPage().evaluate((targetRow: number) => {
		const rowHeader = document.querySelector<HTMLElement>(
			`[role="row"][aria-rowindex="${targetRow + 1}"] [role="rowheader"]`,
		);
		return rowHeader?.getAttribute("title") ?? null;
	}, row);
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

/** Get the current row count from the harness data. */
export async function getRowCount(_sh: Stagehand): Promise<number> {
	return getPage().evaluate(() => (window as any).__SHEET_DATA__.length);
}

/**
 * Right-click a cell to open the context menu.
 * Uses CDP to dispatch a right-button click since Stagehand's Locator
 * doesn't natively support right-click.
 */
export async function rightClickCell(
	_sh: Stagehand,
	row: number,
	col: number,
) {
	const page = getPage();
	const { x, y } = await cellLocator(row, col).centroid();

	await page.sendCDP("Input.dispatchMouseEvent", {
		type: "mouseMoved", x, y, button: "none",
	});
	await page.sendCDP("Input.dispatchMouseEvent", {
		type: "mousePressed", x, y, button: "right", clickCount: 1,
	});
	await page.sendCDP("Input.dispatchMouseEvent", {
		type: "mouseReleased", x, y, button: "right", clickCount: 1,
	});

	// Wait for the context menu to appear
	await page.waitForSelector(".se-context-menu");
}

/**
 * Click a context menu item by its label text.
 * Must call rightClickCell() first to open the menu.
 */
export async function clickContextMenuItem(
	_sh: Stagehand,
	label: string,
) {
	const page = getPage();
	await page.evaluate((targetLabel: string) => {
		const items = Array.from(
			document.querySelectorAll<HTMLButtonElement>(".se-context-menu__item"),
		);
		const item = items.find((element) =>
			(element.textContent ?? "").includes(targetLabel),
		);
		if (!item) {
			throw new Error(`Context menu item not found: ${targetLabel}`);
		}
		item.click();
	}, label);
	// Wait for the menu to close
	await page.waitForTimeout(100);
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
