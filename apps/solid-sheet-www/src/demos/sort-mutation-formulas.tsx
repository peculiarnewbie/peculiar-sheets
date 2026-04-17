import HyperFormula from "hyperformula";
import { Sheet } from "peculiar-sheets";
import type { ColumnDef, CellValue } from "peculiar-sheets";

// Mutation sort combined with formulas — HyperFormula recomputes
// all formula cells after each sort to match the new row order.

const hf = HyperFormula.buildEmpty({ licenseKey: "gpl-v3" });
const sheetName = hf.addSheet("sort-mutation-formulas");
const sheetId = hf.getSheetId(sheetName)!;

const columns: ColumnDef[] = [
  { id: "a", header: "A", width: 100, editable: true, sortable: true },
  { id: "b", header: "B", width: 100, editable: true, sortable: true },
  { id: "c", header: "C", width: 120, editable: true, sortable: true },
];

const data: CellValue[][] = [
  [1, 10, "=A1+B1"],
  [3, 30, "=A2+B2"],
  [2, 20, "=A3+B3"],
];

export default function SortMutationFormulasSheet() {
  return (
    <Sheet
      data={data}
      columns={columns}
      formulaEngine={{ instance: hf, sheetId, sheetName }}
      sortBehavior="mutation"
      showFormulaBar
      showReferenceHeaders
    />
  );
}
