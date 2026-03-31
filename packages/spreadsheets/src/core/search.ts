import type { CellAddress, CellValue } from "../types";

// ── Search Logic ────────────────────────────────────────────────────────────

function formatCellValueForSearch(value: CellValue): string {
	if (value === null || value === undefined) return "";
	if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
	return String(value);
}

/**
 * Scans all cells in the grid and returns addresses of cells whose display
 * value contains the query string (case-insensitive). Results are in
 * row-major order (sorted by row, then column).
 */
export function findMatches(
	getDisplayValue: (row: number, col: number) => CellValue,
	rowCount: number,
	colCount: number,
	query: string,
): CellAddress[] {
	if (!query) return [];

	const lowerQuery = query.toLowerCase();
	const matches: CellAddress[] = [];

	for (let row = 0; row < rowCount; row++) {
		for (let col = 0; col < colCount; col++) {
			const display = formatCellValueForSearch(getDisplayValue(row, col));
			if (display.toLowerCase().includes(lowerQuery)) {
				matches.push({ row, col });
			}
		}
	}

	return matches;
}

/**
 * Converts an array of CellAddress matches into a Set of "row,col" keys
 * for O(1) membership testing when rendering cells.
 */
export function createMatchSet(matches: CellAddress[]): Set<string> {
	const set = new Set<string>();
	for (const addr of matches) {
		set.add(`${addr.row},${addr.col}`);
	}
	return set;
}
