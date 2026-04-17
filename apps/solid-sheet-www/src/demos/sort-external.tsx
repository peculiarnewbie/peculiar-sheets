import { createSignal } from "solid-js";
import { Sheet } from "peculiar-sheets";
import type { ColumnDef, CellValue, SortDirection } from "peculiar-sheets";

// sortBehavior="external" — the sheet fires onSort with columnId + direction
// but never reorders itself. The host owns the data order.
// Useful for server-side sorting or custom sort logic.

const columns: ColumnDef[] = [
  { id: "name",  header: "Name",  width: 140, editable: true, sortable: true },
  { id: "age",   header: "Age",   width: 100, editable: true, sortable: true },
  { id: "city",  header: "City",  width: 140, editable: true, sortable: true },
  { id: "score", header: "Score", width: 100, editable: true, sortable: true },
];

const baseData: CellValue[][] = [
  ["Alice", 30, "Portland", 88],
  ["Bob",   25, "Seattle",  72],
  ["Carol", 35, "Denver",   95],
  ["Dave",  28, "Austin",   61],
];

export default function SortExternalSheet() {
  const [data, setData] = createSignal(baseData);

  function onSort(columnId: string, direction: SortDirection | null) {
    if (!direction) return setData(baseData);
    const colIdx = columns.findIndex((c) => c.id === columnId);
    const dir = direction === "asc" ? 1 : -1;
    setData(
      [...baseData].sort((a, b) => {
        const av = a[colIdx] ?? "";
        const bv = b[colIdx] ?? "";
        return (av < bv ? -1 : av > bv ? 1 : 0) * dir;
      }),
    );
  }

  return (
    <Sheet
      data={data()}
      columns={columns}
      sortBehavior="external"
      onSort={onSort}
      showReferenceHeaders
    />
  );
}
