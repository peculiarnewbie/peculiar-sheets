import type { ColumnDef, CellValue } from "@peculiarnewbie/spreadsheets";
import Harness from "../harness";

const columns: ColumnDef[] = [
	{ id: "a", header: "Locked", width: 120, editable: false },
	{ id: "b", header: "Editable", width: 120, editable: true },
	{ id: "c", header: "Also Locked", width: 120, editable: false },
];

const data: CellValue[][] = [
	["no-edit", "can-edit", "no-edit"],
	["fixed", "free", "fixed"],
	["locked", "open", "locked"],
];

export default function ReadonlyPage() {
	return <Harness initialData={data} columns={columns} />;
}
