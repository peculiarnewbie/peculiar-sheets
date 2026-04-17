import HyperFormula from "hyperformula";
import { Sheet } from "peculiar-sheets";
import type { ColumnDef, CellValue } from "peculiar-sheets";

const hf = HyperFormula.buildEmpty({ licenseKey: "gpl-v3" });
const sheetName = hf.addSheet("formulas");
const sheetId = hf.getSheetId(sheetName)!;

const columns: ColumnDef[] = [
  { id: "a", header: "A", width: 100, editable: true },
  { id: "b", header: "B", width: 100, editable: true },
  { id: "c", header: "C", width: 140, editable: true },
];

const data: CellValue[][] = [
  [10, 20, "=A1+B1"],
  [30, 40, "=A2+B2"],
  [50, 60, "=A3+B3"],
  [null, null, "=SUM(C1:C3)"],
];

export default function FormulasSheet() {
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
