import { describe, expect, it } from "bun:test";
import type { CellRange, CellValue, ColumnDef } from "../types";
import { createSheetStore } from "./state";
import { applyMutations } from "./commands";
import {
	buildVerticalFillMutations,
	computeFillPreview,
	getAutoFillSourceRange,
	resolveAutoFillMode,
} from "./autofill";

function range(
	startRow: number,
	startCol: number,
	endRow: number,
	endCol: number,
): CellRange {
	return {
		start: { row: startRow, col: startCol },
		end: { row: endRow, col: endCol },
	};
}

function makeColumns(
	count: number,
	overrides?: Record<number, Partial<ColumnDef>>,
): ColumnDef[] {
	return Array.from({ length: count }, (_, index) => ({
		id: `col${index}`,
		header: `Col ${index + 1}`,
		editable: true,
		...(overrides?.[index] ?? {}),
	}));
}

function mutationValues(mutations: ReturnType<typeof buildVerticalFillMutations>) {
	return mutations.map((mutation) => ({
		row: mutation.address.row,
		col: mutation.address.col,
		value: mutation.newValue,
		source: mutation.source,
	}));
}

describe("autofill geometry", () => {
	it("accepts a single-column source dragged downward with matching width", () => {
		expect(
			computeFillPreview(range(1, 0, 2, 0), { row: 5, col: 0 }, "vertical"),
		).toEqual({
			axis: "vertical",
			source: range(1, 0, 2, 0),
			extension: range(3, 0, 5, 0),
			direction: "down",
		});
	});

	it("accepts a multi-column source dragged downward with matching width", () => {
		expect(
			computeFillPreview(range(1, 1, 2, 2), { row: 4, col: 2 }, "vertical"),
		).toEqual({
			axis: "vertical",
			source: range(1, 1, 2, 2),
			extension: range(3, 1, 4, 2),
			direction: "down",
		});
	});

	it("accepts upward extension with matching width", () => {
		expect(
			computeFillPreview(range(3, 1, 4, 1), { row: 1, col: 1 }, "vertical"),
		).toEqual({
			axis: "vertical",
			source: range(3, 1, 4, 1),
			extension: range(1, 1, 2, 1),
			direction: "up",
		});
	});

	it("clamps horizontal drift into source row to no-op", () => {
		// Target row is inside the source range, so even after clamping col it's a no-op
		expect(
			computeFillPreview(range(1, 1, 2, 1), { row: 2, col: 3 }, "vertical"),
		).toBeNull();
	});

	it("clamps diagonal drift to vertical fill", () => {
		// Target col 3 clamps to col 2 (source end), row 4 is below source
		expect(
			computeFillPreview(range(1, 1, 2, 2), { row: 4, col: 3 }, "vertical"),
		).toEqual({
			axis: "vertical",
			source: range(1, 1, 2, 2),
			extension: range(3, 1, 4, 2),
			direction: "down",
		});
	});

	it("clamps leftward drift to vertical fill", () => {
		// Target col 0 clamps to col 1 (source start), row 4 is below source
		expect(
			computeFillPreview(range(1, 1, 2, 2), { row: 4, col: 0 }, "vertical"),
		).toEqual({
			axis: "vertical",
			source: range(1, 1, 2, 2),
			extension: range(3, 1, 4, 2),
			direction: "down",
		});
	});

	it("rejects empty destination", () => {
		expect(
			computeFillPreview(range(1, 1, 2, 1), { row: 2, col: 1 }, "vertical"),
		).toBeNull();
	});

	it("treats drag ending inside the source range as no-op", () => {
		expect(
			computeFillPreview(range(1, 1, 3, 1), { row: 2, col: 1 }, "vertical"),
		).toBeNull();
	});

	it("treats multi-range selection as unsupported", () => {
		expect(getAutoFillSourceRange({
			ranges: [range(0, 0, 0, 0), range(2, 2, 2, 2)],
			anchor: { row: 0, col: 0 },
			focus: { row: 2, col: 2 },
			editing: null,
		})).toBeNull();
	});

	it("preview normalizes reversed drag coordinates", () => {
		expect(
			computeFillPreview(range(4, 2, 2, 1), { row: 0, col: 2 }, "vertical"),
		).toEqual({
			axis: "vertical",
			source: range(2, 1, 4, 2),
			extension: range(0, 1, 1, 2),
			direction: "up",
		});
	});
});

describe("autofill mode resolution", () => {
	it("uses copy mode for a single text seed", () => {
		expect(resolveAutoFillMode(["foo"])).toBe("copy");
	});

	it("uses formula-copy mode for formula-only seeds", () => {
		expect(resolveAutoFillMode(["=A1", "=A2"])).toBe("formula-copy");
	});

	it("uses linear-series mode for numeric seeds", () => {
		expect(resolveAutoFillMode([1, 2, 3])).toBe("linear-series");
	});

	it("falls back to copy for mixed numeric and null seeds", () => {
		expect(resolveAutoFillMode([1, null])).toBe("copy");
	});

	it("falls back to copy for mixed types", () => {
		expect(resolveAutoFillMode([1, "2"])).toBe("copy");
	});
});

describe("autofill mutations", () => {
	it("single text cell dragged down repeats text", () => {
		const columns = makeColumns(1);
		const cells: CellValue[][] = [["foo"], [null], [null], [null]];
		const preview = computeFillPreview(range(0, 0, 0, 0), { row: 3, col: 0 }, "vertical")!;
		const mutations = buildVerticalFillMutations(
			range(0, 0, 0, 0),
			preview,
			cells,
			columns,
		);

		expect(mutationValues(mutations)).toEqual([
			{ row: 1, col: 0, value: "foo", source: "fill" },
			{ row: 2, col: 0, value: "foo", source: "fill" },
			{ row: 3, col: 0, value: "foo", source: "fill" },
		]);
	});

	it("two text cells dragged down tile in order", () => {
		const columns = makeColumns(1);
		const cells: CellValue[][] = [["A"], ["B"], [null], [null], [null], [null]];
		const preview = computeFillPreview(range(0, 0, 1, 0), { row: 5, col: 0 }, "vertical")!;
		const mutations = buildVerticalFillMutations(
			range(0, 0, 1, 0),
			preview,
			cells,
			columns,
		);

		expect(mutationValues(mutations)).toEqual([
			{ row: 2, col: 0, value: "A", source: "fill" },
			{ row: 3, col: 0, value: "B", source: "fill" },
			{ row: 4, col: 0, value: "A", source: "fill" },
			{ row: 5, col: 0, value: "B", source: "fill" },
		]);
	});

	it("null values inside seed are copied as null", () => {
		const columns = makeColumns(1);
		const cells: CellValue[][] = [[null], ["X"], [null], [null], [null], [null]];
		const preview = computeFillPreview(range(0, 0, 1, 0), { row: 5, col: 0 }, "vertical")!;
		const mutations = buildVerticalFillMutations(
			range(0, 0, 1, 0),
			preview,
			cells,
			columns,
		);

		expect(mutationValues(mutations)).toEqual([
			{ row: 3, col: 0, value: "X", source: "fill" },
			{ row: 5, col: 0, value: "X", source: "fill" },
		]);
	});

	it("copied values preserve booleans", () => {
		const columns = makeColumns(1);
		const cells: CellValue[][] = [[true], [null], [null]];
		const preview = computeFillPreview(range(0, 0, 0, 0), { row: 2, col: 0 }, "vertical")!;
		const mutations = buildVerticalFillMutations(
			range(0, 0, 0, 0),
			preview,
			cells,
			columns,
		);

		expect(mutationValues(mutations)).toEqual([
			{ row: 1, col: 0, value: true, source: "fill" },
			{ row: 2, col: 0, value: true, source: "fill" },
		]);
	});

	it("copied values skip non-editable targets", () => {
		const columns = makeColumns(2, {
			1: { editable: false },
		});
		const cells: CellValue[][] = [["A", "B"], [null, null], [null, null]];
		const preview = computeFillPreview(range(0, 0, 0, 1), { row: 2, col: 1 }, "vertical")!;
		const mutations = buildVerticalFillMutations(
			range(0, 0, 0, 1),
			preview,
			cells,
			columns,
		);

		expect(mutationValues(mutations)).toEqual([
			{ row: 1, col: 0, value: "A", source: "fill" },
			{ row: 2, col: 0, value: "A", source: "fill" },
		]);
	});

	it("no-op copies where old value already equals new value are omitted from mutations", () => {
		const columns = makeColumns(1);
		const cells: CellValue[][] = [["A"], ["A"], [null]];
		const preview = computeFillPreview(range(0, 0, 0, 0), { row: 2, col: 0 }, "vertical")!;
		const mutations = buildVerticalFillMutations(
			range(0, 0, 0, 0),
			preview,
			cells,
			columns,
		);

		expect(mutationValues(mutations)).toEqual([
			{ row: 2, col: 0, value: "A", source: "fill" },
		]);
	});

	it("builds numeric linear series independently per column", () => {
		const columns = makeColumns(2);
		const cells: CellValue[][] = [
			[1, 10],
			[2, 7],
			[null, null],
			[null, null],
			[null, null],
		];
		const preview = computeFillPreview(range(0, 0, 1, 1), { row: 4, col: 1 }, "vertical")!;
		const mutations = buildVerticalFillMutations(
			range(0, 0, 1, 1),
			preview,
			cells,
			columns,
		);

		expect(mutationValues(mutations)).toEqual([
			{ row: 2, col: 0, value: 3, source: "fill" },
			{ row: 2, col: 1, value: 4, source: "fill" },
			{ row: 3, col: 0, value: 4, source: "fill" },
			{ row: 3, col: 1, value: 1, source: "fill" },
			{ row: 4, col: 0, value: 5, source: "fill" },
			{ row: 4, col: 1, value: -2, source: "fill" },
		]);
	});

	it("supports upward numeric series fill", () => {
		const columns = makeColumns(1);
		const cells: CellValue[][] = [[null], [null], [1], [2]];
		const preview = computeFillPreview(range(2, 0, 3, 0), { row: 0, col: 0 }, "vertical")!;
		const mutations = buildVerticalFillMutations(
			range(2, 0, 3, 0),
			preview,
			cells,
			columns,
		);

		expect(mutationValues(mutations)).toEqual([
			{ row: 0, col: 0, value: -1, source: "fill" },
			{ row: 1, col: 0, value: 0, source: "fill" },
		]);
	});

	it("falls back to copy mode when a source column is mixed non-numeric", () => {
		const columns = makeColumns(1);
		const cells: CellValue[][] = [[1], ["x"], [null], [null], [null]];
		const preview = computeFillPreview(range(0, 0, 1, 0), { row: 4, col: 0 }, "vertical")!;
		const mutations = buildVerticalFillMutations(
			range(0, 0, 1, 0),
			preview,
			cells,
			columns,
		);

		expect(mutationValues(mutations)).toEqual([
			{ row: 2, col: 0, value: 1, source: "fill" },
			{ row: 3, col: 0, value: "x", source: "fill" },
			{ row: 4, col: 0, value: 1, source: "fill" },
		]);
	});

	it("a single numeric seed copies instead of inferring", () => {
		const columns = makeColumns(1);
		const cells: CellValue[][] = [[7], [null], [null]];
		const preview = computeFillPreview(range(0, 0, 0, 0), { row: 2, col: 0 }, "vertical")!;
		const mutations = buildVerticalFillMutations(
			range(0, 0, 0, 0),
			preview,
			cells,
			columns,
		);

		expect(mutationValues(mutations)).toEqual([
			{ row: 1, col: 0, value: 7, source: "fill" },
			{ row: 2, col: 0, value: 7, source: "fill" },
		]);
	});

	it("supports decimals, negatives, and zero-step series", () => {
		const columns = makeColumns(3);
		const cells: CellValue[][] = [
			[1.5, -1, 5],
			[2.0, 1, 5],
			[null, null, null],
			[null, null, null],
		];
		const preview = computeFillPreview(range(0, 0, 1, 2), { row: 3, col: 2 }, "vertical")!;
		const mutations = buildVerticalFillMutations(
			range(0, 0, 1, 2),
			preview,
			cells,
			columns,
		);

		expect(mutationValues(mutations)).toEqual([
			{ row: 2, col: 0, value: 2.5, source: "fill" },
			{ row: 2, col: 1, value: 3, source: "fill" },
			{ row: 2, col: 2, value: 5, source: "fill" },
			{ row: 3, col: 0, value: 3.0, source: "fill" },
			{ row: 3, col: 1, value: 5, source: "fill" },
			{ row: 3, col: 2, value: 5, source: "fill" },
		]);
	});

	it("formula seeds shift relative references per tiled source row", () => {
		const columns = makeColumns(2);
		const cells: CellValue[][] = [
			["=A1", 1],
			["=A2", 2],
			[null, null],
			[null, null],
			[null, null],
			[null, null],
		];
		const preview = computeFillPreview(range(0, 0, 1, 1), { row: 5, col: 1 }, "vertical")!;
		const mutations = buildVerticalFillMutations(
			range(0, 0, 1, 1),
			preview,
			cells,
			columns,
		);

		expect(mutationValues(mutations)).toEqual([
			{ row: 2, col: 0, value: "=A3", source: "fill" },
			{ row: 2, col: 1, value: 3, source: "fill" },
			{ row: 3, col: 0, value: "=A4", source: "fill" },
			{ row: 3, col: 1, value: 4, source: "fill" },
			{ row: 4, col: 0, value: "=A5", source: "fill" },
			{ row: 4, col: 1, value: 5, source: "fill" },
			{ row: 5, col: 0, value: "=A6", source: "fill" },
			{ row: 5, col: 1, value: 6, source: "fill" },
		]);
	});

	it("2x2 block of literals tiles downward correctly", () => {
		const columns = makeColumns(2);
		const cells: CellValue[][] = [
			["A", "B"],
			["C", "D"],
			[null, null],
			[null, null],
			[null, null],
			[null, null],
		];
		const preview = computeFillPreview(range(0, 0, 1, 1), { row: 5, col: 1 }, "vertical")!;
		const mutations = buildVerticalFillMutations(
			range(0, 0, 1, 1),
			preview,
			cells,
			columns,
		);

		expect(mutationValues(mutations)).toEqual([
			{ row: 2, col: 0, value: "A", source: "fill" },
			{ row: 2, col: 1, value: "B", source: "fill" },
			{ row: 3, col: 0, value: "C", source: "fill" },
			{ row: 3, col: 1, value: "D", source: "fill" },
			{ row: 4, col: 0, value: "A", source: "fill" },
			{ row: 4, col: 1, value: "B", source: "fill" },
			{ row: 5, col: 0, value: "C", source: "fill" },
			{ row: 5, col: 1, value: "D", source: "fill" },
		]);
	});

	it("entirely non-editable destination produces zero mutations", () => {
		const columns = makeColumns(1, {
			0: { editable: false },
		});
		const cells: CellValue[][] = [[1], [null], [null]];
		const preview = computeFillPreview(range(0, 0, 0, 0), { row: 2, col: 0 }, "vertical")!;
		const mutations = buildVerticalFillMutations(
			range(0, 0, 0, 0),
			preview,
			cells,
			columns,
		);

		expect(mutations).toHaveLength(0);
	});
});

describe("autofill history semantics", () => {
	it("one fill generates one batch mutation list and one undo/redo entry", () => {
		const columns = makeColumns(1);
		const store = createSheetStore([[1], [2], [null], [null], [null]], columns);
		const preview = computeFillPreview(range(0, 0, 1, 0), { row: 4, col: 0 }, "vertical")!;
		const mutations = buildVerticalFillMutations(
			range(0, 0, 1, 0),
			preview,
			store.cells,
			columns,
		);

		expect(mutations).toHaveLength(3);
		applyMutations(store, mutations);

		expect(store.history().undoStack).toHaveLength(1);
		expect(store.cells[2]?.[0]).toBe(3);
		expect(store.cells[3]?.[0]).toBe(4);
		expect(store.cells[4]?.[0]).toBe(5);

		const undoMutations = store.undo();
		expect(undoMutations).not.toBeNull();
		expect(store.cells[2]?.[0]).toBeNull();
		expect(store.cells[3]?.[0]).toBeNull();
		expect(store.cells[4]?.[0]).toBeNull();

		const redoMutations = store.redo();
		expect(redoMutations).not.toBeNull();
		expect(store.cells[2]?.[0]).toBe(3);
		expect(store.cells[3]?.[0]).toBe(4);
		expect(store.cells[4]?.[0]).toBe(5);
	});
});
