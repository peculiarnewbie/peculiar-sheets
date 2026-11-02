import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, renderHook, fireEvent } from "@solidjs/testing-library";
import { createEffect, createMemo, createRoot, createSignal, flush, Loading } from "solid-js";
import { Sheet } from "../../packages/spreadsheets/src/Sheet";
import { createSheetStore } from "../../packages/spreadsheets/src/core/state";
import {
	rowId,
	physicalRow,
	visualRow,
	columnIdx,
} from "../../packages/spreadsheets/src/core/brands";
import type {
	CellValue,
	CellStyle,
	ColumnDef,
	SheetController,
} from "../../packages/spreadsheets/src/types";
import GridCell, { type GridCellContext } from "../../packages/spreadsheets/src/grid/GridCell";
import { SheetCustomizationContext } from "../../packages/spreadsheets/src/customization";
import { selectCell } from "../../packages/spreadsheets/src/core/selection";

afterEach(cleanup);

describe("Solid 2 Sheet", () => {
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
					virtualRow={{ index: 0, start: 0, size: 28 }}
					virtualColumn={{ index: 0, start: 0, size: 100, column: column() }}
					grid={grid}
					rowClass=""
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
