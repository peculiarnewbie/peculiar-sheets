import {
	AllCommunityModule,
	ModuleRegistry,
	createGrid,
	themeQuartz,
	type ColDef,
	type GetRowIdParams,
} from "ag-grid-community";
import type { BenchmarkAdapter, BenchmarkCellValue, BenchmarkController, BenchmarkDataset } from "../types";

ModuleRegistry.registerModules([AllCommunityModule]);

export const adapter: BenchmarkAdapter = {
	mount(container, dataset) {
		const fields = Array.from({ length: dataset.columns }, (_, column) => `col${column}`);
		const toRowData = (nextDataset: BenchmarkDataset) => nextDataset.values.map((row, index) => ({
			id: nextDataset.rowIds[index],
			...Object.fromEntries(fields.map((field, column) => [field, row[column] ?? null])),
		}));
		const rowData = toRowData(dataset);
		const columnDefs: ColDef[] = fields.map((field, column) => ({
			field,
			headerName: `Col ${column}`,
			width: 100,
			editable: true,
		}));
		const api = createGrid(container, {
			theme: themeQuartz,
			rowData,
			columnDefs,
			getRowId: (params: GetRowIdParams) => params.data.id as string,
			rowHeight: 28,
			animateRows: false,
		});

		return {
			getScrollElement() {
				const viewport = container.querySelector<HTMLElement>(".ag-grid-viewport");
				if (!viewport) throw new Error("AG Grid viewport was not rendered");
				return viewport;
			},
			readCell(row, column) {
				const rowNode = api.getDisplayedRowAtIndex(row);
				if (!rowNode) throw new Error(`AG Grid row ${row} is unavailable`);
				return (rowNode.data?.[fields[column]!] ?? null) as BenchmarkCellValue;
			},
			scrollToRow: (row) => api.ensureIndexVisible(row, "middle"),
			writeCell(row, column, value) {
				const rowNode = api.getDisplayedRowAtIndex(row);
				if (!rowNode) throw new Error(`AG Grid row ${row} is unavailable`);
				rowNode.updateData({ ...rowNode.data, [fields[column]!]: value });
			},
			writeCells(writes) {
				const changedRows = new Set<Record<string, BenchmarkCellValue>>();
				for (const write of writes) {
					const rowNode = api.getDisplayedRowAtIndex(write.row);
					if (!rowNode?.data) throw new Error(`AG Grid row ${write.row} is unavailable`);
					rowNode.data[fields[write.column]!] = write.value;
					changedRows.add(rowNode.data);
				}
				api.applyTransaction({ update: [...changedRows] });
			},
			replaceDataset(nextDataset) {
				api.setGridOption("rowData", toRowData(nextDataset));
			},
			destroy: () => api.destroy(),
		} satisfies BenchmarkController;
	},
};
