import { Sheet } from "peculiar-sheets";
import type { ColumnDef, CellValue } from "peculiar-sheets";

// Clipboard support is built-in — no props required.
// Ctrl+C copies, Ctrl+X cuts, Ctrl+V pastes.
// Data round-trips as TSV with Excel and Google Sheets.

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

export default function ClipboardSheet() {
  return <Sheet data={data} columns={columns} />;
}
