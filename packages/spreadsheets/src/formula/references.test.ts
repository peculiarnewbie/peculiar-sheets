import { describe, expect, it } from "bun:test";
import {
	addressToA1,
	canInsertReferenceAtCaret,
	columnIndexToLetters,
	isFormulaText,
	lettersToColumnIndex,
	rangeToA1,
	shiftFormulaByDelta,
} from "./references";

describe("formula references", () => {
	it("converts column indices to letters", () => {
		expect(columnIndexToLetters(0)).toBe("A");
		expect(columnIndexToLetters(25)).toBe("Z");
		expect(columnIndexToLetters(26)).toBe("AA");
		expect(columnIndexToLetters(27)).toBe("AB");
	});

	it("converts letters to column indices", () => {
		expect(lettersToColumnIndex("A")).toBe(0);
		expect(lettersToColumnIndex("Z")).toBe(25);
		expect(lettersToColumnIndex("AA")).toBe(26);
	});

	it("serializes addresses and ranges as A1 references", () => {
		expect(addressToA1({ row: 0, col: 0 })).toBe("A1");
		expect(addressToA1({ row: 9, col: 27 })).toBe("AB10");
		expect(rangeToA1({
			start: { row: 1, col: 1 },
			end: { row: 3, col: 3 },
		})).toBe("B2:D4");
	});

	it("detects formula text", () => {
		expect(isFormulaText("=A1+B1")).toBe(true);
		expect(isFormulaText("42")).toBe(false);
	});

	it("only enables reference insertion after reference-eligible symbols", () => {
		expect(canInsertReferenceAtCaret("=", { start: 1, end: 1 })).toBe(true);
		expect(canInsertReferenceAtCaret("=A1+", { start: 4, end: 4 })).toBe(true);
		expect(canInsertReferenceAtCaret("=SUM(", { start: 5, end: 5 })).toBe(true);
		expect(canInsertReferenceAtCaret("=A1", { start: 3, end: 3 })).toBe(false);
		expect(canInsertReferenceAtCaret("=E13+E14", { start: 8, end: 8 })).toBe(false);
		expect(canInsertReferenceAtCaret("=A1+B1", { start: 0, end: 0 })).toBe(false);
		expect(canInsertReferenceAtCaret("=A1+B1", { start: 1, end: 4 })).toBe(false);
	});

	it("shifts relative references downward", () => {
		expect(shiftFormulaByDelta("=A1", 1, 0)).toBe("=A2");
		expect(shiftFormulaByDelta("=B3", 2, 0)).toBe("=B5");
		expect(shiftFormulaByDelta("=A1+B1", 2, 0)).toBe("=A3+B3");
	});

	it("preserves absolute markers while shifting", () => {
		expect(shiftFormulaByDelta("=$A1", 1, 0)).toBe("=$A2");
		expect(shiftFormulaByDelta("=A$1", 1, 0)).toBe("=A$1");
		expect(shiftFormulaByDelta("=$A$1", 5, 3)).toBe("=$A$1");
	});

	it("shifts ranges and multiple references", () => {
		expect(shiftFormulaByDelta("=SUM(A1:B2)", 1, 0)).toBe("=SUM(A2:B3)");
		expect(shiftFormulaByDelta("=SUM($A1:B$2)", 2, 0)).toBe("=SUM($A3:B$2)");
	});

	it("preserves unsupported reference syntaxes unchanged", () => {
		expect(shiftFormulaByDelta("=Sheet2!A1", 1, 0)).toBe("=Sheet2!A1");
		expect(shiftFormulaByDelta("=Table[Column]", 1, 0)).toBe("=Table[Column]");
	});
});
