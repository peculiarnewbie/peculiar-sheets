import { createSignal, flush, onCleanup, Show } from "solid-js";
import { render } from "@solidjs/web";
import {
	Sheet,
	columnIdx,
	visualRow,
	type CellValue,
	type ColumnDef,
	type SheetController,
	type SheetOperation,
} from "peculiar-sheets";
import "peculiar-sheets/styles";

const root = document.getElementById("root");
if (!root) throw new Error("Missing consumer root");
const results: string[] = [];
const nativeResizeObserver = window.ResizeObserver;
const observerTargets = new Map<ResizeObserver, Set<Element>>();
class TrackedResizeObserver extends nativeResizeObserver {
	observe(target: Element, options?: ResizeObserverOptions) {
		const targets = observerTargets.get(this) ?? new Set<Element>();
		targets.add(target);
		observerTargets.set(this, targets);
		super.observe(target, options);
	}
	unobserve(target: Element) {
		const targets = observerTargets.get(this);
		targets?.delete(target);
		if (targets?.size === 0) observerTargets.delete(this);
		super.unobserve(target);
	}
	disconnect() {
		observerTargets.delete(this);
		super.disconnect();
	}
}
window.ResizeObserver = TrackedResizeObserver;
let controller: SheetController | undefined;
let operations = 0;
let rootDisposed = false;
let updateData: (value: CellValue[][]) => void = () => {};
let updateReadOnly: (value: boolean) => void = () => {};
let updateColumns: (value: ColumnDef[]) => void = () => {};
let updateVisible: (value: boolean) => void = () => {};
const columns: ColumnDef[] = [
	{ id: "name", header: "Name", width: 160, editable: true },
	{ id: "value", header: "Value", width: 120, editable: true },
];

const dispose = render(() => {
	const [data, setData] = createSignal<CellValue[][]>([
		["first", 1],
		["second", 2],
		["third", 3],
	]);
	const [readOnly, setReadOnly] = createSignal(false);
	const [cols, setColumns] = createSignal(columns);
	const [visible, setVisible] = createSignal(true);
	updateData = setData;
	updateReadOnly = setReadOnly;
	updateColumns = setColumns;
	updateVisible = setVisible;
	onCleanup(() => {
		rootDisposed = true;
	});
	function onOperation(operation: SheetOperation) {
		operations++;
		if (operation.type === "cell-edit" || operation.type === "batch-edit") {
			const mutations = operation.type === "cell-edit" ? [operation.mutation] : operation.mutations;
			setData((previous) => {
				const next = previous.map((row) => [...row]);
				for (const mutation of mutations)
					next[mutation.address.row][mutation.address.col] = mutation.newValue;
				return next;
			});
		}
	}
	return (
		<Show when={visible()}>
			<div style={{ width: "640px", height: "360px" }}>
				<Sheet
					data={data()}
					columns={cols()}
					readOnly={readOnly()}
					ariaLabel="Consumer sheet"
					onOperation={onOperation}
					ref={(value) => {
						controller = value;
					}}
				/>
			</div>
		</Show>
	);
}, root);

function check(condition: unknown, message: string) {
	if (!condition) throw new Error(message);
	results.push(message);
}
const settle = async () => {
	flush();
	await new Promise((resolve) => setTimeout(resolve, 30));
	flush();
};
function grid() {
	const element = document.querySelector<HTMLElement>(".se-grid");
	if (!element) throw new Error("Grid is missing");
	return element;
}
function key(target: Element, value: string, options: KeyboardEventInit = {}) {
	target.dispatchEvent(
		new KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true, ...options }),
	);
}

async function runChecks() {
	await settle();
	check(document.querySelectorAll(".se-cell").length === 6, "initial virtual cells render");
	check(controller?.getCellValue(0, 0) === "first", "controller shares mounted data");
	updateData([
		["controlled", 10],
		["second", 20],
		["third", 30],
	]);
	await settle();
	check(document.querySelector(".se-cell")?.textContent === "controlled", "reactive data renders");
	updateColumns([{ ...columns[0], header: "Updated name" }, columns[1]]);
	await settle();
	check(
		document.querySelector(".se-header-cell")?.textContent?.includes("Updated name"),
		"reactive columns render",
	);
	grid().focus();
	key(grid(), "F2");
	await settle();
	const editor = document.querySelector<HTMLInputElement>(".se-cell-editor");
	check(editor && document.activeElement === editor, "F2 opens and focuses editor");
	if (!editor) throw new Error("No editor");
	editor.value = "edited";
	editor.dispatchEvent(
		new InputEvent("input", { bubbles: true, data: "edited", inputType: "insertText" }),
	);
	await settle();
	key(editor, "Enter");
	await settle();
	check(controller?.getCellValue(0, 0) === "edited", "editing commits through controlled host");
	check(
		controller?.getSelection().focus.row === 1 && !document.querySelector(".se-cell-editor"),
		"Enter commits and moves down",
	);
	key(grid(), "ArrowRight");
	await settle();
	check(controller?.getSelection().focus.col === 1, "arrow key navigates");
	key(grid(), "ArrowDown", { shiftKey: true });
	await settle();
	check(controller?.getSelection().ranges[0]?.end.row === 2, "Shift+Arrow extends selection");
	controller?.setSelection([
		{
			start: { row: visualRow(0), col: columnIdx(0) },
			end: { row: visualRow(0), col: columnIdx(0) },
		},
	]);
	await settle();
	const transfer = new DataTransfer();
	transfer.setData("text/plain", "pasted\t42");
	grid().dispatchEvent(
		new ClipboardEvent("paste", { clipboardData: transfer, bubbles: true, cancelable: true }),
	);
	await settle();
	check(
		controller?.getCellValue(0, 0) === "pasted" && controller.getCellValue(0, 1) === 42,
		"native TSV paste updates cells",
	);
	controller?.undo();
	await settle();
	check(controller?.getCellValue(0, 0) === "edited", "undo restores pasted cells");
	controller?.redo();
	await settle();
	check(controller?.getCellValue(0, 0) === "pasted", "redo reapplies paste");
	const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, "clipboard");
	let copied = "";
	Object.defineProperty(navigator, "clipboard", {
		configurable: true,
		value: {
			writeText: async (text: string) => {
				copied = text;
			},
		},
	});
	try {
		key(grid(), "c", { ctrlKey: true });
		await settle();
		check(copied === "pasted", "copy serializes selected cells");
		key(grid(), "x", { ctrlKey: true });
		await settle();
		check(
			copied === "pasted" && controller?.getCellValue(0, 0) === null,
			"cut copies and clears cells",
		);
		controller?.undo();
		await settle();
	} finally {
		if (clipboardDescriptor) Object.defineProperty(navigator, "clipboard", clipboardDescriptor);
		else Reflect.deleteProperty(navigator, "clipboard");
	}
	updateReadOnly(true);
	await settle();
	key(grid(), "F2");
	await settle();
	check(
		!document.querySelector(".se-cell-editor") && grid().getAttribute("aria-readonly") === "true",
		"reactive readOnly prevents editing",
	);
	updateReadOnly(false);
	updateData(Array.from({ length: 10000 }, (_, index) => [`row-${index}`, index]));
	await settle();
	controller?.scrollToCell(9000, 0);
	// Hidden embedded browsers may defer native scroll-event delivery.
	document.querySelector(".se-viewport")?.dispatchEvent(new Event("scroll"));
	await settle();
	check(
		document.querySelectorAll(".se-cell").length < 100 &&
			document.body.textContent?.includes("row-9000"),
		"large grid virtualizes and scrolls to distant row",
	);
	const oldGrid = grid();
	const beforeDispose = operations;
	updateVisible(false);
	await settle();
	check(!document.querySelector(".se-grid"), "conditional unmount removes grid");
	check(observerTargets.size === 0, "unmount disconnects every viewport observer");
	oldGrid.dispatchEvent(
		new ClipboardEvent("paste", { clipboardData: transfer, bubbles: true, cancelable: true }),
	);
	await settle();
	check(operations === beforeDispose, "paste listener is removed on unmount");
	updateVisible(true);
	await settle();
	check(document.querySelectorAll(".se-cell").length > 0, "remount reattaches virtualizers");
	dispose();
	await settle();
	check(rootDisposed && !root?.hasChildNodes(), "render root disposes and removes DOM");
	check(observerTargets.size === 0, "root disposal disconnects remounted observers");
	window.ResizeObserver = nativeResizeObserver;
	return results;
}

declare global {
	interface Window {
		__PACKED_CHECKS__: { run: typeof runChecks; results: string[] };
	}
}
window.__PACKED_CHECKS__ = { run: runChecks, results };
