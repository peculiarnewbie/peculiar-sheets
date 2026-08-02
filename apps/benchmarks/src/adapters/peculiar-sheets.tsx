import { batch, createSignal } from "solid-js";
import { render } from "solid-js/web";
import { Sheet, type CellValue, type ColumnDef, type SheetController } from "peculiar-sheets";
import "peculiar-sheets/styles";
import type { BenchmarkAdapter, BenchmarkController } from "../types";

function createLifecycleCounts() {
	return {
		rowMounts: 0,
		rowCleanups: 0,
		rowLive: 0,
		rowMaxLive: 0,
		cellMounts: 0,
		cellCleanups: 0,
		cellLive: 0,
		cellMaxLive: 0,
	};
}

export const adapter: BenchmarkAdapter = {
	mount(container, dataset) {
		const lifecycleDiagnosticsEnabled = new URLSearchParams(location.search).get("lifecycle") === "1";
		if (lifecycleDiagnosticsEnabled) {
			window.__PECULIAR_SHEETS_LIFECYCLE__ = createLifecycleCounts();
		}
		const columns: ColumnDef[] = Array.from({ length: dataset.columns }, (_, column) => ({
			id: `col${column}`,
			header: `Col ${column}`,
			width: 100,
			editable: true,
		}));
		const [data, setData] = createSignal(dataset.values as CellValue[][]);
		const [rowIds, setRowIds] = createSignal(dataset.rowIds);
		let sheet: SheetController | null = null;
		const dispose = render(
			() => (
				<Sheet
					data={data()}
					columns={columns}
					rowIds={rowIds()}
					ref={(controller) => { sheet = controller; }}
				/>
			),
			container,
		);
		if (!sheet) throw new Error("peculiar-sheets did not expose its controller during mount");

		const controller: SheetController = sheet;
		return {
			getScrollElement() {
				const viewport = container.querySelector<HTMLElement>(".se-viewport");
				if (!viewport) throw new Error("peculiar-sheets viewport was not rendered");
				return viewport;
			},
			readCell: (row, column) => controller.getRawCellValue(row, column),
			scrollToRow: (row) => controller.scrollToCell(row, 0),
			writeCell: (row, column, value) => controller.setCellValue(row, column, value as CellValue),
			writeCells: (writes) => controller.setCellValues(
				writes.map((write) => ({ row: write.row, col: write.column, value: write.value as CellValue })),
			),
			replaceDataset(nextDataset) {
				const diagnostics = window.__PECULIAR_SHEETS_RECONCILIATION__;
				const start = diagnostics ? performance.now() : 0;
				batch(() => {
					setData(nextDataset.values as CellValue[][]);
					setRowIds(nextDataset.rowIds);
				});
				if (diagnostics) {
					diagnostics.durations["solid.hostSignalUpdate"] =
						(diagnostics.durations["solid.hostSignalUpdate"] ?? 0) + performance.now() - start;
				}
			},
			destroy() {
				dispose();
				if (lifecycleDiagnosticsEnabled) {
					delete window.__PECULIAR_SHEETS_LIFECYCLE__;
				}
			},
		} satisfies BenchmarkController;
	},
};
