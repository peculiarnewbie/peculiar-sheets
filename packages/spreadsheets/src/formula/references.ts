import type { CellAddress, CellRange, CellValue } from "../types";
import { normalizeRange } from "../core/selection";

const A1_REFERENCE_PATTERN = /(?<![A-Za-z0-9_!])(\$?[A-Z]{1,3}\$?\d+)(?::(\$?[A-Z]{1,3}\$?\d+))?/g;

export function columnIndexToLetters(col: number): string {
	let index = col;
	let letters = "";

	do {
		const remainder = index % 26;
		letters = String.fromCharCode(65 + remainder) + letters;
		index = Math.floor(index / 26) - 1;
	} while (index >= 0);

	return letters;
}

export function lettersToColumnIndex(text: string): number {
	let result = 0;

	for (const char of text.toUpperCase()) {
		result = result * 26 + (char.charCodeAt(0) - 64);
	}

	return result - 1;
}

export function addressToA1(address: CellAddress): string {
	return `${columnIndexToLetters(address.col)}${address.row + 1}`;
}

export function rangeToA1(range: CellRange): string {
	const normalized = normalizeRange(range);
	const start = addressToA1(normalized.start);
	const end = addressToA1(normalized.end);
	return start === end ? start : `${start}:${end}`;
}

export function isFormulaText(text: string): boolean {
	return text.startsWith("=");
}

export function isFormulaValue(value: CellValue): boolean {
	return typeof value === "string" && isFormulaText(value);
}

export function shiftFormulaByDelta(
	formula: string,
	rowDelta: number,
	colDelta: number,
): string {
	if (!isFormulaText(formula)) return formula;

	return formula.replace(
		A1_REFERENCE_PATTERN,
		(match, startRef: string, endRef?: string) => {
			const shiftedStart = shiftA1Reference(startRef, rowDelta, colDelta);
			if (!shiftedStart) return match;
			if (!endRef) return shiftedStart;

			const shiftedEnd = shiftA1Reference(endRef, rowDelta, colDelta);
			if (!shiftedEnd) return match;

			return `${shiftedStart}:${shiftedEnd}`;
		},
	);
}

export function canInsertReferenceAtCaret(
	text: string,
	caret: { start: number; end: number },
): boolean {
	if (!isFormulaText(text)) return false;
	if (caret.start !== caret.end) return false;

	const position = caret.start;
	if (position < 1 || position > text.length) return false;

	let index = position - 1;
	while (index >= 0 && text[index] === " ") {
		index -= 1;
	}

	if (index < 0) return false;

	const previous = text[index];
	if (!previous) return false;

	return "=+-*/^(,:&<>".includes(previous);
}

interface ParsedA1Reference {
	colAbsolute: boolean;
	colIndex: number;
	rowAbsolute: boolean;
	rowIndex: number;
}

function shiftA1Reference(
	reference: string,
	rowDelta: number,
	colDelta: number,
): string | null {
	const parsed = parseA1Reference(reference);
	if (!parsed) return null;

	const nextCol = parsed.colAbsolute ? parsed.colIndex : parsed.colIndex + colDelta;
	const nextRow = parsed.rowAbsolute ? parsed.rowIndex : parsed.rowIndex + rowDelta;

	if (nextCol < 0 || nextRow < 0) return null;

	const colPrefix = parsed.colAbsolute ? "$" : "";
	const rowPrefix = parsed.rowAbsolute ? "$" : "";

	return `${colPrefix}${columnIndexToLetters(nextCol)}${rowPrefix}${nextRow + 1}`;
}

function parseA1Reference(reference: string): ParsedA1Reference | null {
	const match = reference.match(/^(\$?)([A-Z]{1,3})(\$?)(\d+)$/);
	if (!match) return null;

	const [, colLock, letters, rowLock, rowText] = match;
	const rowNumber = Number(rowText);
	if (!Number.isInteger(rowNumber) || rowNumber < 1) return null;

	return {
		colAbsolute: colLock === "$",
		colIndex: lettersToColumnIndex(letters!),
		rowAbsolute: rowLock === "$",
		rowIndex: rowNumber - 1,
	};
}
