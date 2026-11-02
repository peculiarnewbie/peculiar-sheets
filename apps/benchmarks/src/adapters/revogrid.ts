import { defineCustomElements } from "@revolist/revogrid/loader";
import type { BenchmarkAdapter, BenchmarkCellValue, BenchmarkDataset } from "../types";

defineCustomElements();

export const adapter: BenchmarkAdapter = {
	async mount(container, dataset) {
		const fields = Array.from({ length: dataset.columns }, (_, column) => `col${column}`);
		const toSource = (data: BenchmarkDataset) =>
			data.values.map((row, index) => ({
				id: data.rowIds[index],
				...Object.fromEntries(fields.map((field, column) => [field, row[column] ?? null])),
			}));
		const grid = document.createElement("revo-grid");
		grid.style.width = "100%";
		grid.style.height = "100%";
		grid.columns = fields.map((prop, column) => ({ prop, name: `Col ${column}`, size: 100 }));
		grid.rowSize = 28;
		grid.rowHeaders = true;
		grid.range = true;
		grid.useClipboard = true;
		grid.source = toSource(dataset);
		await new Promise<void>((resolve) => {
			grid.addEventListener("created", () => resolve(), { once: true });
			container.append(grid);
		});
		await grid.componentOnReady();
		await Promise.all(
			Array.from(grid.querySelectorAll("revogr-viewport-scroll"), (element) =>
				element.componentOnReady(),
			),
		);
		await Promise.all(
			Array.from(grid.querySelectorAll("revogr-data"), (element) => element.componentOnReady()),
		);
		const viewports = () => {
			const horizontal = Array.from(grid.querySelectorAll("revogr-viewport-scroll")).find(
				(element) => element.colType === "rgCol",
			);
			const vertical =
				horizontal?.shadowRoot?.querySelector<HTMLElement>(".vertical-inner") ??
				horizontal?.querySelector<HTMLElement>(".vertical-inner");
			if (!horizontal || !vertical) throw new Error("RevoGrid viewports were not rendered");
			return { horizontal, vertical };
		};
		return {
			ui: {
				async focusCell(row, column) {
					await grid.scrollToRow(row);
					await grid.setCellsFocus({ x: column, y: row });
				},
				getCellElement: (row, column) =>
					Array.from(grid.querySelectorAll("revogr-data"))
						.find((element) => element.type === "rgRow" && element.colType === "rgCol")
						?.querySelector<HTMLElement>(`[data-rgrow="${row}"][data-rgcol="${column}"]`) ?? null,
				async getActiveCell() {
					const cell = await grid.getFocused();
					return cell ? { row: cell.cell.y, column: cell.cell.x } : null;
				},
				selectRange: (rows, columns) =>
					grid.setCellsFocus({ x: 0, y: 0 }, { x: columns - 1, y: rows - 1 }),
			},
			getScrollElement: () => viewports().vertical,
			getScrollPosition: () => ({
				top: viewports().vertical.scrollTop,
				left: viewports().horizontal.scrollLeft,
			}),
			scrollToProgress(axis, progress) {
				const { horizontal, vertical } = viewports();
				return grid.scrollToCoordinate(
					axis === "vertical"
						? { y: progress * Math.max(0, vertical.scrollHeight - vertical.clientHeight) }
						: { x: progress * Math.max(0, horizontal.scrollWidth - horizontal.clientWidth) },
				);
			},
			scrollToRow: (row) => grid.scrollToRow(row),
			readCell: (row, column) =>
				(grid.source[row]?.[fields[column] ?? ""] ?? null) as BenchmarkCellValue,
			async writeCell(row, column, value) {
				await grid.setDataAt({ row, col: column, val: value, rowType: "rgRow", colType: "rgCol" });
			},
			writeCells(writes) {
				for (const write of writes) {
					const row = grid.source[write.row];
					const field = fields[write.column];
					if (!row || !field) throw new Error("RevoGrid write target is outside the dataset");
					row[field] = write.value;
				}
				return grid.refresh();
			},
			replaceDataset: (next) => {
				grid.source = toSource(next);
			},
			destroy: () => grid.remove(),
		};
	},
};
