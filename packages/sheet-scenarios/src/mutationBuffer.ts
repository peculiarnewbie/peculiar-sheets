/**
 * Shared mutation buffer: single implementation of the reconciliation logic
 * currently duplicated (in spirit) between the e2e harness and any
 * browser-side replay host.
 *
 * Consumers spread `buffer.bindings(getController)` onto `<Sheet>` and read
 * through `buffer.data()` / `buffer.mutations()` / `buffer.rowReorders()`.
 * Both `apps/e2e/src/harness.tsx` and `apps/solid-sheet-www/src/player/ReplayHost.tsx`
 * build on top of this.
 */

import { batch, createSignal, type Accessor } from "solid-js";
import type {
	CellMutation,
	CellValue,
	RowReorderMutation,
	SheetController,
} from "peculiar-sheets";

export interface MutationBufferBindings {
	onCellEdit: (mutation: CellMutation) => void;
	onBatchEdit: (mutations: CellMutation[]) => void;
	onRowInsert: (atIndex: number, count: number) => void;
	onRowDelete: (atIndex: number, count: number) => void;
	onRowReorder: (mutation: RowReorderMutation) => void;
}

export interface MutationBuffer {
	/** Live cell data — feed back into `<Sheet data={...}>`. */
	data: Accessor<CellValue[][]>;
	/** Every mutation recorded since the last `clear()` or `reset()`. */
	mutations: Accessor<CellMutation[]>;
	/** Every row reorder mutation recorded since the last `clear()` or `reset()`. */
	rowReorders: Accessor<RowReorderMutation[]>;
	/** Clear the mutation + reorder logs. Does NOT restore data. */
	clear(): void;
	/** Restore data to the initial snapshot and clear logs. */
	reset(): void;
	/**
	 * Build a bag of props to spread onto `<Sheet>`. The `getController` callback
	 * must return the controller bound to the same `<Sheet>` — required by the
	 * post-insert / post-delete re-read so formula references rewritten by the
	 * engine propagate back into the host data.
	 */
	bindings(getController: () => SheetController | null): MutationBufferBindings;
}

export interface CreateMutationBufferParams {
	initialData: CellValue[][];
	columnCount: number;
}

export function createMutationBuffer(
	params: CreateMutationBufferParams,
): MutationBuffer {
	const snapshot = () => structuredClone(params.initialData);
	const [data, setData] = createSignal<CellValue[][]>(snapshot());
	const [mutations, setMutations] = createSignal<CellMutation[]>([]);
	const [rowReorders, setRowReorders] = createSignal<RowReorderMutation[]>([]);

	function applyMutation(mutation: CellMutation) {
		const { row, col } = mutation.address;
		setData((prev) => {
			const next = prev.map((dataRow) => [...dataRow]);
			while (next.length <= row) next.push([]);
			const targetRow = next[row]!;
			while (targetRow.length <= col) targetRow.push(null);
			targetRow[col] = mutation.newValue;
			return next;
		});
	}

	function rereadAllFromController(
		columnCount: number,
		getController: () => SheetController | null,
	) {
		const controller = getController();
		if (!controller) return;
		setData((prev) => {
			const next = prev.map((row) => [...row]);
			for (let r = 0; r < next.length; r++) {
				for (let c = 0; c < columnCount; c++) {
					next[r]![c] = controller.getCellValue(r, c);
				}
			}
			return next;
		});
	}

	return {
		data,
		mutations,
		rowReorders,

		clear() {
			batch(() => {
				setMutations([]);
				setRowReorders([]);
			});
		},

		reset() {
			batch(() => {
				setData(snapshot());
				setMutations([]);
				setRowReorders([]);
			});
		},

		bindings(getController) {
			return {
				onCellEdit(mutation) {
					batch(() => {
						setMutations((prev) => [...prev, mutation]);
						applyMutation(mutation);
					});
				},
				onBatchEdit(batchMutations) {
					batch(() => {
						setMutations((prev) => [...prev, ...batchMutations]);
						for (const m of batchMutations) applyMutation(m);
					});
				},
				onRowInsert(atIndex, count) {
					setData((prev) => {
						const next = prev.map((row) => [...row]);
						const emptyRows = Array.from({ length: count }, () =>
							new Array<CellValue>(params.columnCount).fill(null),
						);
						next.splice(atIndex, 0, ...emptyRows);
						return next;
					});
					// Re-read from the controller so formula refs rewritten by the engine
					// propagate back into the host data.
					rereadAllFromController(params.columnCount, getController);
				},
				onRowDelete(atIndex, count) {
					setData((prev) => {
						const next = prev.map((row) => [...row]);
						next.splice(atIndex, count);
						return next;
					});
					rereadAllFromController(params.columnCount, getController);
				},
				onRowReorder(mutation) {
					batch(() => {
						setRowReorders((prev) => [...prev, mutation]);
						setData((prev) => {
							const next = new Array<CellValue[]>(prev.length)
								.fill(null as unknown as CellValue[])
								.map(() => [] as CellValue[]);
							for (let oldIndex = 0; oldIndex < mutation.indexOrder.length; oldIndex++) {
								const newIndex = mutation.indexOrder[oldIndex];
								if (newIndex === undefined || newIndex < 0) continue;
								next[newIndex] = [...(prev[oldIndex] ?? [])];
							}
							return next;
						});
					});
				},
			};
		},
	};
}
