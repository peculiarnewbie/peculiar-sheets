import { cleanup, fireEvent, render, renderHook } from "@solidjs/testing-library";
import { createEffect, createMemo, createRoot, createSignal, flush, Loading } from "solid-js";
import { afterEach, describe, expect, it } from "vitest";
import {
	columnIdx,
	physicalRow,
	rowId,
	visualRow,
} from "../../packages/spreadsheets/src/core/brands";
import { selectCell } from "../../packages/spreadsheets/src/core/selection";
import { createSheetStore } from "../../packages/spreadsheets/src/core/state";
import { SheetCustomizationContext } from "../../packages/spreadsheets/src/customization";
import GridBody from "../../packages/spreadsheets/src/grid/GridBody";
import GridCell, { type GridCellContext } from "../../packages/spreadsheets/src/grid/GridCell";
import GridHeader from "../../packages/spreadsheets/src/grid/GridHeader";
import { buildRowMetrics } from "../../packages/spreadsheets/src/grid/rowMetrics";
import { Sheet } from "../../packages/spreadsheets/src/Sheet";
import type {
	CellStyle,
	CellValue,
	ColumnDef,
	SheetController,
	VisualCellAddress,
} from "../../packages/spreadsheets/src/types";

afterEach(cleanup);

describe("Solid 2 Sheet", () => {
	it("keeps virtual headers aligned with global indices, pinned columns, sorting, and resizing", () => {
		const columns: ColumnDef[] = Array.from({ length: 200 }, (_, index) => ({
			id: `col${index}`,
			header: `Column ${index}`,
			...(index === 100 || index === 101 ? { groupId: "far", group: "Far columns" } : {}),
		}));
		const range = (indices: number[]) =>
			indices.map((index) => {
				const column = columns[index];
				if (!column) throw new Error("Test column missing");
				return { index, start: index * 100, size: 100, column };
			});
		const [virtualColumns, setVirtualColumns] = createSignal(range([0, 1]));
		let clicked = -1;
		let resized = "";
		const view = render(() => (
			<GridHeader
				columns={columns}
				virtualColumns={virtualColumns()}
				columnWidths={new Map(columns.map((column) => [column.id, 100]))}
				totalWidth={20040}
				sortState={{ columnId: "col100", direction: "desc" }}
				showReferenceHeaders={true}
				rowGutterWidth={40}
				pinnedLeftOffsets={[40]}
				lastPinnedIndex={0}
				activeResizeColumnId="col100"
				onColumnHeaderMouseDown={(index) => {
					clicked = index;
				}}
				onColumnResizeStart={(id) => {
					resized = id;
				}}
			/>
		));
		flush();
		expect(view.container.querySelectorAll(".se-header-cell")).toHaveLength(2);
		setVirtualColumns(range([0, 100, 101]));
		flush();
		expect(view.container.querySelectorAll(".se-header-cell")).toHaveLength(3);
		expect(view.container.querySelectorAll(".se-header-ref-cell")).toHaveLength(3);
		const header = view.container.querySelector<HTMLElement>(
			'.se-header-cell[data-col-index="100"]',
		);
		const pinned = view.container.querySelector<HTMLElement>('.se-header-cell[data-col-index="0"]');
		const reference = view.container.querySelector<HTMLElement>(
			'.se-header-ref-cell[data-col-index="100"]',
		);
		if (!header || !pinned || !reference) throw new Error("Virtual header missing");
		expect(header.textContent).toContain("Column 100");
		expect(header.getAttribute("aria-colindex")).toBe("101");
		expect(header.getAttribute("aria-sort")).toBe("descending");
		expect(header.classList.contains("se-header-cell--resizing")).toBe(true);
		expect(header.style.left).toBe("10040px");
		expect(reference.textContent).toBe("CW");
		expect(reference.style.left).toBe(header.style.left);
		expect(pinned.classList.contains("se-header-cell--pinned")).toBe(true);
		expect(pinned.style.left).toBe("40px");
		expect(view.getByText("Far columns")).toBeTruthy();
		fireEvent.mouseDown(header);
		expect(clicked).toBe(100);
		const handle = header.querySelector(".se-resize-handle");
		if (!handle) throw new Error("Resize handle missing");
		fireEvent.mouseDown(handle);
		expect(resized).toBe("col100");
		setVirtualColumns(
			virtualColumns().map((item) => (item.index === 100 ? { ...item, size: 130 } : item)),
		);
		flush();
		expect(header.style.width).toBe("130px");
		expect(reference.style.width).toBe("130px");
	});
	it("keeps recycled column slots current when the virtual range moves, shrinks, and grows", () => {
		const formats = new Map<number, number>();
		const formattedColumns: ColumnDef[] = Array.from({ length: 200 }, (_, index) => ({
			id: `col${index}`,
			header: `Column ${index}`,
			formatValue: (value) => {
				formats.set(index, (formats.get(index) ?? 0) + 1);
				return String(value ?? "");
			},
		}));
		const [columns, setColumns] = createSignal(formattedColumns);
		const range = (indices: number[]) =>
			indices.map((index) => {
				const column = columns()[index];
				if (!column) throw new Error("Test column missing");
				return { index, start: index * 100, size: 100, column };
			});
		const [virtualColumns, setVirtualColumns] = createSignal(range([0, 1, 2]));
		const [changed, setChanged] = createSignal(false);
		let clicked: VisualCellAddress | null = null;
		const view = render(() => (
			<GridBody
				columns={columns()}
				rowMetrics={buildRowMetrics(20, 28)}
				virtualRows={[
					{ index: 10, start: 280, size: 28 },
					{ index: 11, start: 308, size: 28 },
				]}
				virtualColumns={virtualColumns()}
				totalHeight={560}
				rowGutterWidth={0}
				showReferenceHeaders={false}
				getRowHeaderIndex={(row) => row}
				getRowId={(row) => rowId(`row-${row}`)}
				getCellId={(address) => `cell-${address.row}-${address.col}`}
				getRawValue={(row, col) => `R${row}C${col}`}
				getDisplayValue={(row, col) => {
					const modified = changed();
					return modified && row === 10 && col === 100 ? "changed" : `R${row}C${col}`;
				}}
				editingAddress={null}
				selection={selectCell({ row: visualRow(10), col: columnIdx(0) })}
				onCellMouseDown={(address) => {
					clicked = address;
				}}
				onCellDblClick={() => {}}
				pinnedLeftOffsets={[0]}
				lastPinnedIndex={0}
				searchMatchSet={new Set()}
				searchCurrentAddress={null}
			/>
		));
		flush();
		expect(view.getAllByRole("gridcell")).toHaveLength(6);
		setVirtualColumns(range([100, 101]));
		flush();
		expect(view.getAllByRole("gridcell").map((cell) => cell.textContent)).toEqual([
			"R10C100",
			"R10C101",
			"R11C100",
			"R11C101",
		]);
		const cell = view.container.querySelector<HTMLElement>("#cell-10-100");
		if (!cell) throw new Error("Recycled cell missing");
		fireEvent.mouseDown(cell);
		expect(clicked).toEqual({ row: 10, col: 100 });
		formats.clear();
		setChanged(true);
		flush();
		expect(cell.textContent).toBe("changed");
		expect(formats.get(100)).toBeGreaterThan(0);
		expect(formats.get(101) ?? 0).toBe(0);
		setColumns(formattedColumns.map(({ id, header }) => ({ id, header })));
		flush();
		setVirtualColumns(range([100, 101]));
		setChanged(false);
		flush();
		expect(cell.textContent).toBe("R10C100");
		formats.clear();
		setColumns(formattedColumns);
		flush();
		setVirtualColumns(range([100, 101]));
		setChanged(true);
		flush();
		expect(cell.textContent).toBe("changed");
		expect(formats.get(100)).toBeGreaterThan(0);
		setVirtualColumns(range([]));
		flush();
		expect(view.queryAllByRole("gridcell")).toHaveLength(0);
		setVirtualColumns(range([0, 195, 196, 197]));
		flush();
		expect(view.getAllByRole("gridcell")).toHaveLength(8);
		expect(view.container.querySelector("#cell-10-0")?.classList.contains("se-cell--pinned")).toBe(
			true,
		);
		expect(view.container.querySelector("#cell-11-197")?.textContent).toBe("R11C197");
	});
	it("composes row commands immediately and batches their render notifications", () => {
		const frames: Array<{ rowCount: number; ids: readonly string[] }> = [];
		const { result: store } = renderHook(() => {
			const store = createSheetStore([["first"]], [{ id: "value", header: "Value" }]);
			createEffect(
				() => ({ rowCount: store.rowCount(), ids: [...store.rowIds()] }),
				(frame) => {
					frames.push(frame);
				},
			);
			return store;
		});
		flush();
		store.insertRows(physicalRow(1), 1);
		store.insertRows(physicalRow(2), 1);
		expect(store.rowCount()).toBe(3);
		expect(store.rowIds()).toEqual([rowId("0"), rowId("1"), rowId("2")]);
		store.deleteRows(physicalRow(1), 1);
		store.setCell(physicalRow(1), 0, "last");
		expect(store.rowCount()).toBe(2);
		expect(store.rowIds()).toEqual([rowId("0"), rowId("2")]);
		expect(store.cells).toEqual([["first"], ["last"]]);
		expect(frames).toHaveLength(1);
		flush();
		expect(frames).toEqual([
			{ rowCount: 1, ids: ["0"] },
			{ rowCount: 2, ids: ["0", "2"] },
		]);
		expect(store.rowRevision(rowId("2"))).toBe(1);
	});

	it("edits through delegated keyboard and input handlers", () => {
		let controller: SheetController | undefined;
		const view = render(() => (
			<Sheet
				data={[["initial"], ["next"]]}
				columns={[{ id: "name", header: "Name", editable: true }]}
				ref={(value) => {
					controller = value;
				}}
			/>
		));
		flush();
		if (!controller) throw new Error("Controller was not attached");
		fireEvent.keyDown(view.getByRole("grid"), { key: "ArrowDown" });
		flush();
		expect(controller.getSelection().anchor.row).toBe(1);
		fireEvent.keyDown(view.getByRole("grid"), { key: "F2" });
		flush();
		const input = view.container.querySelector<HTMLInputElement>(".se-cell-editor");
		if (!input) throw new Error("Cell editor was not rendered");
		fireEvent.input(input, { target: { value: "edited" } });
		fireEvent.keyDown(input, { key: "Enter" });
		flush();
		expect(controller.getCellValue(1, 0)).toBe("edited");
	});

	it("only invalidates the changed row after batched cell writes", () => {
		const runs = [0, 0];
		const ids = [rowId("first"), rowId("second")];
		const { result: store } = renderHook(() => {
			const store = createSheetStore([["a"], ["b"]], [{ id: "value", header: "Value" }], ids);
			ids.forEach((id, index) =>
				createEffect(
					() => store.rowRevision(id),
					() => {
						runs[index] = (runs[index] ?? 0) + 1;
					},
				),
			);
			return store;
		});
		flush();
		expect(runs).toEqual([1, 1]);
		store.setCell(physicalRow(0), 0, "a2");
		store.setCell(physicalRow(0), 0, "a3");
		flush();
		expect(runs).toEqual([2, 1]);
		expect(store.cells[0]?.[0]).toBe("a3");
	});

	it("batches revisions for distinct rows without waking an untouched row", () => {
		const runs = [0, 0, 0];
		const ids = [rowId("first"), rowId("second"), rowId("third")];
		const { result: store } = renderHook(() => {
			const store = createSheetStore([[1], [2], [3]], [{ id: "value", header: "Value" }], ids);
			ids.forEach((id, index) =>
				createEffect(
					() => store.rowRevision(id),
					() => {
						runs[index] = (runs[index] ?? 0) + 1;
					},
				),
			);
			return store;
		});
		flush();
		store.setCells([
			{ row: physicalRow(0), col: 0, value: 10 },
			{ row: physicalRow(0), col: 0, value: 11 },
			{ row: physicalRow(2), col: 0, value: 30 },
		]);
		expect(runs).toEqual([1, 1, 1]);
		flush();
		expect(runs).toEqual([2, 1, 2]);
		expect(ids.map(store.rowRevision)).toEqual([1, 0, 1]);
		expect(store.cells).toEqual([[11], [2], [30]]);
	});

	it("lets Solid settle asynchronous host data and discards an older response", async () => {
		let resolveOlder: (data: CellValue[][]) => void = () => {};
		let resolveNewer: (data: CellValue[][]) => void = () => {};
		const older = new Promise<CellValue[][]>((resolve) => {
			resolveOlder = resolve;
		});
		const newer = new Promise<CellValue[][]>((resolve) => {
			resolveNewer = resolve;
		});
		const [request, setRequest] = createSignal(0);
		const { result: data } = renderHook(() =>
			createMemo(() =>
				request() === 0 ? ([["initial"]] as CellValue[][]) : request() === 1 ? older : newer,
			),
		);
		let controller: SheetController | undefined;
		const view = render(() => (
			<Loading fallback={<span>Loading</span>}>
				<Sheet
					data={data()}
					columns={[{ id: "value", header: "Value" }]}
					ref={(value) => {
						controller = value;
					}}
				/>
			</Loading>
		));
		flush();
		setRequest(1);
		flush();
		expect(controller?.getCellValue(0, 0)).toBe("initial");
		setRequest(2);
		flush();
		resolveNewer([["newer"]]);
		await newer;
		await Promise.resolve();
		flush();
		expect(controller?.getCellValue(0, 0)).toBe("newer");
		resolveOlder([["older"]]);
		await older;
		await Promise.resolve();
		flush();
		expect(controller?.getCellValue(0, 0)).toBe("newer");
		expect(view.container.querySelector(".se-grid")).not.toBeNull();
	});

	it("preserves row revisions when observers leave and return, and resets deleted identities", () => {
		const id = rowId("row");
		const columns = [{ id: "value", header: "Value" }];
		const { result: store } = renderHook(() => createSheetStore([[0]], columns, [id]));
		const revisions: number[] = [];
		const observe = () =>
			createRoot((dispose) => {
				createEffect(
					() => store.rowRevision(id),
					(revision) => {
						revisions.push(revision);
					},
				);
				return dispose;
			});
		const stop = observe();
		flush();
		store.setCell(physicalRow(0), 0, 1);
		flush();
		stop();
		flush();
		store.setCell(physicalRow(0), 0, 2);
		flush();
		const stopAgain = observe();
		flush();
		expect(revisions).toEqual([0, 1, 2]);
		store.reconcileFromHost([], columns, []);
		flush();
		expect(revisions).toEqual([0, 1, 2, 0]);
		store.reconcileFromHost([[3]], columns, [id]);
		flush();
		store.setCell(physicalRow(0), 0, 4);
		flush();
		expect(revisions).toEqual([0, 1, 2, 0, 1]);
		stopAgain();
	});

	it("updates and removes cell content, tooltip, class, and style overrides", () => {
		const baseColumn: ColumnDef = { id: "value", header: "Value" };
		const [column, setColumn] = createSignal(baseColumn);
		const [customClass, setCustomClass] = createSignal("");
		const [style, setStyle] = createSignal<CellStyle>({});
		const [value, setValue] = createSignal("first");
		const grid: GridCellContext = {
			get virtualColumns() {
				return [{ index: 0, start: 0, size: 100, column: column() }];
			},
			rowGutterWidth: 0,
			getCellId: () => "cell",
			getRawValue: () => value(),
			getDisplayValue: () => value(),
			editingAddress: null,
			selection: selectCell({ row: visualRow(0), col: columnIdx(0) }),
			onCellMouseDown: () => {},
			onCellDblClick: () => {},
			pinnedLeftOffsets: [],
			lastPinnedIndex: -1,
			searchMatchSet: new Set(),
			searchCurrentAddress: null,
		};
		const view = render(() => (
			<SheetCustomizationContext
				value={{ getCellClass: () => customClass(), getCellStyle: () => style() }}
			>
				<GridCell
					row={{
						item: { index: 0, start: 0, size: 28 },
						className: "",
						get displayValues() {
							return [value()];
						},
					}}
					columnIndex={0}
					grid={grid}
				/>
			</SheetCustomizationContext>
		));
		flush();
		const cell = view.getByRole("gridcell");
		expect(cell.textContent).toBe("first");
		expect(cell.getAttribute("title")).toBe("first");
		setColumn({
			...baseColumn,
			getCellTitle: () => "",
			renderCell: (context) => <strong>{context.formattedText}</strong>,
		});
		setCustomClass("highlight");
		setStyle({ color: "red" });
		flush();
		expect(cell.querySelector("strong")?.textContent).toBe("first");
		expect(cell.hasAttribute("title")).toBe(false);
		expect(cell.classList.contains("highlight")).toBe(true);
		expect(cell.style.color).toBe("red");
		setValue("second");
		flush();
		expect(cell.querySelector("strong")?.textContent).toBe("second");
		setColumn(baseColumn);
		setCustomClass("");
		setStyle({});
		flush();
		expect(cell.querySelector("strong")).toBeNull();
		expect(cell.querySelector(".se-cell__text")?.textContent).toBe("second");
		expect(cell.getAttribute("title")).toBe("second");
		expect(cell.classList.contains("highlight")).toBe(false);
		expect(cell.style.color).toBe("");
	});
	it("renders, accepts controlled updates, edits through the controller and disposes", () => {
		let controller: SheetController | undefined;
		const [data, setData] = createSignal<CellValue[][]>([["first"], ["second"]]);
		const view = render(() => (
			<Sheet
				data={data()}
				columns={[{ id: "name", header: "Name", editable: true }]}
				ref={(value) => {
					controller = value;
				}}
			/>
		));
		flush();
		expect(view.getByRole("grid")).toBeTruthy();
		expect(controller?.getCellValue(0, 0)).toBe("first");
		setData([["replacement"]]);
		flush();
		expect(controller?.getCellValue(0, 0)).toBe("replacement");
		controller?.setCellValue(0, 0, "edited");
		expect(controller?.getCellValue(0, 0)).toBe("edited");
		flush();
		fireEvent.keyDown(view.getByRole("grid"), { key: "ArrowDown" });
		flush();
		view.unmount();
		expect(view.container.querySelector(".se-grid")).toBeNull();
	});

	it("keeps same-turn controller editing and history coherent", () => {
		let controller: SheetController | undefined;
		render(() => (
			<Sheet
				data={[["initial"], ["next"]]}
				columns={[{ id: "name", header: "Name", editable: true }]}
				ref={(value) => {
					controller = value;
				}}
			/>
		));
		flush();
		if (!controller) throw new Error("Controller was not attached");
		controller.startEditing(0, 0);
		controller.setActiveEditorValue("same turn");
		controller.commitActiveEditor();
		expect(controller.getCellValue(0, 0)).toBe("same turn");
		controller.setCellValue(0, 0, "second write");
		controller.undo();
		expect(controller.getCellValue(0, 0)).toBe("same turn");
		controller.undo();
		expect(controller.getCellValue(0, 0)).toBe("initial");
		flush();
		const address = { row: visualRow(1), col: columnIdx(0) };
		controller.setSelection([{ start: address, end: address }]);
		controller.setActiveEditorValue("selection edit");
		expect(controller.getEditorText()).toBe("selection edit");
		controller.commitActiveEditor();
		expect(controller.getCellValue(1, 0)).toBe("selection edit");
		controller.undo();
		expect(controller.getCellValue(1, 0)).toBe("next");
		flush();
	});

	it("cancels a queued editor focus when unmounted in the same turn", () => {
		let controller: SheetController | undefined;
		const view = render(() => (
			<Sheet
				data={[["initial"]]}
				columns={[{ id: "name", header: "Name", editable: true }]}
				ref={(value) => {
					controller = value;
				}}
			/>
		));
		flush();
		controller?.startEditing(0, 0);
		view.unmount();
		flush();
		expect(document.querySelector(".se-cell-editor")).toBeNull();
	});

	it("ignores an asynchronous clipboard read that finishes after unmount", async () => {
		let finishRead: (text: string) => void = () => {};
		const pendingRead = new Promise<string>((resolve) => {
			finishRead = resolve;
		});
		const descriptor = Object.getOwnPropertyDescriptor(navigator, "clipboard");
		Object.defineProperty(navigator, "clipboard", {
			configurable: true,
			value: { readText: () => pendingRead },
		});
		let operations = 0;
		try {
			const view = render(() => (
				<Sheet
					data={[["initial"]]}
					columns={[{ id: "name", header: "Name", editable: true }]}
					onOperation={() => {
						operations++;
					}}
				/>
			));
			flush();
			fireEvent.contextMenu(view.getByRole("grid"), { clientX: 0, clientY: 0 });
			flush();
			fireEvent.click(view.getByText("Paste"));
			view.unmount();
			finishRead("too late");
			await pendingRead;
			await Promise.resolve();
			flush();
			expect(operations).toBe(0);
		} finally {
			if (descriptor) Object.defineProperty(navigator, "clipboard", descriptor);
			else Reflect.deleteProperty(navigator, "clipboard");
		}
	});
});
