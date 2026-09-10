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

import { createSignal, type Accessor } from "solid-js";
import type {
	CellMutation,
	CellValue,
	RowReorderMutation,
	SheetController,
	SheetOperation,
} from "peculiar-sheets";

export interface MutationBufferBindings {
	onOperation: (operation: SheetOperation) => void;
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

export function createMutationBuffer(params: CreateMutationBufferParams): MutationBuffer {
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
			(() => {
				setMutations([]);
				setRowReorders([]);
			})();
		},

		reset() {
			(() => {
				setData(snapshot());
				setMutations([]);
				setRowReorders([]);
			})();
		},

		bindings(getController) {
			return {
				onOperation(operation) {
					switch (operation.type) {
						case "cell-edit":
							(() => {
								setMutations((prev) => [...prev, operation.mutation]);
								applyMutation(operation.mutation);
							})();
							break;
						case "batch-edit":
							(() => {
								setMutations((prev) => [...prev, ...operation.mutations]);
								for (const m of operation.mutations) applyMutation(m);
							})();
							break;
						case "row-insert":
							setData((prev) => {
								const next = prev.map((row) => [...row]);
								const emptyRows = Array.from({ length: operation.count }, () =>
									new Array<CellValue>(params.columnCount).fill(null),
								);
								next.splice(operation.atIndex, 0, ...emptyRows);
								return next;
							});
							// Re-read from the controller so formula refs rewritten by the engine
							// propagate back into the host data.
							rereadAllFromController(params.columnCount, getController);
							break;
						case "row-delete":
							setData((prev) => {
								const next = prev.map((row) => [...row]);
								next.splice(operation.atIndex, operation.count);
								return next;
							});
							rereadAllFromController(params.columnCount, getController);
							break;
						case "row-reorder":
							(() => {
								setRowReorders((prev) => [...prev, operation.mutation]);
								setData((prev) => {
									const next = new Array<CellValue[]>(prev.length)
										.fill(null as unknown as CellValue[])
										.map(() => [] as CellValue[]);
									for (
										let oldIndex = 0;
										oldIndex < operation.mutation.indexOrder.length;
										oldIndex++
									) {
										const newIndex = operation.mutation.indexOrder[oldIndex];
										if (newIndex === undefined || newIndex < 0) continue;
										next[newIndex] = [...(prev[oldIndex] ?? [])];
									}
									return next;
								});
							})();
							break;
					}
				},
			};
		},
	};
}
