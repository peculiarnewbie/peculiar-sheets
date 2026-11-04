import type { CellMutation, CellValue, ColumnDef } from "../types";
import {
	type ColumnIndex,
	type PhysicalRowIndex,
	physicalRow,
	type RowId,
	toNumber,
	type VisualRowIndex,
} from "./brands";
import { iterateRange, normalizeRange } from "./selection";
import type { SheetStore } from "./state";

// ── Delete Selected Cells ────────────────────────────────────────────────────

export function deleteSelectedCells(store: SheetStore, columns: ColumnDef[]): CellMutation[] {
	const sel = store.selection();
	const mutations: CellMutation[] = [];

	for (const range of sel.ranges) {
		const nr = normalizeRange(range);
		for (const addr of iterateRange(nr)) {
			const colDef = columns[toNumber(addr.col)];
			if (!colDef || colDef.editable === false) continue;

			const oldValue = store.cells[toNumber(addr.row)]?.[toNumber(addr.col)] ?? null;
			if (oldValue === null) continue;

			mutations.push({
				address: { row: physicalRow(toNumber(addr.row)), col: addr.col },
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

	const first = mutations[0];
	if (mutations.length === 1 && first) {
		store.setCell(first.address.row, first.address.col, first.newValue);
	} else if (store.setCellMutations) {
		store.setCellMutations(mutations);
	} else {
		store.setCells(
			mutations.map((m) => ({
				row: m.address.row,
				col: m.address.col,
				value: m.newValue,
			})),
		);
	}

	if (recordHistory) {
		store.pushMutations(mutations, selectionBefore, store.selection());
	}
}

// ── Single Cell Edit ─────────────────────────────────────────────────────────

export function commitCellEdit(
	store: SheetStore,
	row: PhysicalRowIndex,
	col: ColumnIndex,
	newValue: CellValue,
	columns: ColumnDef[],
	options?: {
		viewAddress?: { row: VisualRowIndex; col: ColumnIndex };
		rowId?: RowId;
		source?: CellMutation["source"];
	},
): CellMutation | null {
	const colDef = columns[toNumber(col)];
	if (!colDef) return null;

	const oldValue = store.cells[row]?.[toNumber(col)] ?? null;
	if (oldValue === newValue) return null;

	const mutation: CellMutation = {
		address: { row, col },
		...(options?.viewAddress ? { viewAddress: options.viewAddress } : {}),
		...(options?.rowId !== undefined ? { rowId: options.rowId } : {}),
		columnId: colDef.id,
		oldValue,
		newValue,
		source: options?.source ?? "user",
	};

	applyMutations(store, [mutation]);
	return mutation;
}
