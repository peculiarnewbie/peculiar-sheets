import type { ColumnDef } from "../types";
import { DEFAULT_COL_WIDTH, DEFAULT_MIN_COL_WIDTH } from "../types";

export function clampColumnWidth(column: ColumnDef, width: number): number {
	const minWidth = column.minWidth ?? DEFAULT_MIN_COL_WIDTH;
	const maxWidth = column.maxWidth ?? Number.POSITIVE_INFINITY;
	return Math.min(Math.max(width, minWidth), maxWidth);
}

export function getEffectiveColumnWidth(
	column: ColumnDef,
	committedState: Map<string, number>,
): number {
	const committedWidth = committedState.get(column.id);
	const fallbackWidth = column.width ?? DEFAULT_COL_WIDTH;
	return clampColumnWidth(column, committedWidth ?? fallbackWidth);
}

export function getColumnWidth(
	columnId: string,
	columns: ColumnDef[],
	committedState: Map<string, number>,
): number {
	const column = columns.find((entry) => entry.id === columnId);
	if (!column) return DEFAULT_COL_WIDTH;
	return getEffectiveColumnWidth(column, committedState);
}

export function mapToRecord<TKey extends string | number>(
	map: Map<TKey, number>,
): Record<string, number> {
	const record: Record<string, number> = {};
	for (const [key, value] of map) {
		record[String(key)] = value;
	}
	return record;
}

export function recordToMap<TKey extends string | number>(
	record: Record<string, number> | undefined,
	keyTransform?: (key: string) => TKey,
): Map<TKey, number> {
	const next = new Map<TKey, number>();
	if (!record) return next;

	for (const [key, value] of Object.entries(record)) {
		next.set(keyTransform ? keyTransform(key) : key as TKey, value);
	}

	return next;
}
