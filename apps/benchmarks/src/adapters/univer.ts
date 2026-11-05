import { LifecycleStages, LocaleType, type ICellData } from "@univerjs/core";
import { createUniver } from "@univerjs/presets";
import { UniverSheetsCorePreset } from "@univerjs/preset-sheets-core";
import enUS from "@univerjs/preset-sheets-core/locales/en-US";
import "@univerjs/preset-sheets-core/lib/index.css";
import type { BenchmarkAdapter, BenchmarkDataset } from "../types";

function cellData(dataset: BenchmarkDataset): Record<number, Record<number, ICellData>> {
	return Object.fromEntries(
		dataset.values.map((row, index) => [
			index,
			Object.fromEntries(row.map((value, column) => [column, { v: value }])),
		]),
	);
}

export const adapter: BenchmarkAdapter = {
	async mount(container, dataset) {
		const { univer, univerAPI } = createUniver({
			locale: LocaleType.EN_US,
			locales: { [LocaleType.EN_US]: enUS },
			presets: [
				UniverSheetsCorePreset({
					container,
					header: false,
					toolbar: false,
					formulaBar: false,
					footer: false,
				}),
			],
		});
		const workbook = univerAPI.createWorkbook({
			id: "benchmark-workbook",
			name: "Benchmark",
			sheetOrder: ["benchmark-sheet"],
			sheets: {
				"benchmark-sheet": {
					id: "benchmark-sheet",
					name: "Benchmark",
					rowCount: dataset.rows,
					columnCount: dataset.columns,
					defaultRowHeight: 28,
					defaultColumnWidth: 100,
					cellData: cellData(dataset),
				},
			},
		});
		const sheet = workbook.getActiveSheet();
		while (univerAPI.getCurrentLifecycleStage() < LifecycleStages.Rendered) {
			await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
		}
		return {
			getScrollElement: () => container,
			getScrollPosition() {
				const position = sheet.getScrollState();
				return {
					top: position.sheetViewStartRow * 28 + position.offsetY,
					left: position.sheetViewStartColumn * 100 + position.offsetX,
				};
			},
			scrollToProgress(axis, progress) {
				const visible = sheet.getVisibleRange();
				const rows = visible
					? visible.endRow - visible.startRow + 1
					: Math.floor(container.clientHeight / 28);
				const columns = visible
					? visible.endColumn - visible.startColumn + 1
					: Math.floor(container.clientWidth / 100);
				const row =
					axis === "vertical" ? Math.round(progress * Math.max(0, sheet.getMaxRows() - rows)) : 0;
				const column =
					axis === "horizontal"
						? Math.round(progress * Math.max(0, sheet.getMaxColumns() - columns))
						: 0;
				sheet.scrollToCell(row, column, 0);
			},
			scrollToRow: (row) => {
				sheet.scrollToCell(row, 0, 0);
			},
			readCell: (row, column) => sheet.getRange(row, column).getValue(),
			writeCell: (row, column, value) => {
				sheet.getRange(row, column).setValue({ v: value });
			},
			writeCells(writes) {
				const values: Record<number, Record<number, ICellData>> = {};
				for (const { row, column, value } of writes) {
					const cells = values[row] ?? (values[row] = {});
					cells[column] = { v: value };
				}
				sheet.getRange(0, 0, sheet.getMaxRows(), sheet.getMaxColumns()).setValues(values);
			},
			replaceDataset(next) {
				if (next.rows < sheet.getMaxRows() || next.columns < sheet.getMaxColumns())
					sheet.clear({ contentsOnly: true });
				sheet.setRowCount(next.rows);
				sheet.setColumnCount(next.columns);
				sheet.getRange(0, 0, next.rows, next.columns).setValues(cellData(next));
			},
			destroy: () => univer.dispose(),
		};
	},
};
