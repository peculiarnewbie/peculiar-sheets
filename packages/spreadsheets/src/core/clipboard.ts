import type { CellAddress, CellMutation, CellRange, CellValue, ColumnDef } from "../types";
import { normalizeRange } from "./selection";

// ── TSV Serialization ────────────────────────────────────────────────────────

export function serializeToTSV(
	cells: CellValue[][],
	range: CellRange,
): string {
	const nr = normalizeRange(range);
	const lines: string[] = [];

	for (let row = nr.start.row; row <= nr.end.row; row++) {
		const rowCells: string[] = [];
		for (let col = nr.start.col; col <= nr.end.col; col++) {
			const value = cells[row]?.[col];
			rowCells.push(stringifyCellValue(value));
		}
		lines.push(rowCells.join("\t"));
	}

	return lines.join("\n");
}

export function parseTSV(text: string): CellValue[][] {
	if (!text.trim()) return [];

	return text.split("\n").map((line) =>
		line.split("\t").map((cell) => parseCellValue(cell)),
	);
}

// ── Paste Logic ──────────────────────────────────────────────────────────────

export function buildPasteMutations(
	parsed: CellValue[][],
	target: CellAddress,
	currentCells: CellValue[][],
	columns: ColumnDef[],
): CellMutation[] {
	const mutations: CellMutation[] = [];

	for (let r = 0; r < parsed.length; r++) {
		const pasteRow = parsed[r];
		if (!pasteRow) continue;
		const targetRow = target.row + r;

		for (let c = 0; c < pasteRow.length; c++) {
			const targetCol = target.col + c;
			const colDef = columns[targetCol];
			if (!colDef) continue;
			if (colDef.editable === false) continue;

			const oldValue = currentCells[targetRow]?.[targetCol] ?? null;
			const newValue = pasteRow[c] ?? null;

			mutations.push({
				address: { row: targetRow, col: targetCol },
				columnId: colDef.id,
				oldValue,
				newValue,
				source: "paste",
			});
		}
	}

	return mutations;
}

// ── Value Helpers ────────────────────────────────────────────────────────────

function stringifyCellValue(value: CellValue | undefined): string {
	if (value === null || value === undefined) return "";
	return String(value);
}

function parseCellValue(text: string): CellValue {
	if (text === "") return null;

	const trimmed = text.trim();
	if (trimmed.startsWith("=")) {
		let rest = trimmed.slice(1);
		while (rest.startsWith("=")) {
			rest = rest.slice(1);
		}
		return `=${rest}`;
	}

	// Try number
	const num = Number(trimmed);
	if (!Number.isNaN(num)) return num;

	// Try boolean
	if (trimmed === "true") return true;
	if (trimmed === "false") return false;

	return text;
}
