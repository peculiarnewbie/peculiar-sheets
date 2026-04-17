import { Sheet } from "peculiar-sheets";
import type { ColumnDef, CellValue } from "peculiar-sheets";

// Set editable: false on a column to make it read-only.
// Blocked interactions: double-click to edit, Delete key, paste.

const columns: ColumnDef[] = [
  { id: "a", header: "Locked",      width: 120, editable: false },
  { id: "b", header: "Editable",    width: 120, editable: true  },
  { id: "c", header: "Also Locked", width: 120, editable: false },
];

const data: CellValue[][] = [
  ["no-edit", "can-edit", "no-edit"],
  ["fixed",   "free",     "fixed"  ],
  ["locked",  "open",     "locked" ],
];

export default function ReadonlySheet() {
  return <Sheet data={data} columns={columns} />;
}
