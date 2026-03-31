import { describe, expect, it } from "bun:test";
import {
	extendSelection,
	iterateRange,
	moveSelection,
	normalizeRange,
	selectAll,
	selectCell,
	selectionContains,
	isSingleCell,
	addRange,
} from "./selection";
import type { CellRange } from "../types";

describe("selection", () => {
	describe("selectCell", () => {
		it("should create a single-cell selection", () => {
			const sel = selectCell({ row: 2, col: 3 });
			expect(sel.ranges).toHaveLength(1);
			expect(sel.anchor).toEqual({ row: 2, col: 3 });
			expect(sel.focus).toEqual({ row: 2, col: 3 });
			expect(sel.editing).toBeNull();
		});

		it("should be recognized as single cell", () => {
			const sel = selectCell({ row: 0, col: 0 });
			expect(isSingleCell(sel)).toBe(true);
		});
	});

	describe("extendSelection", () => {
		it("should create a range from anchor to focus", () => {
			const sel = extendSelection({ row: 1, col: 1 }, { row: 3, col: 4 });
			expect(sel.ranges).toHaveLength(1);
			expect(sel.ranges[0]!.start).toEqual({ row: 1, col: 1 });
			expect(sel.ranges[0]!.end).toEqual({ row: 3, col: 4 });
			expect(sel.anchor).toEqual({ row: 1, col: 1 });
			expect(sel.focus).toEqual({ row: 3, col: 4 });
		});

		it("should normalize reversed ranges", () => {
			const sel = extendSelection({ row: 5, col: 5 }, { row: 2, col: 1 });
			expect(sel.ranges[0]!.start).toEqual({ row: 2, col: 1 });
			expect(sel.ranges[0]!.end).toEqual({ row: 5, col: 5 });
		});
	});

	describe("moveSelection", () => {
		const bounds = { rowCount: 10, colCount: 8 };

		it("should move down", () => {
			const sel = selectCell({ row: 3, col: 2 });
			const next = moveSelection(sel, "down", false, false, bounds);
			expect(next.focus).toEqual({ row: 4, col: 2 });
		});

		it("should move up", () => {
			const sel = selectCell({ row: 3, col: 2 });
			const next = moveSelection(sel, "up", false, false, bounds);
			expect(next.focus).toEqual({ row: 2, col: 2 });
		});

		it("should not go below zero", () => {
			const sel = selectCell({ row: 0, col: 0 });
			const next = moveSelection(sel, "up", false, false, bounds);
			expect(next.focus).toEqual({ row: 0, col: 0 });
		});

		it("should not exceed bounds", () => {
			const sel = selectCell({ row: 9, col: 7 });
			const next = moveSelection(sel, "down", false, false, bounds);
			expect(next.focus).toEqual({ row: 9, col: 7 });
		});

		it("should extend range with shift", () => {
			const sel = selectCell({ row: 3, col: 2 });
			const next = moveSelection(sel, "down", true, false, bounds);
			expect(next.anchor).toEqual({ row: 3, col: 2 });
			expect(next.focus).toEqual({ row: 4, col: 2 });
			expect(isSingleCell(next)).toBe(false);
		});
	});

	describe("selectionContains", () => {
		it("should detect cells inside range", () => {
			const sel = extendSelection({ row: 1, col: 1 }, { row: 3, col: 3 });
			expect(selectionContains(sel, { row: 2, col: 2 })).toBe(true);
			expect(selectionContains(sel, { row: 1, col: 1 })).toBe(true);
			expect(selectionContains(sel, { row: 3, col: 3 })).toBe(true);
		});

		it("should detect cells outside range", () => {
			const sel = extendSelection({ row: 1, col: 1 }, { row: 3, col: 3 });
			expect(selectionContains(sel, { row: 0, col: 0 })).toBe(false);
			expect(selectionContains(sel, { row: 4, col: 2 })).toBe(false);
		});
	});

	describe("selectAll", () => {
		it("should select the entire grid", () => {
			const sel = selectAll(5, 3);
			expect(sel.ranges[0]!.start).toEqual({ row: 0, col: 0 });
			expect(sel.ranges[0]!.end).toEqual({ row: 4, col: 2 });
		});

		it("should return empty for zero dimensions", () => {
			const sel = selectAll(0, 0);
			expect(sel.ranges).toHaveLength(0);
		});
	});

	describe("normalizeRange", () => {
		it("should swap reversed coordinates", () => {
			const range: CellRange = {
				start: { row: 5, col: 3 },
				end: { row: 2, col: 1 },
			};
			const nr = normalizeRange(range);
			expect(nr.start).toEqual({ row: 2, col: 1 });
			expect(nr.end).toEqual({ row: 5, col: 3 });
		});
	});

	describe("iterateRange", () => {
		it("should yield all cells in range", () => {
			const range: CellRange = {
				start: { row: 0, col: 0 },
				end: { row: 1, col: 2 },
			};
			const cells = [...iterateRange(range)];
			expect(cells).toHaveLength(6);
			expect(cells[0]).toEqual({ row: 0, col: 0 });
			expect(cells[5]).toEqual({ row: 1, col: 2 });
		});
	});

	describe("addRange", () => {
		it("should add a new range to existing selection", () => {
			const sel = selectCell({ row: 0, col: 0 });
			const next = addRange(sel, { start: { row: 3, col: 3 }, end: { row: 4, col: 4 } });
			expect(next.ranges).toHaveLength(2);
		});
	});
});
