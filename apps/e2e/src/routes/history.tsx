import type { ColumnDef, CellValue } from "@peculiarnewbie/spreadsheets";
import Harness from "../harness";

const columns: ColumnDef[] = [
	{ id: "a", header: "Col A", width: 120, editable: true },
	{ id: "b", header: "Col B", width: 120, editable: true },
];

const data: CellValue[][] = [
	["original", 100],
	["untouched", 200],
];

export default function HistoryPage() {
	return <Harness initialData={data} columns={columns} />;
}
