import Handsontable from "handsontable";
import "handsontable/styles/handsontable.css";
import "handsontable/styles/ht-theme-main.css";
import type { BenchmarkAdapter, BenchmarkCellValue, BenchmarkController } from "../types";

export const adapter: BenchmarkAdapter = {
	mount(container, dataset) {
		container.classList.add("ht-theme-main");
		const hot = new Handsontable(container, {
			data: dataset.values,
			rowHeaders: true,
			colHeaders: Array.from({ length: dataset.columns }, (_, column) => `Col ${column}`),
			colWidths: 100,
			rowHeights: 28,
			width: "100%",
			height: "100%",
			licenseKey: "non-commercial-and-evaluation",
		});

		return {
			getScrollElement() {
				const viewport = container.querySelector<HTMLElement>(".ht_master .wtHolder");
				if (!viewport) throw new Error("Handsontable viewport was not rendered");
				return viewport;
			},
			readCell: (row, column) => (hot.getDataAtCell(row, column) ?? null) as BenchmarkCellValue,
			scrollToRow: (row) => { hot.scrollViewportTo({ row, col: 0, verticalSnap: "middle" }); },
			writeCell: (row, column, value) => { hot.setDataAtCell(row, column, value, "benchmark"); },
			writeCells: (writes) => {
				hot.setDataAtCell(
					writes.map((write) => [write.row, write.column, write.value]),
					"benchmark",
				);
			},
			replaceDataset(nextDataset) {
				hot.updateData(nextDataset.values.map((row) => [...row]), "benchmark-replace");
			},
			destroy: () => hot.destroy(),
		} satisfies BenchmarkController;
	},
};
