import type { CellMutation, CellValue, SheetController } from "@peculiarnewbie/spreadsheets";

declare global {
	interface Window {
		/** Current cell data — updated reactively by the test harness. */
		__SHEET_DATA__: CellValue[][];
		/** Accumulated mutations from onCellEdit / onBatchEdit callbacks. */
		__MUTATIONS__: CellMutation[];
		/** Imperative sheet controller for programmatic access. */
		__SHEET_CONTROLLER__: SheetController | null;
	}
}
