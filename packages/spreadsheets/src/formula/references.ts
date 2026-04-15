import type { CellAddress, CellRange, CellValue } from "../types";
import { normalizeRange } from "../core/selection";

const A1_REFERENCE_PATTERN = /(?<![A-Za-z0-9_!])(\$?[A-Z]{1,3}\$?\d+)(?::(\$?[A-Z]{1,3}\$?\d+))?/g;
const A1_ROW_OP_REFERENCE_PATTERN = /(?<![A-Za-z0-9_!])(\$?[A-Z]{1,3}\$?\d+)(?::(\$?[A-Z]{1,3}\$?\d+))?/gi;

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

interface StructuralRowRefResult {
	status: "valid" | "deleted";
	value: string;
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

/**
 * Shift a single A1 reference only when its 0-indexed row >= thresholdRow.
 * Returns the shifted string, or null if the reference couldn't be parsed.
 */
function serializeA1Reference(parsed: ParsedA1Reference): string {
	const colPrefix = parsed.colAbsolute ? "$" : "";
	const rowPrefix = parsed.rowAbsolute ? "$" : "";
	return `${colPrefix}${columnIndexToLetters(parsed.colIndex)}${rowPrefix}${parsed.rowIndex + 1}`;
}

function shiftA1ReferenceForRowInsert(
	reference: string,
	insertAtRow: number,
	count: number,
): string | null {
	const parsed = parseA1Reference(reference);
	if (!parsed) return null;

	const nextRow = parsed.rowIndex >= insertAtRow
		? parsed.rowIndex + count
		: parsed.rowIndex;

	return serializeA1Reference({
		...parsed,
		rowIndex: nextRow,
	});
}

function shiftA1ReferenceForRowDelete(
	reference: string,
	deleteAtRow: number,
	count: number,
): StructuralRowRefResult | null {
	const parsed = parseA1Reference(reference);
	if (!parsed) return null;

	if (parsed.rowIndex < deleteAtRow) {
		return { status: "valid", value: serializeA1Reference(parsed) };
	}

	if (parsed.rowIndex >= deleteAtRow + count) {
		return {
			status: "valid",
			value: serializeA1Reference({
				...parsed,
				rowIndex: parsed.rowIndex - count,
			}),
		};
	}

	return { status: "deleted", value: "#REF!" };
}

function rewriteRangeAfterRowDelete(
	startResult: StructuralRowRefResult,
	endResult: StructuralRowRefResult,
): string {
	if (startResult.status === "deleted" && endResult.status === "deleted") {
		return "#REF!";
	}
	if (startResult.status === "deleted") {
		return `#REF!:${endResult.value}`;
	}
	if (endResult.status === "deleted") {
		return `${startResult.value}:#REF!`;
	}
	return `${startResult.value}:${endResult.value}`;
}

/**
 * Rewrite A1 references in a formula after rows are inserted.
 * References whose 0-indexed row >= insertAtRow are shifted by +count.
 * Same-sheet refs are matched case-insensitively and rewritten in normalized A1 form.
 */
export function shiftFormulaReferencesForRowInsert(
	formula: string,
	insertAtRow: number,
	count: number,
): string {
	if (!isFormulaText(formula) || count <= 0) return formula;

	return formula.replace(
		A1_ROW_OP_REFERENCE_PATTERN,
		(match, startRef: string, endRef?: string) => {
			const shiftedStart = shiftA1ReferenceForRowInsert(startRef, insertAtRow, count);
			if (!shiftedStart) return match;
			if (!endRef) return shiftedStart;

			const shiftedEnd = shiftA1ReferenceForRowInsert(endRef, insertAtRow, count);
			if (!shiftedEnd) return match;

			return `${shiftedStart}:${shiftedEnd}`;
		},
	);
}

/**
 * Rewrite A1 references in a formula after rows are deleted.
 * References inside the deleted range become explicit #REF! tokens.
 * Same-sheet refs are matched case-insensitively and rewritten in normalized A1 form.
 */
export function shiftFormulaReferencesForRowDelete(
	formula: string,
	deleteAtRow: number,
	count: number,
): string {
	if (!isFormulaText(formula) || count <= 0) return formula;

	return formula.replace(
		A1_ROW_OP_REFERENCE_PATTERN,
		(match, startRef: string, endRef?: string) => {
			const shiftedStart = shiftA1ReferenceForRowDelete(startRef, deleteAtRow, count);
			if (!shiftedStart) return match;
			if (!endRef) return shiftedStart.value;

			const shiftedEnd = shiftA1ReferenceForRowDelete(endRef, deleteAtRow, count);
			if (!shiftedEnd) return match;

			return rewriteRangeAfterRowDelete(shiftedStart, shiftedEnd);
		},
	);
}

function parseA1Reference(reference: string): ParsedA1Reference | null {
	const match = reference.match(/^(\$?)([A-Z]{1,3})(\$?)(\d+)$/i);
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
