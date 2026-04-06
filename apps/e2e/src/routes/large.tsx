import type { ColumnDef, CellValue } from "peculiar-sheets";
import Harness from "../harness";

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

export default function LargePage() {
	return <Harness initialData={data} columns={columns} />;
}
