import type { CellValue } from "../types";
import { type PhysicalRowIndex, type RowId, toNumber } from "./brands";

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

export interface IdentityReconcileTarget {
	rowIds(): RowId[];
	rowCount(): number;
	colCount(): number;
	cells: CellValue[][];
	getPhysicalRowForRowId(id: RowId): PhysicalRowIndex | null;
	deleteRowsAt(atIndex: number, count: number): void;
	insertRowsWithIds(atIndex: number, ids: RowId[]): void;
	reorderRows(nextOrder: RowId[]): void;
	setCells(mutations: Array<{ row: PhysicalRowIndex; col: number; value: CellValue }>): void;
	resizeColumns(colCount: number): void;
}

/**
 * Reconcile store structure and cell data to match host row identity + data.
 * Mutates the target store in place.
 */
export function reconcileByRowIdentity(
	target: IdentityReconcileTarget,
	data: CellValue[][],
	hostRowIds: readonly RowId[],
	colCount: number,
): boolean {
	validateRowIds(hostRowIds, data.length);

	let didChange = false;

	if (colCount !== target.colCount()) {
		target.resizeColumns(colCount);
		didChange = true;
	}

	const hostKeySet = new Set(hostRowIds);

	// Remove rows whose identity is absent from the host (bottom-up to preserve indices).
	let currentIds = target.rowIds();
	for (let i = currentIds.length - 1; i >= 0; i--) {
		const id = currentIds[i];
		if (id === undefined) continue;
		if (!hostKeySet.has(id)) {
			target.deleteRowsAt(i, 1);
			didChange = true;
			currentIds = target.rowIds();
		}
	}

	// Insert rows for host keys missing from the store (high index first).
	currentIds = target.rowIds();
	const storeKeySet = new Set(currentIds);
	const toInsert: Array<{ hostIndex: number; id: RowId }> = [];
	for (let hostIndex = 0; hostIndex < hostRowIds.length; hostIndex++) {
		const id = hostRowIds[hostIndex];
		if (id === undefined) continue;
		if (!storeKeySet.has(id)) {
			toInsert.push({ hostIndex, id });
		}
	}
	for (const { hostIndex, id } of toInsert.sort((a, b) => b.hostIndex - a.hostIndex)) {
		target.insertRowsWithIds(hostIndex, [id]);
		didChange = true;
	}

	// Permute rows to match host key order.
	currentIds = target.rowIds();
	if (!rowIdsEqual(currentIds, hostRowIds)) {
		target.reorderRows([...hostRowIds]);
		didChange = true;
	}

	// Reconcile cells by row identity, not physical index.
	const mutations: Array<{ row: PhysicalRowIndex; col: number; value: CellValue }> = [];
	for (let hostIndex = 0; hostIndex < hostRowIds.length; hostIndex++) {
		const id = hostRowIds[hostIndex];
		const dataRow = data[hostIndex];
		if (id === undefined || dataRow === undefined) continue;

		const physRow = target.getPhysicalRowForRowId(id);
		if (physRow === null) continue;

		const colEnd = Math.max(dataRow.length, colCount);
		for (let c = 0; c < colEnd; c++) {
			const externalValue = (c < dataRow.length ? dataRow[c] : null) ?? null;
			const internalValue = target.cells[toNumber(physRow)]?.[c] ?? null;
			if (externalValue !== internalValue) {
				mutations.push({ row: physRow, col: c, value: externalValue });
			}
		}
	}

	if (mutations.length > 0) {
		target.setCells(mutations);
		didChange = true;
	}

	return didChange;
}
