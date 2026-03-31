import type { CellMutation, CellValue, ColumnDef } from "../types";
import { iterateRange, normalizeRange } from "./selection";
import type { SheetStore } from "./state";

// ── Delete Selected Cells ────────────────────────────────────────────────────

export function deleteSelectedCells(
	store: SheetStore,
	columns: ColumnDef[],
): CellMutation[] {
	const sel = store.selection();
	const mutations: CellMutation[] = [];

	for (const range of sel.ranges) {
		const nr = normalizeRange(range);
		for (const addr of iterateRange(nr)) {
			const colDef = columns[addr.col];
			if (!colDef || colDef.editable === false) continue;

			const oldValue = store.cells[addr.row]?.[addr.col] ?? null;
			if (oldValue === null) continue;

			mutations.push({
				address: addr,
				columnId: colDef.id,
				oldValue,
				newValue: null,
				source: "delete",
			});
		}
	}

	return mutations;
}

// ── Apply Mutations to Store ─────────────────────────────────────────────────

export function applyMutations(
	store: SheetStore,
	mutations: CellMutation[],
	recordHistory: boolean = true,
): void {
	if (mutations.length === 0) return;

	const selectionBefore = store.selection();

	store.setCells(
		mutations.map((m) => ({
			row: m.address.row,
			col: m.address.col,
			value: m.newValue,
		})),
	);

	if (recordHistory) {
		store.pushMutations(mutations, selectionBefore, store.selection());
	}
}

// ── Single Cell Edit ─────────────────────────────────────────────────────────

export function commitCellEdit(
	store: SheetStore,
	row: number,
	col: number,
	newValue: CellValue,
	columns: ColumnDef[],
): CellMutation | null {
	const colDef = columns[col];
	if (!colDef) return null;

	const oldValue = store.cells[row]?.[col] ?? null;
	if (oldValue === newValue) return null;

	const mutation: CellMutation = {
		address: { row, col },
		columnId: colDef.id,
		oldValue,
		newValue,
		source: "user",
	};

	applyMutations(store, [mutation]);
	return mutation;
}
