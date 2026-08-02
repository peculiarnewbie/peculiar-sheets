import { batch, createEffect, createSignal, onMount } from "solid-js";
import { Sheet, type CellValue, type ColumnDef, type SheetController, rowId } from "peculiar-sheets";
import "peculiar-sheets/styles";

const columns: ColumnDef[] = [
	{ id: "value", header: "Value", width: 120, editable: true },
];

const initialData: CellValue[][] = [["first"], ["second"], ["third"]];
const initialRowIds = [rowId("first"), rowId("second"), rowId("third")];

/** A focused controlled-host fixture for identity replacement regressions. */
export default function IdentityReconcilePage() {
	const [data, setData] = createSignal<CellValue[][]>(initialData);
	const [rowIds, setRowIds] = createSignal(initialRowIds);
	let controller: SheetController | null = null;

	createEffect(() => {
		window.__SHEET_DATA__ = data();
	});

	onMount(() => {
		window.__IDENTITY_REPLACE_WITH_DISJOINT_DATA__ = () => {
			batch(() => {
				setData([["replacement"]]);
				setRowIds([rowId("replacement")]);
			});
		};
	});

	return (
		<div style={{ width: "100vw", height: "100vh" }} data-testid="harness">
			<Sheet
				data={data()}
				columns={columns}
				rowIds={rowIds()}
				ref={(nextController) => {
					controller = nextController;
					window.__SHEET_CONTROLLER__ = controller;
				}}
			/>
		</div>
	);
}
