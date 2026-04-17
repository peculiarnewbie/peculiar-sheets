import { Sheet } from "peculiar-sheets";
import type { ColumnDef, CellValue } from "peculiar-sheets";

// sortBehavior="view" — clicking a header reorders the visible rows only.
// The underlying data array is never mutated.
// Click again to cycle: ascending → descending → unsorted.

const columns: ColumnDef[] = [
  { id: "name",  header: "Name",  width: 140, editable: true, sortable: true },
  { id: "age",   header: "Age",   width: 100, editable: true, sortable: true },
  { id: "city",  header: "City",  width: 140, editable: true, sortable: true },
  { id: "score", header: "Score", width: 100, editable: true, sortable: true },
];

const data: CellValue[][] = [
  ["Alice", 30, "Portland", 88],
  ["Bob",   25, "Seattle",  72],
  ["Carol", 35, "Denver",   95],
  ["Dave",  28, "Austin",   61],
];

export default function SortViewSheet() {
  return (
    <Sheet
      data={data}
      columns={columns}
      sortBehavior="view"
      showReferenceHeaders
    />
  );
}
