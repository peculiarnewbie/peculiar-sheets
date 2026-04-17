import { Sheet } from "peculiar-sheets";
import type { ColumnDef, CellValue } from "peculiar-sheets";

// Undo/redo is built-in — no props required.
// Ctrl+Z undoes, Ctrl+Y redoes.
// Batch operations (paste, autofill) count as a single history step.

const columns: ColumnDef[] = [
  { id: "a", header: "Col A", width: 120, editable: true },
  { id: "b", header: "Col B", width: 120, editable: true },
];

const data: CellValue[][] = [
  ["original", 100],
  ["untouched", 200],
];

export default function HistorySheet() {
  return <Sheet data={data} columns={columns} />;
}
