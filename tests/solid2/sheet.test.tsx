import { cleanup, fireEvent, render, renderHook } from "@solidjs/testing-library";
import {
	createEffect,
	createMemo,
	createRoot,
	createSignal,
	createStore,
	flush,
	Loading,
} from "solid-js";
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
	SheetOperation,
	SheetCustomization,
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
	it("keeps virtual rows and recycled column slots current as ranges move, shrink, and grow", () => {
		const formats = new Map<number, number>();
		const formattedRows = new Set<number>();
		const formattedColumns: ColumnDef[] = Array.from({ length: 200 }, (_, index) => ({
			id: `col${index}`,
			header: `Column ${index}`,
			formatValue: (value, context) => {
				formattedRows.add(context.row);
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
		const [height, setHeight] = createSignal(28);
		const [rows, setRows] = createSignal([10, 11]);
		const [selection, setSelection] = createSignal(
			selectCell({ row: visualRow(10), col: columnIdx(0) }),
		);
		const [editing, setEditing] = createSignal<VisualCellAddress | null>(null);
		let clicked: VisualCellAddress | null = null;
		const view = render(() => (
			<GridBody
				columns={columns()}
				rowMetrics={buildRowMetrics(1000, 28)}
				virtualRows={rows().map((index) => ({ index, start: index * height(), size: height() }))}
				virtualColumns={virtualColumns()}
				totalHeight={1000 * height()}
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
				editingAddress={editing()}
				selection={selection()}
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
		formattedRows.clear();
		setSelection(selectCell({ row: visualRow(10), col: columnIdx(1) }));
		flush();
		expect([...formattedRows]).toEqual([10]);
		expect(view.container.querySelector("#cell-10-1")?.getAttribute("aria-selected")).toBe("true");
		expect(view.container.querySelector("#cell-11-1")?.getAttribute("aria-selected")).toBe("false");
		formattedRows.clear();
		setEditing({ row: visualRow(10), col: columnIdx(1) });
		flush();
		expect([...formattedRows]).toEqual([10]);
		expect(view.container.querySelector("#cell-10-1")?.classList.contains("se-cell--editing")).toBe(
			true,
		);
		setEditing(null);
		setSelection(selectCell({ row: visualRow(10), col: columnIdx(0) }));
		flush();
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
		expect(getComputedStyle(cell).left).toBe("10000px");
		expect(getComputedStyle(cell).height).toBe("28px");
		setHeight(40);
		flush();
		expect(getComputedStyle(cell).height).toBe("40px");
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
		setRows([500, 501]);
		flush();
		expect(view.container.querySelector("#cell-10-0")).toBeNull();
		const moved = view.container.querySelector<HTMLElement>("#cell-500-197");
		if (!moved) throw new Error("Recycled row missing");
		expect(moved.textContent).toBe("R500C197");
		fireEvent.mouseDown(moved);
		expect(clicked).toEqual({ row: 500, col: 197 });
		const overlapping = view.container.querySelector("#cell-501-197");
		setRows([501, 502]);
		flush();
		expect(view.container.querySelector("#cell-501-197")).toBe(overlapping);
		setRows([]);
		flush();
		expect(view.queryAllByRole("gridcell")).toHaveLength(0);
		formats.clear();
		setChanged(false);
		flush();
		expect(formats.size).toBe(0);
		setRows([999]);
		flush();
		expect(view.getAllByRole("gridcell")).toHaveLength(4);
		expect(view.container.querySelector("#cell-999-197")?.textContent).toBe("R999C197");
		setColumns(
			formattedColumns.map((column, index) =>
				index === 0
					? { ...column, renderCell: (context) => <b>{context.formattedText}</b> }
					: column,
			),
		);
		flush();
		setVirtualColumns(range([0, 195, 196, 197]));
		flush();
		expect(view.container.querySelector("#cell-999-0 b")?.textContent).toBe("R999C0");
		setColumns(formattedColumns);
		flush();
		setVirtualColumns(range([0, 195, 196, 197]));
		flush();
		expect(view.container.querySelector("#cell-999-0 b")).toBeNull();
		expect(view.container.querySelector("#cell-999-0 .se-cell__text")?.textContent).toBe("R999C0");
	});
	it("keeps cell geometry when custom style hooks are added and removed", () => {
		const [columns, setColumns] = createSignal<ColumnDef[]>([{ id: "value", header: "Value" }]);
		const column = () => {
			const value = columns()[0];
			if (!value) throw new Error("Column missing");
			return value;
		};
		const [customization, setCustomization] = createStore<SheetCustomization>({});
		const view = render(() => (
			<SheetCustomizationContext value={customization}>
				<GridBody
					columns={columns()}
					rowMetrics={buildRowMetrics(1, 28)}
					virtualRows={[{ index: 0, start: 0, size: 28 }]}
					virtualColumns={[{ index: 0, start: 0, size: 100, column: column() }]}
					totalHeight={28}
					rowGutterWidth={0}
					showReferenceHeaders={false}
					getRowHeaderIndex={(row) => row}
					getRowId={() => rowId("row")}
					getCellId={() => "styled-cell"}
					getRawValue={() => "value"}
					getDisplayValue={() => "value"}
					editingAddress={null}
					selection={selectCell({ row: visualRow(0), col: columnIdx(0) })}
					onCellMouseDown={() => {}}
					onCellDblClick={() => {}}
					pinnedLeftOffsets={[]}
					lastPinnedIndex={-1}
					searchMatchSet={new Set()}
					searchCurrentAddress={null}
				/>
			</SheetCustomizationContext>
		));
		flush();
		expect(getComputedStyle(view.getByRole("gridcell")).width).toBe("100px");
		setCustomization((draft) => {
			draft.getCellStyle = () => ({ color: "red", width: "999px", height: "1px" });
		});
		flush();
		const styled = getComputedStyle(view.getByRole("gridcell"));
		expect(styled.color).toBe("red");
		expect(styled.width).toBe("100px");
		expect(styled.height).toBe("28px");
		setCustomization((draft) => {
			delete draft.getCellStyle;
		});
		flush();
		const plain = getComputedStyle(view.getByRole("gridcell"));
		expect(plain.color).not.toBe("red");
		expect(plain.width).toBe("100px");
		expect(plain.height).toBe("28px");
		setColumns([{ id: "value", header: "Value", renderCell: () => <input value="value" /> }]);
		flush();
		const input = view.getByRole("textbox") as HTMLInputElement;
		input.value = "draft";
		setCustomization((draft) => {
			draft.getCellStyle = () => ({ color: "blue" });
		});
		flush();
		expect(view.getByRole("textbox")).toBe(input);
		expect(input.value).toBe("draft");
		setCustomization((draft) => {
			delete draft.getCellStyle;
		});
		flush();
		expect(view.getByRole("textbox")).toBe(input);
		expect(input.value).toBe("draft");
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
		store.trySetDistinctCells?.(
			[
				{ row: 0, col: 0, value: 12 },
				{ row: 2, col: 0, value: 31 },
			],
			[{ id: "value", header: "Value" }],
		);
		flush();
		expect(runs).toEqual([3, 1, 3]);
		expect(store.cells).toEqual([[12], [2], [31]]);
		store.undo();
		flush();
		expect(runs).toEqual([4, 1, 4]);
		expect(store.cells).toEqual([[11], [2], [30]]);
		store.redo();
		flush();
		expect(runs).toEqual([5, 1, 5]);
		expect(store.cells).toEqual([[12], [2], [31]]);
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

	it("retains overlapping columns, pinned cells, and owned-row updates as the window moves", () => {
		const columns: ColumnDef[] = Array.from({ length: 10 }, (_, index) => ({
			id: `c${index}`,
			header: String(index),
			...(index === 1 ? { pinned: "left" as const } : {}),
		}));
		const { result: store } = renderHook(() =>
			createSheetStore(
				[
					Array.from({ length: 10 }, (_, index) => index),
					Array.from({ length: 10 }, (_, index) => index + 100),
				],
				columns,
			),
		);
		const range = (indices: number[]) =>
			indices.map((index) => {
				const column = columns[index];
				if (!column) throw new Error("Test column missing");
				return { index, start: index * 100, size: 100, column };
			});
		const [virtualColumns, setVirtualColumns] = createSignal(range([0, 1, 2, 3]));
		let clicked: VisualCellAddress | null = null;
		const view = render(() => (
			<GridBody
				columns={columns}
				rowMetrics={buildRowMetrics(2, 28)}
				virtualRows={[
					{ index: 0, start: 0, size: 28 },
					{ index: 1, start: 28, size: 28 },
				]}
				virtualColumns={virtualColumns()}
				totalHeight={56}
				rowGutterWidth={0}
				showReferenceHeaders={false}
				getRowHeaderIndex={(row) => row}
				getRowId={(row) => rowId(`r${row}`)}
				getCellId={({ row, col }) => `owned-${row}-${col}`}
				getRawValue={(row, col) => store.cells[row]?.[col] ?? null}
				getDisplayValue={(row, col) => store.cells[row]?.[col] ?? null}
				getRawRowValues={(row) => {
					store.structuralRevision();
					const id = store.getRowIdAtPhysicalRow(physicalRow(row));
					if (id !== null) store.rowRevision(id);
					return store.cells[row];
				}}
				editingAddress={null}
				selection={selectCell({ row: visualRow(0), col: columnIdx(2) })}
				onCellMouseDown={(address) => {
					clicked = address;
				}}
				onCellDblClick={() => {}}
				pinnedLeftOffsets={[-1, 0]}
				lastPinnedIndex={1}
				searchMatchSet={new Set()}
				searchCurrentAddress={null}
			/>
		));
		flush();
		const pinned = view.container.querySelector("#owned-0-1");
		const overlapping = view.container.querySelector("#owned-0-2");
		const departing = view.container.querySelector("#owned-0-0");
		setVirtualColumns(range([1, 2, 3, 4]));
		flush();
		expect(view.container.querySelector("#owned-0-1")).toBe(pinned);
		expect(view.container.querySelector("#owned-0-2")).toBe(overlapping);
		expect(view.container.querySelector("#owned-0-4")).toBe(departing);
		expect(view.getAllByRole("row")[0]?.querySelectorAll(".se-cell")).toHaveLength(4);
		expect(
			Array.from(view.getAllByRole("row")[0]?.querySelectorAll(".se-cell") ?? [], (cell) =>
				cell.getAttribute("aria-colindex"),
			),
		).toEqual(["2", "3", "4", "5"]);
		store.setCell(physicalRow(0), 2, 777);
		flush();
		expect(overlapping?.textContent).toBe("777");
		expect(view.container.querySelector("#owned-1-2")?.textContent).toBe("102");
		if (!departing) throw new Error("Recycled cell missing");
		fireEvent.mouseDown(departing);
		expect(clicked).toEqual({ row: 0, col: 4 });
		setVirtualColumns(range([1, 6, 7, 8]));
		flush();
		const last = view.container.querySelector<HTMLElement>("#owned-0-7");
		if (!last) throw new Error("Jumped column missing");
		expect(last.textContent).toBe("7");
		expect(getComputedStyle(last).left).toBe("700px");
		setVirtualColumns(range([1, 7]));
		flush();
		expect(view.container.querySelector("#owned-0-7")).toBe(last);
		setVirtualColumns(range([0, 1, 2, 3, 4, 5, 6, 7, 8]));
		flush();
		expect(view.container.querySelector("#owned-0-1")).toBe(pinned);
		expect(view.container.querySelector("#owned-0-7")).toBe(last);
		expect(view.getAllByRole("gridcell")).toHaveLength(18);
		expect(view.container.querySelector("#owned-0-2")?.textContent).toBe("777");
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
		const entered: VisualCellAddress[] = [];
		const baseColumn: ColumnDef = { id: "value", header: "Value" };
		const [column, setColumn] = createSignal(baseColumn);
		const [customClass, setCustomClass] = createSignal("");
		const [style, setStyle] = createSignal<CellStyle>();
		const [value, setValue] = createSignal("first");
		const customization = { getCellClass: () => customClass(), getCellStyle: () => style() };
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
			onCellMouseEnter: (address) => entered.push(address),
			onCellDblClick: () => {},
			pinnedLeftOffsets: [],
			lastPinnedIndex: -1,
			searchMatchSet: new Set(),
			searchCurrentAddress: null,
		};
		const view = render(() => (
			<SheetCustomizationContext value={customization}>
				<GridCell
					row={{
						grid,
						customization,
						item: { index: 0, start: 0, size: 28 },
						className: "",
						get selection() {
							return grid.selection;
						},
						get editingAddress() {
							return grid.editingAddress;
						},
						getDisplayValue() {
							return value();
						},
					}}
					column={() => ({
						index: 0,
						start: 0,
						size: 100,
						column: column(),
						slot: "v0",
						layout: {
							style: { width: "100px", height: "28px", left: "0px", position: "absolute" },
							cssText: "width:100px;height:28px;left:0px;position:absolute",
						},
					})}
				/>
			</SheetCustomizationContext>
		));
		flush();
		const cell = view.getByRole("gridcell");
		expect(cell.textContent).toBe("first");
		const text = cell.querySelector(".se-cell__text");
		if (!text) throw new Error("Cell text missing");
		fireEvent.mouseOver(text, { relatedTarget: document.body });
		expect(entered).toEqual([{ row: visualRow(0), col: columnIdx(0) }]);
		fireEvent.mouseOver(cell, { relatedTarget: text });
		expect(entered).toHaveLength(1);
		expect(cell.getAttribute("title")).toBe("first");
		setColumn({
			...baseColumn,
			getCellTitle: () => "",
			renderCell: (context) => <strong>{context.formattedText}</strong>,
		});
		setCustomClass("highlight");
		setStyle({ color: "red", width: "999px", height: "1px", left: "999px", position: "fixed" });
		flush();
		expect(cell.querySelector("strong")?.textContent).toBe("first");
		expect(cell.hasAttribute("title")).toBe(false);
		expect(cell.classList.contains("highlight")).toBe(true);
		expect(cell.style.color).toBe("red");
		expect(cell.style.width).toBe("100px");
		expect(cell.style.height).toBe("28px");
		expect(cell.style.left).toBe("0px");
		expect(cell.style.position).toBe("absolute");
		setValue("second");
		flush();
		expect(cell.querySelector("strong")?.textContent).toBe("second");
		setColumn(baseColumn);
		setCustomClass("");
		setStyle(undefined);
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

	it("normalizes sorted public batches before committing history and notifying", () => {
		let controller: SheetController | undefined;
		const operations: SheetOperation[] = [];
		const snapshots: CellValue[][] = [];
		render(() => (
			<Sheet
				data={[
					[2, "second"],
					[1, "first"],
				]}
				rowIds={[rowId("two"), rowId("one")]}
				columns={[
					{ id: "key", header: "Key" },
					{ id: "value", header: "Value" },
				]}
				defaultSortState={{ columnId: "key", direction: "asc" }}
				ref={(value) => {
					controller = value;
				}}
				onOperation={(operation) => {
					operations.push(operation);
					snapshots.push([
						controller?.getRawCellValue(0, 1) ?? null,
						controller?.getRawCellValue(1, 1) ?? null,
					]);
				}}
			/>
		));
		flush();
		if (!controller) throw new Error("Controller missing");
		const selection = controller.getSelection();
		controller.setCellValues([
			{ row: 0, col: 1, value: "discarded" },
			{ row: 1, col: 1, value: "temporary" },
			{ row: 0, col: 1, value: "final" },
			{ row: 1, col: 1, value: "second" },
		]);
		expect(snapshots).toEqual([["final", "second"]]);
		const operation = operations[0];
		if (operation?.type !== "batch-edit") throw new Error("Batch notification missing");
		expect(operation.mutations).toEqual([
			{
				address: { row: 1, col: 1 },
				viewAddress: { row: 0, col: 1 },
				rowId: "one",
				columnId: "value",
				oldValue: "first",
				newValue: "final",
				source: "external",
			},
		]);
		expect(controller.getSelection()).toEqual(selection);
		controller.undo();
		expect(snapshots[1]).toEqual(["first", "second"]);
		expect(controller.canUndo()).toBe(false);
		const inverse = operations[1];
		if (inverse?.type !== "batch-edit") throw new Error("Inverse notification missing");
		expect(inverse.mutations).toEqual([
			{ ...operation.mutations[0], oldValue: "final", newValue: "first" },
		]);
		controller.redo();
		expect(snapshots[2]).toEqual(["final", "second"]);
		controller.setCellValues([{ row: 0, col: 1, value: "final" }]);
		expect(operations).toHaveLength(3);
		expect(controller.getSelection()).toEqual(selection);
	});

	it("uses the current batch listener and permits synchronous reentrant writes", () => {
		let controller: SheetController | undefined;
		const operations: SheetOperation[] = [];
		const data = [["a"], ["b"]];
		const columns = [{ id: "value", header: "Value" }];
		const [listener, setListener] = createSignal<
			((operation: SheetOperation) => void) | undefined
		>();
		const operationProps = createMemo(() => {
			const current = listener();
			return current ? { onOperation: current } : {};
		});
		render(() => (
			<Sheet
				data={data}
				columns={columns}
				{...operationProps()}
				ref={(value) => {
					controller = value;
				}}
			/>
		));
		flush();
		if (!controller) throw new Error("Controller missing");
		const sheet = controller;
		sheet.setCellValues([{ row: 0, col: 0, value: "a" }]);
		setListener(() => (operation: SheetOperation) => {
			operations.push(operation);
			if (operation.type === "batch-edit" && operation.mutations[0]?.newValue === "B") {
				expect(sheet.getRawCellValue(1, 0)).toBe("B");
				expect(sheet.canUndo()).toBe(true);
				sheet.setCellValue(0, 0, "nested");
			}
		});
		flush();
		sheet.setCellValues([{ row: 1, col: 0, value: "B" }]);
		expect(operations.map((operation) => operation.type)).toEqual(["batch-edit", "cell-edit"]);
		sheet.undo();
		expect(sheet.getRawCellValue(0, 0)).toBe("a");
		sheet.undo();
		expect(sheet.getRawCellValue(1, 0)).toBe("b");
		setListener(undefined);
		flush();
		const count = operations.length;
		sheet.setCellValues([{ row: 1, col: 0, value: "quiet" }]);
		expect(operations).toHaveLength(count);
	});

	it("normalizes multi-row batches and their complete undo/redo payloads", () => {
		let controller: SheetController | undefined;
		const operations: SheetOperation[] = [];
		render(() => (
			<Sheet
				data={[
					["a", "b"],
					["c", "d"],
				]}
				columns={[
					{ id: "left", header: "Left" },
					{ id: "right", header: "Right" },
				]}
				ref={(value) => {
					controller = value;
				}}
				onOperation={(operation) => {
					operations.push(operation);
				}}
			/>
		));
		flush();
		if (!controller) throw new Error("Controller missing");
		const sheet = controller;
		const values = () => [
			sheet.getRawCellValue(0, 0),
			sheet.getRawCellValue(0, 1),
			sheet.getRawCellValue(1, 0),
			sheet.getRawCellValue(1, 1),
		];
		controller.setCellValues([
			{ row: 1, col: 1, value: "D" },
			{ row: 0, col: 0, value: "A" },
			{ row: 0, col: 1, value: "B" },
		]);
		flush();
		expect(values()).toEqual(["A", "B", "c", "D"]);
		const forward = operations[0];
		if (forward?.type !== "batch-edit") throw new Error("Batch missing");
		expect(
			forward.mutations.map((m) => [m.address.row, m.address.col, m.oldValue, m.newValue]),
		).toEqual([
			[1, 1, "d", "D"],
			[0, 0, "a", "A"],
			[0, 1, "b", "B"],
		]);
		controller.undo();
		flush();
		expect(values()).toEqual(["a", "b", "c", "d"]);
		expect(controller.canUndo()).toBe(false);
		const inverse = operations[1];
		if (inverse?.type !== "batch-edit") throw new Error("Inverse missing");
		expect(inverse.mutations).toEqual(
			forward.mutations.map((m) => ({ ...m, oldValue: m.newValue, newValue: m.oldValue })),
		);
		controller.redo();
		flush();
		expect(values()).toEqual(["A", "B", "c", "D"]);
		controller.setCellValues([
			{ row: 0, col: 0, value: "temporary" },
			{ row: 1, col: 0, value: "C" },
			{ row: 0, col: 1, value: "last" },
			{ row: 0, col: 0, value: "A" },
			{ row: 1, col: 0, value: "final" },
		]);
		flush();
		expect(values()).toEqual(["A", "last", "final", "D"]);
		const normalized = operations[3];
		if (normalized?.type !== "batch-edit") throw new Error("Normalized batch missing");
		expect(normalized.mutations.map((m) => [m.address.row, m.address.col, m.newValue])).toEqual([
			[1, 0, "final"],
			[0, 1, "last"],
		]);
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
