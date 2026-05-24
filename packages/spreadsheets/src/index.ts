export { Sheet } from "./Sheet";
export { createWorkbookCoordinator } from "./workbook/coordinator";
export type { HyperFormulaWorkbookLike } from "./workbook/hf-interface";
export type { WorkbookSheetRuntime } from "./workbook/registry";
export {
	addressToA1,
	columnIndexToLetters,
	isFormulaValue,
	lettersToColumnIndex,
	parseA1Address,
	rangeToA1,
	shiftFormulaByDelta,
} from "./formula/references";
export { createRangeStyles } from "./rangeStyles";
export { Result, isApplied, isNoop } from "./internal/result";
export {
	isCellValue,
	isCellMatrix,
	normalizeCellValue,
	normalizeCellMatrix,
} from "./core/validators";
export {
	DEFAULT_COL_WIDTH,
	DEFAULT_ROW_HEIGHT,
	HEADER_HEIGHT,
} from "./types";

export type {
	CellAddress,
	CellContext,
	CellMutation,
	CellRange,
	CellRenderContext,
	CellStyle,
	CellValue,
	ClipboardPayload,
	ColumnDef,
	EditModeState,
	FormulaEngineConfig,
	ParseValueContext,
	PhysicalCellAddress,
	RowReorderMutation,
	ResizeMode,
	ResizeSessionState,
	ScrollPosition,
	Selection,
	SheetController,
	SheetCustomization,
	SheetOperation,
	SheetSizingState,
	SheetProps,
	SortBehavior,
	SortDirection,
	SortState,
	VisualCellAddress,
} from "./types";

export type { RangeStyleRule, StyleTarget } from "./rangeStyles";
export type {
	AppliedOutcome,
	NoopOutcome,
	OperationOutcome,
	ResultLike,
} from "./internal/result";
export type { WorkbookCoordinatorError } from "./internal/errors";
export {
	FormulaSheetResolutionError,
	FormulaEngineSubscriptionError,
	FormulaEngineSyncError,
	FormulaCellUpdateError,
	FormulaDisplayValueError,
	FormulaRowOrderError,
	WorkbookSheetNotRegisteredError,
	WorkbookBindingMismatchError,
	WorkbookDuplicateFormulaNameError,
	WorkbookSnapshotBuildError,
	WorkbookSnapshotRestoreError,
	WorkbookReferenceInsertError,
	WorkbookStructuralOperationError,
	WorkbookHistoryError,
} from "./internal/errors";

export type {
	Brand,
	ColumnIndex,
	FormulaSheetId,
	PhysicalRowIndex,
	RowId,
	VisualRowIndex,
} from "./core/brands";
export {
	columnIdx,
	formulaSheetId,
	physicalRow,
	rowId,
	toNumber,
	visualRow,
} from "./core/brands";

export type {
	WorkbookCoordinator,
	WorkbookCoordinatorOptions,
	WorkbookHistoryNoopReason,
	WorkbookHistoryResult,
	WorkbookReferenceNoopReason,
	WorkbookReferenceResult,
	WorkbookSheetBinding,
	WorkbookSheetDefinition,
	WorkbookStructuralNoopReason,
	WorkbookStructuralChange,
	WorkbookStructuralOrigin,
	WorkbookStructuralResult,
} from "./workbook/types";
