import { type RowId } from "./brands";

/** Prefix for provisional row IDs allocated before the host assigns a domain key. */
export const PROVISIONAL_ROW_ID_PREFIX = "__ps_pending_";

export function isProvisionalRowId(id: RowId): boolean {
	return id.startsWith(PROVISIONAL_ROW_ID_PREFIX);
}

export function allocateProvisionalRowIds(count: number, startCounter: number): RowId[] {
	return Array.from({ length: count }, (_, index) =>
		`${PROVISIONAL_ROW_ID_PREFIX}${startCounter + index}` as RowId,
	);
}

export function validateRowIds(ids: readonly RowId[], rowCount: number): void {
	if (ids.length !== rowCount) {
		throw new Error(`rowIds length (${ids.length}) must match data length (${rowCount})`);
	}
	const seen = new Set<string>();
	for (const id of ids) {
		if (seen.has(id)) {
			throw new Error(`Duplicate rowId found: ${id}`);
		}
		seen.add(id);
	}
}

export function rowIdsEqual(a: readonly RowId[], b: readonly RowId[]): boolean {
	return a.length === b.length && a.every((id, index) => id === b[index]);
}
