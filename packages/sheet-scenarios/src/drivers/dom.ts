/**
 * DOM driver — browser-native, runs scenarios in-page against the live `<Sheet>`
 * mounted by `ReplayHost`.
 *
 * Does NOT use window globals (the showcase never pollutes `window.*`). Instead
 * it receives the `SheetController` and `MutationBuffer` through the constructor
 * and drives the sheet via direct DOM event dispatch + controller reads.
 */

import type { CellValue, SheetController } from "peculiar-sheets";
import type { CellRef, Driver, MutationSnapshot } from "../types";
import type { MutationBuffer } from "../mutationBuffer";

export interface DomDriverOptions {
	/** Accessor returning the current SheetController (or null while remounting). */
	controller: () => SheetController | null;
	/** Mutation buffer bound to the same `<Sheet>` as the controller. */
	buffer: MutationBuffer;
	/**
	 * Per-action delay in ms, applied after every action step. Gives the user
	 * time to watch the replay; Grid reactive updates need only a frame but
	 * animated playback looks better with a larger gap. Default: 180ms.
	 */
	stepDelayMs?: number;
	/**
	 * Optional callback fired before each mouse/keyboard dispatch with the
	 * target screen coordinates. The `ReplayHost` / `GhostCursor` uses this to
	 * tween an overlay cursor to the correct spot.
	 */
	onPointerTarget?: (x: number, y: number) => void;
}

const FRAME_MS = 16;

export class DomDriver implements Driver {
	readonly kind = "dom" as const;

	private readonly stepDelay: number;

	constructor(private readonly opts: DomDriverOptions) {
		this.stepDelay = opts.stepDelayMs ?? 180;
	}

	/** Called by custom steps that need the controller handle. */
	get controller(): SheetController | null {
		return this.opts.controller();
	}

	// ── Navigation / lifecycle ────────────────────────────────────────────

	async navigate(_route: `/${string}`): Promise<void> {
		// No-op for the DOM driver — the showcase is already mounted at the
		// target demo. Resetting the buffer between scenarios happens via
		// `reset()` called from the runner's `skipNavigate: false` path.
		await this.reset();
	}

	async reset(): Promise<void> {
		this.opts.buffer.reset();
		await this.frame();
	}

	// ── Actions ──────────────────────────────────────────────────────────

	async click(
		row: number,
		col: number,
		opts?: { shift?: boolean; button?: "left" | "right" },
	): Promise<void> {
		const cell = requireCell(row, col);
		const { x, y } = centroid(cell);
		this.opts.onPointerTarget?.(x, y);
		const button = opts?.button === "right" ? 2 : 0;
		const buttons = opts?.button === "right" ? 2 : 1;
		const shift = opts?.shift ?? false;

		dispatchMouse(cell, "mousedown", { x, y, button, buttons, shiftKey: shift });
		dispatchMouse(cell, "mouseup", { x, y, button, buttons: 0, shiftKey: shift });
		if (opts?.button === "right") {
			dispatchMouse(cell, "contextmenu", { x, y, button, buttons: 0, shiftKey: shift });
		} else {
			dispatchMouse(cell, "click", { x, y, button, buttons: 0, shiftKey: shift });
		}

		await this.settle();
	}

	async doubleClick(row: number, col: number): Promise<void> {
		const cell = requireCell(row, col);
		const { x, y } = centroid(cell);
		this.opts.onPointerTarget?.(x, y);

		// First click
		dispatchMouse(cell, "mousedown", { x, y, button: 0, buttons: 1 });
		dispatchMouse(cell, "mouseup", { x, y, button: 0, buttons: 0 });
		dispatchMouse(cell, "click", { x, y, button: 0, buttons: 0, detail: 1 });
		// Second click
		dispatchMouse(cell, "mousedown", { x, y, button: 0, buttons: 1, detail: 2 });
		dispatchMouse(cell, "mouseup", { x, y, button: 0, buttons: 0, detail: 2 });
		dispatchMouse(cell, "click", { x, y, button: 0, buttons: 0, detail: 2 });
		dispatchMouse(cell, "dblclick", { x, y, button: 0, buttons: 0, detail: 2 });

		await this.settle();
	}

	async clickColumnHeader(label: string): Promise<void> {
		const header = findColumnHeader(label);
		if (!header) throw new Error(`column header not found: ${label}`);
		const { x, y } = centroid(header);
		this.opts.onPointerTarget?.(x, y);
		dispatchMouse(header, "mousedown", { x, y, button: 0, buttons: 1 });
		dispatchMouse(header, "mouseup", { x, y, button: 0, buttons: 0 });
		dispatchMouse(header, "click", { x, y, button: 0, buttons: 0 });
		await this.settle();
	}

	async rightClickCell(row: number, col: number): Promise<void> {
		const cell = requireCell(row, col);
		const { x, y } = centroid(cell);
		this.opts.onPointerTarget?.(x, y);
		dispatchMouse(cell, "mousedown", { x, y, button: 2, buttons: 2 });
		dispatchMouse(cell, "mouseup", { x, y, button: 2, buttons: 0 });
		dispatchMouse(cell, "contextmenu", { x, y, button: 2, buttons: 0 });
		await this.settle();
	}

	async clickContextMenuItem(label: string): Promise<void> {
		const items = Array.from(
			document.querySelectorAll<HTMLButtonElement>(".se-context-menu__item"),
		);
		const item = items.find((el) => (el.textContent ?? "").includes(label));
		if (!item) throw new Error(`context menu item not found: ${label}`);
		item.click();
		await this.settle();
	}

	async dragFill(to: CellRef): Promise<void> {
		const handle = document.querySelector<HTMLElement>(".se-fill-handle");
		if (!handle) throw new Error("fill handle not present — selection may not be set");
		const target = requireCell(to.row, to.col);
		const from = centroid(handle);
		const toPt = centroid(target);
		this.opts.onPointerTarget?.(from.x, from.y);

		dispatchMouse(handle, "mousedown", { x: from.x, y: from.y, button: 0, buttons: 1 });

		// Animate 5 intermediate mousemove events so the grid's fill handler
		// sees the drag progression the same way Playwright's dragAndDrop does.
		const steps = 5;
		for (let i = 1; i <= steps; i++) {
			const t = i / steps;
			const x = from.x + (toPt.x - from.x) * t;
			const y = from.y + (toPt.y - from.y) * t;
			this.opts.onPointerTarget?.(x, y);
			dispatchMouse(target, "mousemove", { x, y, button: 0, buttons: 1 });
			await this.frame();
		}

		dispatchMouse(target, "mouseup", { x: toPt.x, y: toPt.y, button: 0, buttons: 0 });
		await this.settle();
	}

	async type(text: string, opts?: { confirm?: boolean }): Promise<void> {
		for (const char of text) {
			await this.dispatchKey(char, char);
		}
		if (opts?.confirm ?? true) {
			await this.dispatchKey("Enter", "Enter");
		}
	}

	async press(key: string): Promise<void> {
		// Keys like "Control+z" come through as combos in setup.ts; for the
		// spike we only use single keys. Split on "+" to support basic modifiers.
		const parts = key.split("+");
		const mainKey = parts[parts.length - 1]!;
		const modifiers: { ctrlKey?: boolean; shiftKey?: boolean; altKey?: boolean; metaKey?: boolean } = {};
		for (let i = 0; i < parts.length - 1; i++) {
			const mod = parts[i]!.toLowerCase();
			if (mod === "control" || mod === "ctrl") modifiers.ctrlKey = true;
			else if (mod === "shift") modifiers.shiftKey = true;
			else if (mod === "alt") modifiers.altKey = true;
			else if (mod === "meta" || mod === "cmd") modifiers.metaKey = true;
		}
		await this.dispatchKey(mainKey, mainKey, modifiers);
	}

	async wait(ms: number): Promise<void> {
		await sleep(ms);
	}

	// ── Reads ────────────────────────────────────────────────────────────

	async getSelection(): Promise<{ anchor: CellRef; focus: CellRef } | null> {
		const ctrl = this.opts.controller();
		if (!ctrl) return null;
		const sel = ctrl.getSelection();
		return {
			anchor: { row: sel.anchor.row, col: sel.anchor.col },
			focus: { row: sel.focus.row, col: sel.focus.col },
		};
	}

	async getRawCellValue(row: number, col: number): Promise<CellValue> {
		const ctrl = this.opts.controller();
		if (!ctrl) return null;
		return ctrl.getRawCellValue(row, col);
	}

	async getDisplayCellValue(row: number, col: number): Promise<CellValue> {
		const ctrl = this.opts.controller();
		if (!ctrl) return null;
		return ctrl.getDisplayCellValue(row, col);
	}

	async getMutations(): Promise<MutationSnapshot[]> {
		return this.opts.buffer.mutations().map((m) => ({
			source: m.source,
			newValue: m.newValue,
			oldValue: m.oldValue,
		}));
	}

	async clearMutations(): Promise<void> {
		this.opts.buffer.clear();
		await this.frame();
	}

	// ── Internals ────────────────────────────────────────────────────────

	private async dispatchKey(
		key: string,
		code: string,
		mods: { ctrlKey?: boolean; shiftKey?: boolean; altKey?: boolean; metaKey?: boolean } = {},
	): Promise<void> {
		// Route keys to the editor if one is open, otherwise to the grid.
		const editor = document.querySelector<HTMLInputElement>(".se-cell-editor");
		const grid = document.querySelector<HTMLElement>(".se-grid");
		const target = editor ?? grid;
		if (!target) throw new Error("no .se-grid in DOM — replay host not mounted");

		const common: KeyboardEventInit = {
			key,
			code,
			bubbles: true,
			cancelable: true,
			ctrlKey: mods.ctrlKey ?? false,
			shiftKey: mods.shiftKey ?? false,
			altKey: mods.altKey ?? false,
			metaKey: mods.metaKey ?? false,
		};

		const keydown = new KeyboardEvent("keydown", common);
		target.dispatchEvent(keydown);

		// If we're typing into the editor and the browser would normally insert
		// the character, emulate that — synthetic KeyboardEvents don't mutate
		// <input> value by themselves.
		if (editor && !keydown.defaultPrevented && isPrintable(key, mods)) {
			const start = editor.selectionStart ?? editor.value.length;
			const end = editor.selectionEnd ?? editor.value.length;
			editor.value = editor.value.slice(0, start) + key + editor.value.slice(end);
			editor.setSelectionRange(start + 1, start + 1);
			editor.dispatchEvent(
				new InputEvent("input", {
					bubbles: true,
					cancelable: true,
					data: key,
					inputType: "insertText",
				}),
			);
		}

		target.dispatchEvent(new KeyboardEvent("keyup", common));
		await this.frame();
	}

	private async settle(): Promise<void> {
		// Give the grid + Solid's fine-grained reactivity a frame to flush,
		// then a visible pause for replay legibility.
		await this.frame();
		if (this.stepDelay > 0) await sleep(this.stepDelay);
	}

	private frame(): Promise<void> {
		return new Promise((r) => setTimeout(r, FRAME_MS));
	}
}

// ── Helpers ────────────────────────────────────────────────────────────────

function isPrintable(
	key: string,
	mods: { ctrlKey?: boolean; altKey?: boolean; metaKey?: boolean },
): boolean {
	if (mods.ctrlKey || mods.altKey || mods.metaKey) return false;
	return key.length === 1;
}

function sleep(ms: number): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}

function requireCell(row: number, col: number): HTMLElement {
	const el = document.querySelector<HTMLElement>(
		`[role="row"][aria-rowindex="${row + 1}"] [role="gridcell"][aria-colindex="${col + 1}"]`,
	);
	if (!el) throw new Error(`cell (${row},${col}) not found in DOM`);
	return el;
}

function findColumnHeader(label: string): HTMLElement | null {
	const headers = Array.from(
		document.querySelectorAll<HTMLElement>(".se-header-row--columns .se-header-cell"),
	);
	return (
		headers.find((el) => (el.textContent ?? "").trim().startsWith(label)) ?? null
	);
}

function centroid(el: Element): { x: number; y: number } {
	const r = el.getBoundingClientRect();
	return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

interface MouseInit {
	x: number;
	y: number;
	button?: number;
	buttons?: number;
	shiftKey?: boolean;
	detail?: number;
}

function dispatchMouse(target: Element, type: string, init: MouseInit): void {
	target.dispatchEvent(
		new MouseEvent(type, {
			bubbles: true,
			cancelable: true,
			view: window,
			clientX: init.x,
			clientY: init.y,
			button: init.button ?? 0,
			buttons: init.buttons ?? 0,
			shiftKey: init.shiftKey ?? false,
			detail: init.detail ?? 1,
		}),
	);
}
