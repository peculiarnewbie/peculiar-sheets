import type { ColumnDef, CellValue } from "@peculiarnewbie/spreadsheets";
import Harness from "../harness";

const columns: ColumnDef[] = [
	{ id: "a", header: "X", width: 100, editable: true },
	{ id: "b", header: "Y", width: 100, editable: true },
	{ id: "c", header: "Z", width: 100, editable: true },
];

const data: CellValue[][] = [
	[1, 2, 3],
	[4, 5, 6],
	[7, 8, 9],
	[null, null, null],
	[null, null, null],
];

export default function ClipboardPage() {
	return <Harness initialData={data} columns={columns} />;
}
