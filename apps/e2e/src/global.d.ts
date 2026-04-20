import type {
	CellMutation,
	CellValue,
	RowReorderMutation,
	SheetController,
	SortState,
	WorkbookStructuralChange,
} from "peculiar-sheets";

declare global {
	interface Window {
		/** Current cell data — updated reactively by the test harness. */
		__SHEET_DATA__: CellValue[][];
		/** Accumulated mutations from onCellEdit / onBatchEdit callbacks. */
		__MUTATIONS__: CellMutation[];
		/** Accumulated row reorder mutations. */
		__ROW_REORDERS__: RowReorderMutation[];
		/** Current sort state (for sort.test.ts assertions). */
		__SORT_STATE__: SortState | null;
		/** Imperative sheet controller for programmatic access. */
		__SHEET_CONTROLLER__: SheetController | null;
		/** Workbook route state by sheet key. */
		__WORKBOOK_DATA__: Record<string, CellValue[][]>;
		/** Workbook route controllers by sheet key. */
		__WORKBOOK_CONTROLLERS__: Record<string, SheetController | null>;
		/** Workbook structural changes emitted by the coordinator. */
		__WORKBOOK_CHANGES__: WorkbookStructuralChange[];
		/** Installed by the harness; flushes the shared mutation buffer. */
		__HARNESS_CLEAR_MUTATIONS__?: () => void;
	}
}
