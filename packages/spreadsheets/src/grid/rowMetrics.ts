import { type VisualRowIndex, toNumber, visualRow } from "../core/brands";

export interface RowMetrics {
	getRowHeight(visualRow: VisualRowIndex): number;
	getRowTop(visualRow: VisualRowIndex): number;
	getTotalHeight(): number;
	getVisualRowAtOffset(offsetY: number): VisualRowIndex;
}

/**
 * Sparse override tables for non-default row heights.
 * `prefixDelta[i]` is the cumulative (height - default) for overrides[0..i].
 */
interface SparseHeightTable {
	rows: number[];
	heights: number[];
	prefixDelta: number[];
}

function buildSparseHeightTable(
	rowCount: number,
	defaultRowHeight: number,
	heightOverrides: ReadonlyMap<number, number>,
): SparseHeightTable | null {
	if (heightOverrides.size === 0 || rowCount <= 0) {
		return null;
	}

	const entries: Array<{ row: number; height: number }> = [];
	for (const [row, height] of heightOverrides) {
		if (!Number.isFinite(row) || !Number.isFinite(height)) continue;
		if (row < 0 || row >= rowCount) continue;
		if (height === defaultRowHeight) continue;
		entries.push({ row, height });
	}

	if (entries.length === 0) {
		return null;
	}

	entries.sort((left, right) => left.row - right.row);

	const rows: number[] = [];
	const heights: number[] = [];
	const prefixDelta: number[] = [];
	let runningDelta = 0;

	for (const entry of entries) {
		const lastIndex = rows.length - 1;
		if (lastIndex >= 0 && rows[lastIndex] === entry.row) {
			runningDelta += entry.height - heights[lastIndex]!;
			heights[lastIndex] = entry.height;
			prefixDelta[lastIndex] = runningDelta;
			continue;
		}

		runningDelta += entry.height - defaultRowHeight;
		rows.push(entry.row);
		heights.push(entry.height);
		prefixDelta.push(runningDelta);
	}

	return { rows, heights, prefixDelta };
}

/** Largest index with rows[i] < target, or -1. */
function lastIndexBefore(rows: number[], target: number): number {
	let low = 0;
	let high = rows.length - 1;
	let found = -1;

	while (low <= high) {
		const mid = (low + high) >> 1;
		const value = rows[mid]!;
		if (value < target) {
			found = mid;
			low = mid + 1;
		} else {
			high = mid - 1;
		}
	}

	return found;
}

/** Exact index of target in sorted rows, or -1. */
function indexOfRow(rows: number[], target: number): number {
	let low = 0;
	let high = rows.length - 1;

	while (low <= high) {
		const mid = (low + high) >> 1;
		const value = rows[mid]!;
		if (value === target) return mid;
		if (value < target) {
			low = mid + 1;
		} else {
			high = mid - 1;
		}
	}

	return -1;
}

/**
 * Build row metrics for virtualization.
 *
 * With no height overrides this is O(1) memory and arithmetic lookup.
 * With sparse overrides, storage and lookups are O(overrides) / O(log overrides).
 */
export function buildRowMetrics(
	rowCount: number,
	defaultRowHeight: number,
	heightOverrides: ReadonlyMap<number, number> = new Map(),
): RowMetrics {
	const safeRowCount = Math.max(0, rowCount);
	const sparse = buildSparseHeightTable(safeRowCount, defaultRowHeight, heightOverrides);
	const totalExtra = sparse ? (sparse.prefixDelta[sparse.prefixDelta.length - 1] ?? 0) : 0;
	const totalHeight = safeRowCount * defaultRowHeight + totalExtra;

	function getRowHeight(row: VisualRowIndex): number {
		const index = toNumber(row);
		if (!sparse || index < 0 || index >= safeRowCount) {
			return defaultRowHeight;
		}
		const overrideIndex = indexOfRow(sparse.rows, index);
		return overrideIndex >= 0 ? sparse.heights[overrideIndex]! : defaultRowHeight;
	}

	function getRowTop(row: VisualRowIndex): number {
		const index = toNumber(row);
		if (index <= 0) return 0;
		if (index >= safeRowCount) return totalHeight;
		if (!sparse) {
			return index * defaultRowHeight;
		}
		const before = lastIndexBefore(sparse.rows, index);
		const extra = before >= 0 ? sparse.prefixDelta[before]! : 0;
		return index * defaultRowHeight + extra;
	}

	function getVisualRowAtOffset(offsetY: number): VisualRowIndex {
		if (safeRowCount === 0) return visualRow(0);
		if (offsetY <= 0) return visualRow(0);
		if (offsetY >= totalHeight) return visualRow(safeRowCount - 1);

		if (!sparse) {
			return visualRow(Math.min(Math.floor(offsetY / defaultRowHeight), safeRowCount - 1));
		}

		let low = 0;
		let high = safeRowCount - 1;

		while (low <= high) {
			const mid = (low + high) >> 1;
			const top = getRowTop(visualRow(mid));
			const bottom = top + getRowHeight(visualRow(mid));

			if (offsetY < top) {
				high = mid - 1;
			} else if (offsetY >= bottom) {
				low = mid + 1;
			} else {
				return visualRow(mid);
			}
		}

		return visualRow(Math.min(Math.max(low, 0), safeRowCount - 1));
	}

	return {
		getRowHeight,
		getRowTop,
		getTotalHeight: () => totalHeight,
		getVisualRowAtOffset,
	};
}
