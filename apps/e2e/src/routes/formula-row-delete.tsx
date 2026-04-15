import HyperFormula from "hyperformula";
import type { ColumnDef, CellValue } from "peculiar-sheets";
import Harness from "../harness";

const columns: ColumnDef[] = [
	{ id: "team", header: "Team", width: 120, editable: true },
	{ id: "q1", header: "Q1", width: 85, editable: true },
	{ id: "q2", header: "Q2", width: 85, editable: true },
	{ id: "total", header: "Total", width: 110, editable: true },
];

const data: CellValue[][] = [
	["Engineering", 48, 52, "=B1+C1"],
	["Design", 32, 35, "=B2+C2"],
	["Marketing", 28, 31, "=B3+C3"],
	["Ops", 5, 7, "=B4+C4"],
	[null, null, "Sum", "=SUM(D1:D4)"],
	["RefToMarketing", null, null, "=B3"],
	["Pair", null, null, "=B3+B4"],
];

const hf = HyperFormula.buildEmpty({ licenseKey: "gpl-v3" });
const sheetName = hf.addSheet("FormulaRowDelete");
const sheetId = hf.getSheetId(sheetName)!;

export default function FormulaRowDeletePage() {
	return (
		<Harness
			initialData={data}
			columns={columns}
			formulaEngine={{ instance: hf, sheetId, sheetName }}
			showFormulaBar
			showReferenceHeaders
		/>
	);
}
