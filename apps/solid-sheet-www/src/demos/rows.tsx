import { Sheet } from "peculiar-sheets";
import type { ColumnDef, CellValue } from "peculiar-sheets";

// Row insert and delete are built-in — no props required.
// Right-click any row header to open the context menu:
//   Insert row above · Insert row below · Delete row

const columns: ColumnDef[] = [
  { id: "a", header: "Name",  width: 120, editable: true },
  { id: "b", header: "Value", width: 120, editable: true },
];

const data: CellValue[][] = [
  ["alpha", 10],
  ["beta",  20],
  ["gamma", 30],
];

export default function RowsSheet() {
  return <Sheet data={data} columns={columns} />;
}
