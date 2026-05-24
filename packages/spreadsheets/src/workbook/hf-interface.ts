/**
 * HyperFormula engine interface.
 * Extracted from coordinator.ts as a named dependency seam.
 * The coordinator depends on this interface, not on HyperFormula directly.
 */
export interface HyperFormulaWorkbookLike {
	/** Create a new sheet, optionally named. Returns the created sheet name. */
	addSheet(name?: string): string;

	/** Get the internal sheet ID for a given sheet name. */
	getSheetId(name: string): number | undefined;

	/** Get the sheet name for a given internal sheet ID. */
	getSheetName(sheetId: number): string | undefined;

	/**
	 * Convert a cell range to a string representation of its sheet, row, and column.
	 * Use when inserting cross-sheet references.
	 */
	simpleCellRangeToString(
		range: {
			start: { sheet: number; row: number; col: number };
			end: { sheet: number; row: number; col: number };
		},
		contextSheetId: number,
	): string | undefined;

	/** Bulk write to a sheet by ID. */
	setSheetContent(sheetId: number, values: unknown[][]): unknown;

	/** Serialize a sheet's cells by ID. */
	getSheetSerialized(sheetId: number): unknown[][];

	/** Add rows at specific positions. */
	addRows(sheetId: number, ...indexes: [number, number][]): unknown;

	/** Check if row insertion is possible. */
	isItPossibleToAddRows(sheetId: number, ...indexes: [number, number][]): boolean;

	/** Remove rows at specific positions. */
	removeRows(sheetId: number, ...indexes: [number, number][]): unknown;

	/** Check if row removal is possible. */
	isItPossibleToRemoveRows(sheetId: number, ...indexes: [number, number][]): boolean;

	/** Reorder rows in a sheet. */
	setRowOrder(sheetId: number, newRowOrder: number[]): unknown;

	/** Check if row reordering is possible. */
	isItPossibleToSetRowOrder(sheetId: number, newRowOrder: number[]): boolean;
}
