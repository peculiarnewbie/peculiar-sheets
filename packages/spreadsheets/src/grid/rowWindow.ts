import { toNumber, visualRow } from "../core/brands";
import type { RowMetrics } from "./rowMetrics";

export interface RowWindowItem {
	index: number;
	start: number;
	size: number;
}

/** Project only the visible rows; RowMetrics owns all height information. */
export function getRowWindow(
	metrics: RowMetrics,
	rowCount: number,
	scrollTop: number,
	viewportHeight: number,
	previous: RowWindowItem[],
	overscan = 1,
): RowWindowItem[] {
	if (rowCount <= 0 || viewportHeight <= 0) return previous.length ? [] : previous;
	const offset = Math.max(0, scrollTop);
	const firstVisible = toNumber(metrics.getVisualRowAtOffset(offset));
	const bottom = offset + viewportHeight;
	let lastVisible = toNumber(metrics.getVisualRowAtOffset(bottom));
	// An item that begins exactly at the bottom edge is not visible yet.
	if (lastVisible > firstVisible && metrics.getRowTop(visualRow(lastVisible)) === bottom) {
		lastVisible--;
	}
	const first = Math.max(0, firstVisible - overscan);
	const last = Math.min(rowCount - 1, lastVisible + overscan);
	const previousFirst = previous[0]?.index ?? 0;
	const next: RowWindowItem[] = [];
	let unchanged = previous.length === last - first + 1;
	for (let index = first; index <= last; index++) {
		const row = visualRow(index);
		const start = metrics.getRowTop(row);
		const size = metrics.getRowHeight(row);
		const existing = previous[index - previousFirst];
		const item =
			existing?.index === index && existing.start === start && existing.size === size
				? existing
				: { index, start, size };
		unchanged &&= item === previous[next.length];
		next.push(item);
	}
	return unchanged ? previous : next;
}
