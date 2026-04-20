/**
 * Basic editing scenarios — mirror of `tests/e2e/basic.test.ts`.
 *
 * Each scenario corresponds to one `it(...)` block. The Bun test file loops
 * over this array and runs each under the Stagehand driver; the showcase's
 * `ScenarioPlayer` runs them under the DOM driver.
 *
 * The initial data for the `/basic` route (both the e2e harness and the
 * showcase `BasicSheet` demo) is:
 *
 *   [
 *     ["Alice", 30, "Portland", 88],
 *     ["Bob",   25, "Seattle",  72],
 *     ["Carol", 35, "Denver",   95],
 *     ["Dave",  28, "Austin",   61],
 *     ["Eve",   22, "Boston",   83],
 *   ]
 */

import type { Scenario } from "../types";
import type { StagehandDriver } from "../drivers/stagehand";

const DEMO_ID = "basic";

export const basicScenarios: Scenario[] = [
	// ── Selection ───────────────────────────────────────────────────────

	{
		id: "basic/selects-a-cell-on-click",
		title: "selects a cell on click",
		demoId: DEMO_ID,
		route: "/basic",
		steps: [
			{ kind: "click", at: { row: 0, col: 0 }, caption: "Click cell A1" },
			{ kind: "assertSelection", anchor: { row: 0, col: 0 }, caption: "Selection anchor = A1" },
		],
	},

	{
		id: "basic/moves-selection-with-arrow-keys",
		title: "moves selection with arrow keys",
		demoId: DEMO_ID,
		route: "/basic",
		// Demo-skipped: selection movement is already visible in
		// `enter-starts-editing-then-commits-moves-down`, which tells a richer
		// story (editing + implicit advance). Keep the test for coverage.
		skipInReplay: true,
		steps: [
			{ kind: "click", at: { row: 0, col: 0 }, caption: "Click A1" },
			{ kind: "press", key: "ArrowRight", caption: "→ arrow key" },
			{ kind: "press", key: "ArrowDown", caption: "↓ arrow key" },
			{ kind: "assertSelection", anchor: { row: 1, col: 1 }, caption: "Selection at B2" },
		],
	},

	{
		id: "basic/moves-selection-with-tab",
		title: "moves selection with Tab",
		demoId: DEMO_ID,
		route: "/basic",
		// Demo-skipped: Tab navigation is a narrow nuance of selection movement,
		// and the enter-commit flow already shows the interesting selection
		// mechanic. Test remains for coverage.
		skipInReplay: true,
		steps: [
			{ kind: "click", at: { row: 0, col: 0 }, caption: "Click A1" },
			{ kind: "press", key: "Tab", caption: "Tab" },
			{ kind: "assertSelection", anchor: { row: 0, col: 1 }, caption: "Selection at B1" },
		],
	},

	// ── Editing ─────────────────────────────────────────────────────────

	{
		id: "basic/edits-a-cell-on-double-click-and-enter",
		title: "edits a cell on double-click and Enter",
		demoId: DEMO_ID,
		route: "/basic",
		steps: [
			{ kind: "doubleClick", at: { row: 0, col: 0 }, caption: "Double-click A1" },
			{ kind: "type", text: "Zara", confirm: true, caption: "Type 'Zara' + Enter" },
			{ kind: "assertCellValue", at: { row: 0, col: 0 }, value: "Zara" },
			{ kind: "assertMutationCount", count: 1 },
			{
				kind: "assertMutation",
				index: 0,
				match: { newValue: "Zara", oldValue: "Alice", source: "user" },
			},
		],
	},

	{
		id: "basic/starts-editing-when-typing-directly-on-a-selected-cell",
		title: "starts editing when typing directly on a selected cell",
		demoId: DEMO_ID,
		route: "/basic",
		steps: [
			{ kind: "click", at: { row: 1, col: 1 }, caption: "Click B2" },
			{ kind: "type", text: "99", confirm: true, caption: "Type '99' + Enter" },
			{ kind: "assertCellValue", at: { row: 1, col: 1 }, value: 99 },
		],
	},

	{
		id: "basic/cancels-editing-with-escape",
		title: "cancels editing with Escape",
		demoId: DEMO_ID,
		route: "/basic",
		steps: [
			{ kind: "doubleClick", at: { row: 2, col: 0 }, caption: "Double-click A3" },
			{ kind: "type", text: "NOPE", confirm: false, caption: "Type 'NOPE' (no Enter)" },
			{ kind: "press", key: "Escape", caption: "Escape cancels edit" },
			{ kind: "assertCellValue", at: { row: 2, col: 0 }, value: "Carol" },
		],
	},

	// ── Deletion ────────────────────────────────────────────────────────

	{
		id: "basic/clears-a-cell-with-delete-key",
		title: "clears a cell with Delete key",
		demoId: DEMO_ID,
		route: "/basic",
		// Demo-skipped: shape is test-first. The mid-scenario `clearMutations`
		// custom step + `assertMutationCount` / `assertMutation` at the end are
		// plumbing that doesn't translate to a viewer story. A purpose-built
		// delete-key demo would be shorter (click → Delete → empty). Keep for
		// coverage; revisit when we add a dedicated demo scenario.
		skipInReplay: true,
		steps: [
			{ kind: "doubleClick", at: { row: 4, col: 3 }, caption: "Double-click E4" },
			{ kind: "type", text: "999", confirm: true, caption: "Seed value: 999" },
			{
				kind: "custom",
				caption: "Clear mutation log (mid-scenario setup)",
				run: async (d) => {
					await d.clearMutations();
				},
			},
			{ kind: "click", at: { row: 4, col: 3 }, caption: "Click E4 again" },
			{ kind: "press", key: "Delete", caption: "Press Delete" },
			{ kind: "assertCellValue", at: { row: 4, col: 3 }, value: null },
			{ kind: "assertMutationCount", count: 1 },
			{ kind: "assertMutation", index: 0, match: { source: "delete" } },
		],
	},

	// ── Keyboard navigation ─────────────────────────────────────────────

	{
		id: "basic/enter-starts-editing-then-commits-moves-down",
		title: "starts editing on Enter, commits and moves down on second Enter",
		demoId: DEMO_ID,
		route: "/basic",
		steps: [
			{ kind: "click", at: { row: 1, col: 0 }, caption: "Click A2" },
			{ kind: "press", key: "Enter", caption: "Enter → starts editing" },
			// Editor is open and cursor stays on row 1
			{ kind: "assertSelection", anchor: { row: 1, col: 0 } },
			{ kind: "press", key: "Enter", caption: "Enter → commits + moves down" },
			{ kind: "assertSelection", anchor: { row: 2, col: 0 } },
		],
	},

	// ── Editor arrow-key behaviour (custom introspection) ──────────────

	{
		id: "basic/left-right-arrows-stay-inside-cell-editor",
		title: "keeps left/right arrows inside the cell editor",
		demoId: DEMO_ID,
		route: "/basic",
		// Demo-skipped: almost every step is a `custom` introspection — reads
		// editor value + caret position via driver evaluate. Captions would
		// read well but nothing interesting changes on screen, so it plays as
		// a sequence of still frames. Pure regression test, not a demo.
		skipInReplay: true,
		steps: [
			{ kind: "click", at: { row: 0, col: 0 }, caption: "Click A1" },
			{ kind: "press", key: "Enter", caption: "Enter → starts editing (cursor at end)" },
			{
				kind: "custom",
				caption: "Editor value is 'Alice', cursor at end",
				run: async (d) => {
					const editor = await readEditorState(d);
					if (editor?.value !== "Alice") {
						throw new Error(`editor value expected 'Alice', got ${JSON.stringify(editor?.value)}`);
					}
					const len = "Alice".length;
					if (editor.selectionStart !== len || editor.selectionEnd !== len) {
						throw new Error(
							`editor caret expected (${len},${len}), got (${editor.selectionStart},${editor.selectionEnd})`,
						);
					}
				},
			},
			{
				kind: "custom",
				caption: "ArrowLeft moves caret inside editor (selection unchanged)",
				run: async (d) => {
					const mounted = await dispatchEditorArrowKey(d, "ArrowLeft");
					if (!mounted) throw new Error("editor unmounted after ArrowLeft");
					const editor = await readEditorState(d);
					if (editor?.value !== "Alice") {
						throw new Error(`editor value changed: ${JSON.stringify(editor?.value)}`);
					}
				},
			},
			{ kind: "assertSelection", anchor: { row: 0, col: 0 } },
			{ kind: "press", key: "Escape", caption: "Escape cancels" },
			{ kind: "doubleClick", at: { row: 0, col: 0 }, caption: "Double-click (selects full text)" },
			{
				kind: "custom",
				caption: "Editor caret spans the full value",
				run: async (d) => {
					const editor = await readEditorState(d);
					if (editor?.selectionStart !== 0 || editor.selectionEnd !== "Alice".length) {
						throw new Error(
							`editor caret after dblclick expected (0,5), got (${editor?.selectionStart},${editor?.selectionEnd})`,
						);
					}
				},
			},
			{
				kind: "custom",
				caption: "ArrowRight keeps caret inside editor",
				run: async (d) => {
					const mounted = await dispatchEditorArrowKey(d, "ArrowRight");
					if (!mounted) throw new Error("editor unmounted after ArrowRight");
					const editor = await readEditorState(d);
					if (editor?.value !== "Alice") {
						throw new Error(`editor value changed: ${JSON.stringify(editor?.value)}`);
					}
				},
			},
			{ kind: "assertSelection", anchor: { row: 0, col: 0 } },
			{ kind: "press", key: "Escape", caption: "Escape cancels" },
		],
	},
];

// ── Driver-aware helpers for custom steps ─────────────────────────────────

type EditorState = { value: string; selectionStart: number | null; selectionEnd: number | null };

async function readEditorState(driver: { kind: "stagehand" | "dom" }): Promise<EditorState | null> {
	if (driver.kind === "stagehand") {
		const sh = driver as unknown as StagehandDriver;
		return sh.page.evaluate(() => {
			const active = document.activeElement;
			if (!(active instanceof HTMLInputElement)) return null;
			return {
				value: active.value,
				selectionStart: active.selectionStart,
				selectionEnd: active.selectionEnd,
			};
		});
	}
	// dom
	const input = document.querySelector(".se-cell-editor");
	if (!(input instanceof HTMLInputElement)) return null;
	return {
		value: input.value,
		selectionStart: input.selectionStart,
		selectionEnd: input.selectionEnd,
	};
}

async function dispatchEditorArrowKey(
	driver: { kind: "stagehand" | "dom" },
	key: "ArrowLeft" | "ArrowRight",
): Promise<boolean> {
	if (driver.kind === "stagehand") {
		const sh = driver as unknown as StagehandDriver;
		const result = await sh.page.evaluate((pressedKey: "ArrowLeft" | "ArrowRight") => {
			const input = document.querySelector(".se-cell-editor");
			if (!(input instanceof HTMLInputElement)) return null;
			const event = new KeyboardEvent("keydown", {
				key: pressedKey,
				code: pressedKey,
				bubbles: true,
				cancelable: true,
			});
			input.dispatchEvent(event);
			return {
				editorStillMounted:
					document.querySelector(".se-cell-editor") instanceof HTMLInputElement,
			};
		}, key);
		return Boolean(result?.editorStillMounted);
	}
	// dom
	const input = document.querySelector(".se-cell-editor");
	if (!(input instanceof HTMLInputElement)) return false;
	input.dispatchEvent(
		new KeyboardEvent("keydown", { key, code: key, bubbles: true, cancelable: true }),
	);
	return document.querySelector(".se-cell-editor") instanceof HTMLInputElement;
}
