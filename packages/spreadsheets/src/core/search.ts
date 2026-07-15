import type { PhysicalCellAddress, CellValue } from "../types";
import type { Accessor } from "solid-js";
import { type ColumnIndex, type PhysicalRowIndex, columnIdx, physicalRow, toNumber } from "./brands";
import { defaultFormatCellValue } from "./formatting";

export interface ActiveSearchScan {
	query: string;
	rowCount: number;
	colCount: number;
	dataRevision: number;
	formulaRevision: number;
}

/**
 * Creates a dynamically-tracked search source. Grid revisions are deliberately
 * read only while a query is active, so ordinary writes do not invalidate idle
 * search state or every rendered cell's search classes.
 */
export function createActiveSearchScanSource(options: {
	query: Accessor<string>;
	rowCount: Accessor<number>;
	colCount: Accessor<number>;
	dataRevision: Accessor<number>;
	formulaRevision: Accessor<number>;
}): Accessor<ActiveSearchScan | null> {
	return () => {
		const query = options.query();
		if (!query) return null;
		return {
			query,
			rowCount: options.rowCount(),
			colCount: options.colCount(),
			dataRevision: options.dataRevision(),
			formulaRevision: options.formulaRevision(),
		};
	};
}

// ── Search Logic ────────────────────────────────────────────────────────────

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
): PhysicalCellAddress[] {
	if (!query) return [];

	const lowerQuery = query.toLowerCase();
	const matches: PhysicalCellAddress[] = [];

	for (let row = 0; row < rowCount; row++) {
		for (let col = 0; col < colCount; col++) {
			const display = defaultFormatCellValue(getDisplayValue(row, col));
			if (display.toLowerCase().includes(lowerQuery)) {
				matches.push({ row: physicalRow(row), col: columnIdx(col) });
			}
		}
	}

	return matches;
}

function yieldToBrowser(): Promise<void> {
	return new Promise((resolve) => {
		if (typeof requestAnimationFrame === "function") {
			requestAnimationFrame(() => resolve());
			return;
		}
		setTimeout(resolve, 0);
	});
}

export async function findMatchesChunked(
	getDisplayValue: (row: PhysicalRowIndex, col: ColumnIndex) => CellValue,
	rowCount: number,
	colCount: number,
	query: string,
	options?: {
		chunkSize?: number;
		isCancelled?: () => boolean;
	},
): Promise<PhysicalCellAddress[]> {
	if (!query) return [];

	const lowerQuery = query.toLowerCase();
	const matches: PhysicalCellAddress[] = [];
	const chunkSize = options?.chunkSize ?? 2_000;
	let scannedInChunk = 0;

	for (let row = 0; row < rowCount; row++) {
		for (let col = 0; col < colCount; col++) {
			if (options?.isCancelled?.()) return [];

			const display = defaultFormatCellValue(getDisplayValue(physicalRow(row), columnIdx(col)));
			if (display.toLowerCase().includes(lowerQuery)) {
				matches.push({ row: physicalRow(row), col: columnIdx(col) });
			}

			scannedInChunk += 1;
			if (scannedInChunk >= chunkSize) {
				scannedInChunk = 0;
				await yieldToBrowser();
			}
		}
	}

	return matches;
}

/**
 * Converts an array of CellAddress matches into a Set of "row,col" keys
 * for O(1) membership testing when rendering cells.
 */
export function createMatchSet(matches: PhysicalCellAddress[]): Set<string> {
	const set = new Set<string>();
	for (const addr of matches) {
		set.add(`${toNumber(addr.row)},${toNumber(addr.col)}`);
	}
	return set;
}
