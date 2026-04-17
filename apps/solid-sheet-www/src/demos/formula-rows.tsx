import HyperFormula from "hyperformula";
import { Sheet } from "peculiar-sheets";
import type { ColumnDef, CellValue } from "peculiar-sheets";

// Right-click a row header to insert or delete rows.
// When a row is inserted, =SUM ranges expand and all cell
// references below shift down automatically.

const hf = HyperFormula.buildEmpty({ licenseKey: "gpl-v3" });
const sheetName = hf.addSheet("formula-rows");
const sheetId = hf.getSheetId(sheetName)!;

const columns: ColumnDef[] = [
  { id: "team",  header: "Team",  width: 120, editable: true },
  { id: "q1",    header: "Q1",    width: 85,  editable: true },
  { id: "q2",    header: "Q2",    width: 85,  editable: true },
  { id: "total", header: "Total", width: 95,  editable: true },
];

const data: CellValue[][] = [
  ["Engineering", 48, 52, "=B1+C1"],
  ["Design",      32, 35, "=B2+C2"],
  ["Marketing",   28, 31, "=B3+C3"],
  [null, null, "Sum", "=SUM(D1:D3)"],
  [null, null, null, null],
  [null, null, null, null],
];

export default function FormulaRowsSheet() {
  return (
    <Sheet
      data={data}
      columns={columns}
      formulaEngine={{ instance: hf, sheetId, sheetName }}
      showFormulaBar
      showReferenceHeaders
    />
  );
}
