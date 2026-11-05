import {
	GridSheet,
	buildInitialCells,
	createSheetRef,
	p2a,
	type CellsByAddressType,
} from "@gridsheet/react-core";
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import type { BenchmarkAdapter, BenchmarkCellValue, BenchmarkWrite } from "../types";

function cellsForWrites(writes: readonly BenchmarkWrite[]): CellsByAddressType {
	return Object.fromEntries(
		writes.map(({ row, column, value }) => [p2a({ y: row + 1, x: column + 1 }), { value }]),
	);
}

export const adapter: BenchmarkAdapter = {
	mount(container, dataset) {
		const root = createRoot(container);
		const sheetRef = createSheetRef();
		const initialCells = buildInitialCells({
			matrices: { A1: dataset.values },
			ensured: { numRows: dataset.rows, numCols: dataset.columns },
			cells: { defaultRow: { height: 28 }, defaultCol: { width: 100 } },
		});
		flushSync(() =>
			root.render(
				createElement(GridSheet, {
					initialCells,
					sheetName: "Benchmark",
					sheetRef,
					options: {
						sheetHeight: container.clientHeight,
						sheetWidth: container.clientWidth,
						showFormulaBar: false,
					},
				}),
			),
		);
		const handle = () => {
			if (!sheetRef.current) throw new Error("GridSheet did not expose its sheet handle");
			return sheetRef.current;
		};
		const viewport = () => {
			const element = container.querySelector<HTMLElement>(".gs-tabular");
			if (!element) throw new Error("GridSheet viewport was not rendered");
			return element;
		};
		return {
			getScrollElement: viewport,
			readCell: (row, column) =>
				(handle().sheet.getCell({ y: row + 1, x: column + 1 })?.value ??
					null) as BenchmarkCellValue,
			scrollToRow: (row) => {
				viewport().scrollTop = row * 28;
			},
			writeCell(row, column, value) {
				const { sheet, apply } = handle();
				apply(sheet.update({ diff: cellsForWrites([{ row, column, value }]) }));
			},
			writeCells(writes) {
				const { sheet, apply } = handle();
				apply(sheet.update({ diff: cellsForWrites(writes) }));
			},
			replaceDataset(next) {
				const { apply } = handle();
				let sheet = handle().sheet;
				if (next.rows < sheet.numRows)
					sheet = sheet.removeRows({ y: next.rows + 1, numRows: sheet.numRows - next.rows });
				else if (next.rows > sheet.numRows)
					sheet = sheet.insertRows({
						y: sheet.numRows + 1,
						numRows: next.rows - sheet.numRows,
						baseY: sheet.numRows,
					});
				// buildInitialCells becomes lazy above 100k cells; update needs an enumerable diff.
				const diff: CellsByAddressType = {};
				for (let row = 0; row < next.rows; row++) {
					for (let column = 0; column < next.columns; column++) {
						diff[p2a({ y: row + 1, x: column + 1 })] = {
							value: next.values[row]?.[column] ?? null,
						};
					}
				}
				apply(sheet.update({ diff }));
			},
			destroy: () => root.unmount(),
		};
	},
};
