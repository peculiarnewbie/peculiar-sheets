import { Sheet } from "peculiar-sheets";
import type { ColumnDef, CellValue } from "peculiar-sheets";

// Row virtualization is built-in via @tanstack/solid-virtual.
// Only visible rows are in the DOM — 10 000 rows scroll smoothly.

const COL_COUNT = 20;
const ROW_COUNT = 10_000;

const columns: ColumnDef[] = Array.from({ length: COL_COUNT }, (_, i) => ({
  id: `col${i}`,
  header: `Col ${i}`,
  width: 100,
  editable: true,
}));

const data: CellValue[][] = Array.from({ length: ROW_COUNT }, (_, row) =>
  Array.from({ length: COL_COUNT }, (_, col) => row * COL_COUNT + col),
);

export default function LargeSheet() {
  return <Sheet data={data} columns={columns} />;
}
