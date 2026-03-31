import { describe, expect, it } from "bun:test";
import { parseTSV, serializeToTSV, buildPasteMutations } from "./clipboard";
import type { CellValue, ColumnDef } from "../types";

describe("clipboard", () => {
	describe("serializeToTSV", () => {
		it("should serialize a range to TSV", () => {
			const cells: CellValue[][] = [
				["a", "b", "c"],
				[1, 2, 3],
				[true, false, null],
			];
			const result = serializeToTSV(cells, {
				start: { row: 0, col: 0 },
				end: { row: 2, col: 2 },
			});
			expect(result).toBe("a\tb\tc\n1\t2\t3\ntrue\tfalse\t");
		});

		it("should serialize a partial range", () => {
			const cells: CellValue[][] = [
				["a", "b", "c"],
				[1, 2, 3],
			];
			const result = serializeToTSV(cells, {
				start: { row: 0, col: 1 },
				end: { row: 1, col: 2 },
			});
			expect(result).toBe("b\tc\n2\t3");
		});
	});

	describe("parseTSV", () => {
		it("should parse TSV into cell values", () => {
			const result = parseTSV("hello\t42\ttrue\n\tfalse\t3.14");
			expect(result).toEqual([
				["hello", 42, true],
				[null, false, 3.14],
			]);
		});

		it("should handle empty string", () => {
			expect(parseTSV("")).toEqual([]);
		});

		it("should parse single cell", () => {
			const result = parseTSV("hello");
			expect(result).toEqual([["hello"]]);
		});

		it("should preserve formulas with a single leading equals", () => {
			const result = parseTSV("=E10+E6");
			expect(result).toEqual([["=E10+E6"]]);
		});

		it("should normalize pasted formulas with repeated leading equals", () => {
			const result = parseTSV("==E10+E6");
			expect(result).toEqual([["=E10+E6"]]);
		});
	});

	describe("buildPasteMutations", () => {
		const columns: ColumnDef[] = [
			{ id: "a", header: "A" },
			{ id: "b", header: "B" },
			{ id: "c", header: "C", editable: false },
		];

		it("should build mutations for paste", () => {
			const parsed: CellValue[][] = [
				[10, 20],
			];
			const currentCells: CellValue[][] = [
				[1, 2, 3],
			];
			const mutations = buildPasteMutations(parsed, { row: 0, col: 0 }, currentCells, columns);
			expect(mutations).toHaveLength(2);
			expect(mutations[0]!.oldValue).toBe(1);
			expect(mutations[0]!.newValue).toBe(10);
			expect(mutations[1]!.oldValue).toBe(2);
			expect(mutations[1]!.newValue).toBe(20);
		});

		it("should skip non-editable columns", () => {
			const parsed: CellValue[][] = [
				[10, 20, 30],
			];
			const currentCells: CellValue[][] = [
				[1, 2, 3],
			];
			const mutations = buildPasteMutations(parsed, { row: 0, col: 0 }, currentCells, columns);
			expect(mutations).toHaveLength(2); // Column C is not editable
		});
	});
});
