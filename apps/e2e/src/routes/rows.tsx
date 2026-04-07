import type { ColumnDef, CellValue } from "peculiar-sheets";
import Harness from "../harness";

const columns: ColumnDef[] = [
	{ id: "a", header: "Name", width: 120, editable: true },
	{ id: "b", header: "Value", width: 120, editable: true },
];

const data: CellValue[][] = [
	["alpha", 10],
	["beta", 20],
	["gamma", 30],
];

export default function RowsPage() {
	return <Harness initialData={data} columns={columns} />;
}
