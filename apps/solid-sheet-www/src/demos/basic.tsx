import { Sheet } from "peculiar-sheets";
import type { ColumnDef, CellValue } from "peculiar-sheets";

const columns: ColumnDef[] = [
  { id: "a", header: "Name",  width: 140, editable: true },
  { id: "b", header: "Age",   width: 80,  editable: true },
  { id: "c", header: "City",  width: 120, editable: true },
  { id: "d", header: "Score", width: 100, editable: true },
];

const data: CellValue[][] = [
  ["Alice", 30, "Portland", 88],
  ["Bob",   25, "Seattle",  72],
  ["Carol", 35, "Denver",   95],
  ["Dave",  28, "Austin",   61],
  ["Eve",   22, "Boston",   83],
];

export default function BasicSheet() {
  return <Sheet data={data} columns={columns} />;
}
