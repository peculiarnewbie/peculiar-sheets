export interface RowMetrics {
	getRowHeight(visualRow: number): number;
	getRowTop(visualRow: number): number;
	getTotalHeight(): number;
	getVisualRowAtOffset(offsetY: number): number;
}

export interface RowMetricsSnapshot extends RowMetrics {
	heights: number[];
	offsets: number[];
	totalHeight: number;
}

export function buildRowMetrics(
	rowCount: number,
	defaultRowHeight: number,
	getRowHeightOverride: (visualRow: number) => number | undefined,
): RowMetricsSnapshot {
	const heights: number[] = new Array(rowCount);
	const offsets: number[] = new Array(rowCount);
	let runningTop = 0;

	for (let row = 0; row < rowCount; row++) {
		offsets[row] = runningTop;
		const nextHeight = getRowHeightOverride(row) ?? defaultRowHeight;
		heights[row] = nextHeight;
		runningTop += nextHeight;
	}

	function getRowHeight(visualRow: number): number {
		return heights[visualRow] ?? defaultRowHeight;
	}

	function getRowTop(visualRow: number): number {
		if (visualRow <= 0) return 0;
		if (visualRow >= rowCount) return runningTop;
		return offsets[visualRow] ?? 0;
	}

	function getVisualRowAtOffset(offsetY: number): number {
		if (rowCount === 0) return 0;
		if (offsetY <= 0) return 0;
		if (offsetY >= runningTop) return rowCount - 1;

		let low = 0;
		let high = rowCount - 1;

		while (low <= high) {
			const mid = Math.floor((low + high) / 2);
			const top = offsets[mid] ?? 0;
			const bottom = top + (heights[mid] ?? defaultRowHeight);

			if (offsetY < top) {
				high = mid - 1;
			} else if (offsetY >= bottom) {
				low = mid + 1;
			} else {
				return mid;
			}
		}

		return Math.min(Math.max(low, 0), rowCount - 1);
	}

	return {
		heights,
		offsets,
		totalHeight: runningTop,
		getRowHeight,
		getRowTop,
		getTotalHeight: () => runningTop,
		getVisualRowAtOffset,
	};
}
