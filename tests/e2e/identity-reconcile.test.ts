import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import type { Stagehand } from "@browserbasehq/stagehand";
import {
	closePage,
	getPage,
	getStagehand,
	navigateTo,
	newPage,
	withSheetCtrl,
} from "./setup";

describe("controlled identity replacement", () => {
	let sh: Stagehand;

	beforeAll(async () => {
		sh = await getStagehand();
		await newPage();
	});

	beforeEach(async () => {
		await navigateTo(sh, "/identity-reconcile");
	});

	afterAll(async () => {
		await closePage();
	});

	it("normalizes selection and exits edit mode when the selected identity disappears", async () => {
		await withSheetCtrl((controller) => {
			controller.setSelection([{ start: { row: 2, col: 0 }, end: { row: 2, col: 0 } }]);
			controller.startEditing(2, 0);
		});
		await getPage().waitForTimeout(25);
		await getPage().evaluate(() => window.__IDENTITY_REPLACE_WITH_DISJOINT_DATA__?.());
		await getPage().waitForTimeout(25);

		const state = await withSheetCtrl((controller) => ({
			selection: controller.getSelection(),
			editorText: controller.getEditorText(),
			value: controller.getRawCellValue(0, 0),
		}));
		expect(state.selection.anchor.row).toBe(0);
		expect(state.selection.focus.row).toBe(0);
		expect(state.selection.ranges).toHaveLength(1);
		expect(state.editorText).toBeNull();
		expect(state.value).toBe("replacement");
	});
});
