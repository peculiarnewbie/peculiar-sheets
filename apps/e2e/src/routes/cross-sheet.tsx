import { createEffect, onCleanup, onMount } from "solid-js";
import { createStore } from "solid-js/store";
import HyperFormula from "hyperformula";
import {
	Sheet,
	createWorkbookCoordinator,
	type CellMutation,
	type CellValue,
	type ColumnDef,
	type SheetController,
} from "peculiar-sheets";
import "peculiar-sheets/styles";

const dataColumns: ColumnDef[] = [
	{ id: "label", header: "Label", width: 140, editable: true, sortable: true },
	{ id: "value", header: "Value", width: 100, editable: true, sortable: true },
];

const summaryColumns: ColumnDef[] = [
	{ id: "metric", header: "Metric", width: 140, editable: true },
	{ id: "result", header: "Result", width: 180, editable: true },
];

const initialSheets: Record<string, CellValue[][]> = {
	data: [
		["Alpha", 10],
		["Beta", 20],
		["Gamma", 30],
	],
	summary: [
		["Total", "=SUM(Data!B1:B3)"],
		["First", "=Data!A1"],
		["Mid", "=Data!B2"],
		["Draft", null],
	],
};

const hf = HyperFormula.buildEmpty({ licenseKey: "gpl-v3" });
const coordinator = createWorkbookCoordinator({ engine: hf });
const dataWorkbook = coordinator.bindSheet({ sheetKey: "data", formulaName: "Data" });
const summaryWorkbook = coordinator.bindSheet({ sheetKey: "summary", formulaName: "Summary" });

function cloneSheetMap(source: Record<string, CellValue[][]>) {
	return Object.fromEntries(
		Object.entries(source).map(([key, cells]) => [key, cells.map((row) => [...row])]),
	);
}

export default function CrossSheetPage() {
	const [sheetState, setSheetState] = createStore(cloneSheetMap(initialSheets));
	const controllers: Record<string, SheetController | null> = {
		data: null,
		summary: null,
	};

	function syncWindowState() {
		window.__SHEET_DATA__ = cloneSheetMap(sheetState).data;
		window.__WORKBOOK_DATA__ = cloneSheetMap(sheetState);
		window.__WORKBOOK_CONTROLLERS__ = { ...controllers };
	}

	function handleController(sheetKey: string) {
		return (controller: SheetController) => {
			controllers[sheetKey] = controller;
			syncWindowState();
		};
	}

	function applyMutation(sheetKey: string, mutation: CellMutation) {
		const { row, col } = mutation.address;
		setSheetState(sheetKey, (prevRows) => {
			const next = prevRows.map((dataRow) => [...dataRow]);
			while (next.length <= row) next.push([]);
			while (next[row]!.length <= col) next[row]!.push(null);
			next[row]![col] = mutation.newValue;
			return next;
		});
	}

	function handleCellEdit(sheetKey: string) {
		return (mutation: CellMutation) => {
			applyMutation(sheetKey, mutation);
			syncWindowState();
		};
	}

	function handleBatchEdit(sheetKey: string) {
		return (mutations: CellMutation[]) => {
			for (const mutation of mutations) {
				applyMutation(sheetKey, mutation);
			}
			syncWindowState();
		};
	}

	onMount(() => {
		window.__WORKBOOK_CHANGES__ = [];
		syncWindowState();

		const unsubscribe = coordinator.subscribe((change) => {
			window.__WORKBOOK_CHANGES__.push(change);
			for (const snapshot of change.snapshots) {
				setSheetState(snapshot.sheetKey, snapshot.cells.map((row) => [...row]));
			}
			syncWindowState();
		});

		onCleanup(() => unsubscribe());
	});

	createEffect(() => {
		syncWindowState();
	});

	return (
		<div
			data-testid="harness"
			style={{
				display: "grid",
				"grid-template-columns": "1fr 1fr",
				gap: "16px",
				width: "100vw",
				height: "100vh",
				padding: "12px",
				"box-sizing": "border-box",
			}}
		>
			<div data-testid="sheet-data" style={{ overflow: "hidden" }}>
				<Sheet
					data={sheetState.data}
					columns={dataColumns}
					workbook={dataWorkbook}
					onCellEdit={handleCellEdit("data")}
					onBatchEdit={handleBatchEdit("data")}
					ref={handleController("data")}
					sortBehavior="mutation"
				/>
			</div>
			<div data-testid="sheet-summary" style={{ overflow: "hidden" }}>
				<Sheet
					data={sheetState.summary}
					columns={summaryColumns}
					workbook={summaryWorkbook}
					onCellEdit={handleCellEdit("summary")}
					onBatchEdit={handleBatchEdit("summary")}
					ref={handleController("summary")}
				/>
			</div>
		</div>
	);
}
