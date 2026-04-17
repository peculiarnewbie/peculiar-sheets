import { createStore } from "solid-js/store";
import { onMount, onCleanup } from "solid-js";
import HyperFormula from "hyperformula";
import { Sheet, createWorkbookCoordinator } from "peculiar-sheets";
import type { ColumnDef, CellValue, CellMutation } from "peculiar-sheets";

// One HyperFormula instance, two sheets, one coordinator.
// The summary sheet references the data sheet via =Data!B1 syntax.
// Edit any value in the left sheet and the right sheet updates live.

const hf = HyperFormula.buildEmpty({ licenseKey: "gpl-v3" });
const coordinator = createWorkbookCoordinator({ engine: hf });

const dataWorkbook    = coordinator.bindSheet({ sheetKey: "data",    formulaName: "Data"    });
const summaryWorkbook = coordinator.bindSheet({ sheetKey: "summary", formulaName: "Summary" });

const dataColumns: ColumnDef[] = [
  { id: "label", header: "Label", width: 140, editable: true },
  { id: "value", header: "Value", width: 100, editable: true },
];

const summaryColumns: ColumnDef[] = [
  { id: "metric", header: "Metric", width: 140, editable: true },
  { id: "result", header: "Result", width: 180, editable: true },
];

export default function CrossSheetDemo() {
  const [sheets, setSheets] = createStore<Record<string, CellValue[][]>>({
    data: [
      ["Alpha", 10],
      ["Beta",  20],
      ["Gamma", 30],
    ],
    summary: [
      ["Total", "=SUM(Data!B1:B3)"],
      ["First", "=Data!A1"],
      ["Mid",   "=Data!B2"],
      ["Draft", null],
    ],
  });

  function applyMutation(sheetKey: string, mutation: CellMutation) {
    const { row, col } = mutation.address;
    setSheets(sheetKey, (prev) => {
      const next = prev.map((r) => [...r]);
      while (next.length <= row) next.push([]);
      while ((next[row]?.length ?? 0) <= col) next[row]!.push(null);
      next[row]![col] = mutation.newValue;
      return next;
    });
  }

  onMount(() => {
    const unsubscribe = coordinator.subscribe((change) => {
      for (const snapshot of change.snapshots) {
        setSheets(
          snapshot.sheetKey,
          snapshot.cells.map((row) => [...row]),
        );
      }
    });
    onCleanup(() => unsubscribe());
  });

  return (
    <div style={{ display: "grid", "grid-template-columns": "1fr 1fr", gap: "12px", height: "100%" }}>
      <div style={{ overflow: "hidden" }}>
        <Sheet
          data={sheets.data}
          columns={dataColumns}
          workbook={dataWorkbook}
          onCellEdit={(m) => applyMutation("data", m)}
          onBatchEdit={(ms) => ms.forEach((m) => applyMutation("data", m))}
        />
      </div>
      <div style={{ overflow: "hidden" }}>
        <Sheet
          data={sheets.summary}
          columns={summaryColumns}
          workbook={summaryWorkbook}
          onCellEdit={(m) => applyMutation("summary", m)}
          onBatchEdit={(ms) => ms.forEach((m) => applyMutation("summary", m))}
        />
      </div>
    </div>
  );
}
