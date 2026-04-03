import type { ColumnDef, CellValue } from "@peculiarnewbie/spreadsheets";
import Harness from "../harness";

const columns: ColumnDef[] = [
	{ id: "a", header: "Sequence", width: 120, editable: true },
	{ id: "b", header: "Labels", width: 120, editable: true },
	{ id: "c", header: "Values", width: 120, editable: true },
];

const data: CellValue[][] = [
	[1, "alpha", 100],
	[2, "beta", 200],
	[3, "gamma", 300],
	[null, null, null],
	[null, null, null],
	[null, null, null],
	[null, null, null],
	[null, null, null],
];

export default function AutofillPage() {
	return <Harness initialData={data} columns={columns} />;
}
