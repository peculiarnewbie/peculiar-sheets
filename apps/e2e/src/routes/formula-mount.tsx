import HyperFormula from "hyperformula";
import { onMount } from "solid-js";
import { Sheet, formulaSheetId, type CellValue, type ColumnDef, type SheetController } from "peculiar-sheets";

const columns: ColumnDef[] = Array.from({ length: 10 }, (_, index) => ({
	id: `column-${index}`,
	header: String.fromCharCode(65 + index),
	width: 100,
	editable: true,
}));

const data: CellValue[][] = Array.from({ length: 50 }, () => Array<CellValue>(10).fill(null));
const hf = HyperFormula.buildEmpty({ licenseKey: "gpl-v3" });
const sheetName = hf.addSheet("scratch");
const sheetId = hf.getSheetId(sheetName);

if (sheetId === undefined) {
	throw new Error(`HyperFormula did not resolve sheet "${sheetName}".`);
}

export default function FormulaMountPage() {
	const setController = (controller: SheetController) => {
		window.__SHEET_CONTROLLER__ = controller;
	};
	onMount(() => {
		window.__SHEET_DATA__ = data;
	});

	return (
		<div
			style={{ width: "100vw", height: "100vh" }}
			data-testid="harness"
			data-build-mode={import.meta.env.PROD ? "production" : "development"}
		>
			<Sheet
				data={data}
				columns={columns}
				formulaEngine={{ instance: hf, sheetId: formulaSheetId(sheetId), sheetName }}
				showFormulaBar
				showReferenceHeaders
				ref={setController}
			/>
		</div>
	);
}
