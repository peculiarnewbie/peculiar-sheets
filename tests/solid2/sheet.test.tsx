import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, renderHook, fireEvent } from "@solidjs/testing-library";
import { createEffect, createSignal, flush } from "solid-js";
import { Sheet } from "../../packages/spreadsheets/src/Sheet";
import { createSheetStore } from "../../packages/spreadsheets/src/core/state";
import { rowId, physicalRow } from "../../packages/spreadsheets/src/core/brands";
import type { CellValue, SheetController } from "../../packages/spreadsheets/src/types";

afterEach(cleanup);

describe("Solid 2 Sheet", () => {
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
