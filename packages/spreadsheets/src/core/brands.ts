export type Brand<T, B extends string> = T & { readonly __brand__: B };

export type PhysicalRowIndex = Brand<number, "PhysicalRowIndex">;
export type VisualRowIndex = Brand<number, "VisualRowIndex">;
export type ColumnIndex = Brand<number, "ColumnIndex">;
/** Stable row identity — host domain keys (e.g. DataTable row names) or auto-generated indices (`"0"`, `"1"`, …). */
export type RowId = Brand<string, "RowId">;
export type FormulaSheetId = Brand<number, "FormulaSheetId">;

export const physicalRow = (n: number): PhysicalRowIndex => n as PhysicalRowIndex;
export const visualRow = (n: number): VisualRowIndex => n as VisualRowIndex;
export const columnIdx = (n: number): ColumnIndex => n as ColumnIndex;
export const rowId = (key: string): RowId => key as RowId;
export const formulaSheetId = (n: number): FormulaSheetId => n as FormulaSheetId;

export const toNumber = (b: number): number => b;

/** Auto-generated row id for index `n` when the host does not supply `rowIds`. */
export const autoRowId = (index: number): RowId => rowId(String(index));
