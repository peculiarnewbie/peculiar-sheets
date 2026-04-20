import { Sheet } from "peculiar-sheets";
import type { ColumnDef, CellValue } from "peculiar-sheets";
import { ReplayHost, type ReplayHostHandle } from "../player/ReplayHost";

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

export interface BasicSheetProps {
  /** Called once the replay host has mounted. Forwards the controller + buffer
   * up to the parent `ScenarioPlayer`, which drives scenarios against this
   * `<Sheet>` without touching `window.*` globals. */
  onReplayReady?: (handle: ReplayHostHandle) => void;
}

export default function BasicSheet(props: BasicSheetProps = {}) {
  return (
    <ReplayHost initialData={data} columns={columns} onReady={props.onReplayReady}>
      {({ data: liveData, bindings, ref }) => (
        <Sheet
          data={liveData()}
          columns={columns}
          onCellEdit={bindings.onCellEdit}
          onBatchEdit={bindings.onBatchEdit}
          onRowInsert={bindings.onRowInsert}
          onRowDelete={bindings.onRowDelete}
          onRowReorder={bindings.onRowReorder}
          ref={ref}
        />
      )}
    </ReplayHost>
  );
}
