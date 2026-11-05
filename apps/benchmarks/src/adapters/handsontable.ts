import Handsontable from "handsontable/base";
import { registerCellType } from "handsontable/cellTypes/registry";
import { TextCellType } from "handsontable/cellTypes/textType";
import { CopyPaste } from "handsontable/plugins/copyPaste";
import { registerPlugin } from "handsontable/plugins/registry";
import { UndoRedo } from "handsontable/plugins/undoRedo";
import "handsontable/styles/handsontable.css";
import "handsontable/styles/ht-theme-main.css";
import type { BenchmarkAdapter, BenchmarkCellValue, BenchmarkController } from "../types";

// Only what the scenarios exercise; see "Competitor configuration" in benchmarks/README.md.
// The base package already registers the text cell type; registering it again is idempotent.
registerCellType(TextCellType);
registerPlugin(CopyPaste);
registerPlugin(UndoRedo);

export const adapter: BenchmarkAdapter = {
	mount(container, dataset) {
		container.classList.add("ht-theme-main");
		// The theme's default 20px line + 8px padding + border imposes a 29px minimum.
		container.style.setProperty("--ht-cell-vertical-padding", "3px");
		const hot = new Handsontable(container, {
			data: dataset.values,
			rowHeaders: true,
			colHeaders: Array.from({ length: dataset.columns }, (_, column) => `Col ${column}`),
			colWidths: 100,
			rowHeights: 28,
			wordWrap: false,
			autoRowSize: false,
			width: "100%",
			height: "100%",
			licenseKey: "non-commercial-and-evaluation",
		});

		return {
			ui: {
				getVisibleCell() {
					const row = hot.getFirstFullyVisibleRow();
					const column = hot.getFirstFullyVisibleColumn();
					return row < 0 || column < 0
						? null
						: { row: Math.min(dataset.rows - 1, row + 1), column };
				},
				focusCell: (row, column) => {
					hot.selectCell(row, column);
					hot.scrollViewportTo({ row, col: column });
				},
				getCellElement: (row, column) => hot.getCell(row, column),
				getActiveCell() {
					const cell = hot.getSelectedLast();
					return cell ? { row: cell[0], column: cell[1] } : null;
				},
				selectRange: (rows, columns) => {
					hot.selectCell(0, 0, rows - 1, columns - 1);
				},
			},
			getScrollElement() {
				const viewport = container.querySelector<HTMLElement>(".ht_master .wtHolder");
				if (!viewport) throw new Error("Handsontable viewport was not rendered");
				return viewport;
			},
			readCell: (row, column) => (hot.getDataAtCell(row, column) ?? null) as BenchmarkCellValue,
			scrollToRow: (row) => {
				hot.scrollViewportTo({ row, col: 0, verticalSnap: "middle" });
			},
			writeCell: (row, column, value) => {
				hot.setDataAtCell(row, column, value, "benchmark");
			},
			writeCells: (writes) => {
				hot.setDataAtCell(
					writes.map((write) => [write.row, write.column, write.value]),
					"benchmark",
				);
			},
			replaceDataset(nextDataset) {
				hot.updateData(
					nextDataset.values.map((row) => [...row]),
					"benchmark-replace",
				);
			},
			destroy: () => hot.destroy(),
		} satisfies BenchmarkController;
	},
};
