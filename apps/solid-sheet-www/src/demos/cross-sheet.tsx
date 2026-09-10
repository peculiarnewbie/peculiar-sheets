import { createStore } from "solid-js";
import { onSettled } from "solid-js";
import HyperFormula from "hyperformula";
import { Sheet, createWorkbookCoordinator } from "peculiar-sheets";
import type { ColumnDef, CellValue, CellMutation } from "peculiar-sheets";

// One HyperFormula instance, two sheets, one coordinator.
// The summary sheet references the data sheet via =Data!B1 syntax.
// Edit any value in the left sheet and the right sheet updates live.

const hf = HyperFormula.buildEmpty({ licenseKey: "gpl-v3" });
const coordinator = createWorkbookCoordinator({ engine: hf });

const dataWorkbook = coordinator.bindSheet({ sheetKey: "data", formulaName: "Data" });
const summaryWorkbook = coordinator.bindSheet({ sheetKey: "summary", formulaName: "Summary" });

const dataColumns: ColumnDef[] = [
	{ id: "label", header: "Label", width: 140, editable: true },
	{ id: "value", header: "Value", width: 100, editable: true },
];

const summaryColumns: ColumnDef[] = [
	{ id: "metric", header: "Metric", width: 140, editable: true },
	{ id: "result", header: "Result", width: 180, editable: true },
];

export default function CrossSheetDemo() {
	const [sheets, setSheets] = createStore<Record<string, CellValue[][]>>({
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
	});

	function applyMutation(sheetKey: string, mutation: CellMutation) {
		const { row, col } = mutation.address;
		setSheets((draft) => {
			const next = (draft[sheetKey] ?? []).map((row) => [...row]);
			while (next.length <= row) next.push([]);
			while ((next[row]?.length ?? 0) <= col) next[row]!.push(null);
			next[row]![col] = mutation.newValue;
			draft[sheetKey] = next;
		});
	}

	onSettled(() => {
		const unsubscribe = coordinator.subscribe((change) => {
			for (const snapshot of change.snapshots) {
				setSheets((draft) => {
					draft[snapshot.sheetKey] = snapshot.cells.map((row) => [...row]);
				});
			}
		});
		return unsubscribe;
	});

	return (
		<div
			style={{ display: "grid", "grid-template-columns": "1fr 1fr", gap: "12px", height: "100%" }}
		>
			<div style={{ overflow: "hidden" }}>
				<Sheet
					data={sheets.data}
					columns={dataColumns}
					workbook={dataWorkbook}
					onOperation={(op) => {
						switch (op.type) {
							case "cell-edit":
								return applyMutation("data", op.mutation);
							case "batch-edit":
								op.mutations.forEach((m) => applyMutation("data", m));
								return;
						}
					}}
				/>
			</div>
			<div style={{ overflow: "hidden" }}>
				<Sheet
					data={sheets.summary}
					columns={summaryColumns}
					workbook={summaryWorkbook}
					onOperation={(op) => {
						switch (op.type) {
							case "cell-edit":
								return applyMutation("summary", op.mutation);
							case "batch-edit":
								op.mutations.forEach((m) => applyMutation("summary", m));
								return;
						}
					}}
				/>
			</div>
		</div>
	);
}
