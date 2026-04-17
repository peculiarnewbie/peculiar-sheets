import { Sheet } from "peculiar-sheets";
import type { ColumnDef, CellValue } from "peculiar-sheets";

// Autofill is built-in — no props required.
// Select a range, then drag the fill handle (bottom-right corner).
// Numbers detect linear series; text cycles; formulas shift refs.

const columns: ColumnDef[] = [
  { id: "a", header: "Sequence", width: 120, editable: true },
  { id: "b", header: "Labels",   width: 120, editable: true },
  { id: "c", header: "Values",   width: 120, editable: true },
];

const data: CellValue[][] = [
  [1, "alpha", 100],
  [2, "beta",  200],
  [3, "gamma", 300],
  [null, null, null],
  [null, null, null],
  [null, null, null],
  [null, null, null],
  [null, null, null],
];

export default function AutofillSheet() {
  return <Sheet data={data} columns={columns} />;
}
