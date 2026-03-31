import { describe, expect, it } from "bun:test";
import { canRedo, canUndo, createHistory, pushHistory, redo, undo } from "./history";
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
	it("should start empty", () => {
		const h = createHistory();
		expect(canUndo(h)).toBe(false);
		expect(canRedo(h)).toBe(false);
	});

	it("should support push and undo", () => {
		let h = createHistory();
		h = pushHistory(h, [makeMutation(0, 0, 1, 2)], sel0, sel1);

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
		h = pushHistory(h, [makeMutation(0, 0, 1, 2)], sel0, sel1);

		const undoResult = undo(h)!;
		const redoResult = redo(undoResult.history)!;

		expect(redoResult.mutations).toHaveLength(1);
		expect(redoResult.mutations[0]!.newValue).toBe(2); // forward replay
		expect(canUndo(redoResult.history)).toBe(true);
		expect(canRedo(redoResult.history)).toBe(false);
	});

	it("should clear redo stack on new push", () => {
		let h = createHistory();
		h = pushHistory(h, [makeMutation(0, 0, 1, 2)], sel0, sel1);
		h = undo(h)!.history;

		expect(canRedo(h)).toBe(true);

		h = pushHistory(h, [makeMutation(0, 0, 1, 3)], sel0, sel1);
		expect(canRedo(h)).toBe(false);
	});

	it("should not push empty mutations", () => {
		let h = createHistory();
		h = pushHistory(h, [], sel0, sel1);
		expect(canUndo(h)).toBe(false);
	});
});
