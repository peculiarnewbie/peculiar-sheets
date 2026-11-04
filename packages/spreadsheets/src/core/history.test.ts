import { describe, expect, it } from "bun:test";
import { rowId } from "./brands";
import {
	canRedo,
	canUndo,
	createHistory,
	pushColumnResizeHistory,
	pushMutationHistory,
	pushRowReorderHistory,
	pushRowResizeHistory,
	redo,
	undo,
} from "./history";
import type { CellMutation } from "../types";
import { selectCell } from "./selection";

function makeMutation(row: number, col: number, oldVal: number, newVal: number): CellMutation {
	return {
		address: { row, col },
		columnId: `col${col}`,
		oldValue: oldVal,
		newValue: newVal,
		source: "user",
	};
}

const sel0 = selectCell({ row: 0, col: 0 });
const sel1 = selectCell({ row: 1, col: 0 });

describe("history", () => {
	it("does not construct inverse records until undo", () => {
		let oldReads = 0;
		const forward: CellMutation = {
			...makeMutation(0, 0, 1, 2),
			get oldValue() {
				oldReads++;
				return 1;
			},
		};
		const history = pushMutationHistory(createHistory(), [forward], sel0, sel1);
		expect(oldReads).toBe(0);
		expect(undo(history)?.mutations[0]?.newValue).toBe(1);
		expect(oldReads).toBe(1);
	});
	it("retains 200 mixed entries and lazily replays full mutation identities", () => {
		let history = createHistory();
		for (let i = 0; i < 205; i++) {
			history = pushMutationHistory(
				history,
				[
					{
						...makeMutation(0, 0, i, i + 1),
						viewAddress: { row: 1, col: 0 },
						rowId: rowId("stable"),
					},
				],
				sel0,
				sel1,
			);
		}
		history = pushColumnResizeHistory(
			history,
			{ columnId: "col0", oldWidth: 10, newWidth: 20 },
			sel0,
			sel1,
		);
		expect(history.undoStack).toHaveLength(200);
		const resizeUndo = undo(history);
		if (!resizeUndo) throw new Error("Missing resize undo");
		expect(resizeUndo.columnResize?.width).toBe(10);
		const cellUndo = undo(resizeUndo.history);
		if (!cellUndo) throw new Error("Missing cell undo");
		expect(cellUndo.mutations[0]).toMatchObject({
			oldValue: 205,
			newValue: 204,
			rowId: rowId("stable"),
			viewAddress: { row: 1, col: 0 },
		});
		const cellRedo = redo(cellUndo.history);
		if (!cellRedo) throw new Error("Missing cell redo");
		expect(cellRedo.mutations[0]?.newValue).toBe(205);
		const again = undo(cellRedo.history);
		expect(again?.mutations).toEqual(cellUndo.mutations);
		const resizeRedo = redo(cellRedo.history);
		expect(resizeRedo?.columnResize?.width).toBe(20);
		let remaining = cellRedo.history;
		let count = 0;
		for (;;) {
			const result = undo(remaining);
			if (!result) break;
			remaining = result.history;
			count++;
		}
		expect(count).toBe(199);
	});
	it("should start empty", () => {
		const h = createHistory();
		expect(canUndo(h)).toBe(false);
		expect(canRedo(h)).toBe(false);
	});

	it("should support push and undo", () => {
		let h = createHistory();
		h = pushMutationHistory(h, [makeMutation(0, 0, 1, 2)], sel0, sel1);

		expect(canUndo(h)).toBe(true);
		expect(canRedo(h)).toBe(false);

		const result = undo(h);
		expect(result).not.toBeNull();
		expect(result!.mutations).toHaveLength(1);
		expect(result!.mutations[0]!.newValue).toBe(1); // inverse: old and new swapped
		expect(canUndo(result!.history)).toBe(false);
		expect(canRedo(result!.history)).toBe(true);
	});

	it("should support redo after undo", () => {
		let h = createHistory();
		h = pushMutationHistory(h, [makeMutation(0, 0, 1, 2)], sel0, sel1);

		const undoResult = undo(h)!;
		const redoResult = redo(undoResult.history)!;

		expect(redoResult.mutations).toHaveLength(1);
		expect(redoResult.mutations[0]!.newValue).toBe(2); // forward replay
		expect(canUndo(redoResult.history)).toBe(true);
		expect(canRedo(redoResult.history)).toBe(false);
	});

	it("should clear redo stack on new push", () => {
		let h = createHistory();
		h = pushMutationHistory(h, [makeMutation(0, 0, 1, 2)], sel0, sel1);
		h = undo(h)!.history;

		expect(canRedo(h)).toBe(true);

		h = pushMutationHistory(h, [makeMutation(0, 0, 1, 3)], sel0, sel1);
		expect(canRedo(h)).toBe(false);
	});

	it("should not push empty mutations", () => {
		let h = createHistory();
		h = pushMutationHistory(h, [], sel0, sel1);
		expect(canUndo(h)).toBe(false);
	});

	it("should support row reorder undo and redo", () => {
		let h = createHistory();
		h = pushRowReorderHistory(
			h,
			{
				columnId: "name",
				direction: "asc",
				oldOrder: [10, 11, 12],
				newOrder: [11, 12, 10],
			},
			sel0,
			sel1,
		);

		const undoResult = undo(h)!;
		expect(undoResult.rowReorder).toEqual({
			columnId: "name",
			direction: "asc",
			oldOrder: [11, 12, 10],
			newOrder: [10, 11, 12],
			indexOrder: [1, 2, 0],
			source: "undo",
		});

		const redoResult = redo(undoResult.history)!;
		expect(redoResult.rowReorder).toEqual({
			columnId: "name",
			direction: "asc",
			oldOrder: [10, 11, 12],
			newOrder: [11, 12, 10],
			indexOrder: [2, 0, 1],
			source: "redo",
		});
	});

	it("should support column resize undo and redo", () => {
		let h = createHistory();
		h = pushColumnResizeHistory(h, { columnId: "name", oldWidth: 120, newWidth: 180 }, sel0, sel1);

		const undoResult = undo(h)!;
		expect(undoResult.columnResize).toEqual({
			columnId: "name",
			width: 120,
		});

		const redoResult = redo(undoResult.history)!;
		expect(redoResult.columnResize).toEqual({
			columnId: "name",
			width: 180,
		});
	});

	it("should support row resize undo and redo", () => {
		let h = createHistory();
		h = pushRowResizeHistory(h, { rowId: rowId("42"), oldHeight: 28, newHeight: 56 }, sel0, sel1);

		const undoResult = undo(h)!;
		expect(undoResult.rowResize).toEqual({
			rowId: rowId("42"),
			height: 28,
		});

		const redoResult = redo(undoResult.history)!;
		expect(redoResult.rowResize).toEqual({
			rowId: rowId("42"),
			height: 56,
		});
	});
});
