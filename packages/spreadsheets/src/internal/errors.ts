import { TaggedError } from "./result";

export class FormulaSheetResolutionError extends TaggedError("FormulaSheetResolutionError")<{
	operation: string;
	formulaName: string;
	message: string;
	cause?: unknown;
}>() {}

export class FormulaEngineSubscriptionError extends TaggedError("FormulaEngineSubscriptionError")<{
	operation: "subscribe" | "unsubscribe";
	formulaName: string;
	message: string;
	cause?: unknown;
}>() {}

export class FormulaEngineSyncError extends TaggedError("FormulaEngineSyncError")<{
	operation: "syncAll";
	formulaName: string;
	sheetId: number;
	message: string;
	cause?: unknown;
}>() {}

export class FormulaCellUpdateError extends TaggedError("FormulaCellUpdateError")<{
	operation: "setCell";
	formulaName: string;
	sheetId: number;
	row: number;
	col: number;
	message: string;
	cause?: unknown;
}>() {}

export class FormulaDisplayValueError extends TaggedError("FormulaDisplayValueError")<{
	operation: "getDisplayValue";
	formulaName: string;
	sheetId: number;
	row: number;
	col: number;
	message: string;
	cause?: unknown;
}>() {}

export class FormulaRowOrderError extends TaggedError("FormulaRowOrderError")<{
	operation: "setRowOrder";
	formulaName: string;
	sheetId: number;
	indexOrder: number[];
	message: string;
	cause?: unknown;
}>() {}

export class WorkbookSheetNotRegisteredError extends TaggedError("WorkbookSheetNotRegisteredError")<{
	sheetKey: string;
	message: string;
}>() {}

export class WorkbookBindingMismatchError extends TaggedError("WorkbookBindingMismatchError")<{
	sheetKey: string;
	expectedFormulaName: string;
	receivedFormulaName: string;
	message: string;
}>() {}

export class WorkbookDuplicateFormulaNameError extends TaggedError("WorkbookDuplicateFormulaNameError")<{
	sheetKey: string;
	formulaName: string;
	existingSheetKey: string;
	message: string;
}>() {}

export class WorkbookSnapshotBuildError extends TaggedError("WorkbookSnapshotBuildError")<{
	sheetKey: string;
	sheetId: number;
	message: string;
	cause?: unknown;
}>() {}

export class WorkbookSnapshotRestoreError extends TaggedError("WorkbookSnapshotRestoreError")<{
	sheetKey: string;
	sheetId: number;
	message: string;
	cause?: unknown;
}>() {}

export class WorkbookReferenceInsertError extends TaggedError("WorkbookReferenceInsertError")<{
	operation: string;
	sourceSheetKey: string;
	targetSheetKey: string;
	message: string;
	cause?: unknown;
}>() {}

export class WorkbookStructuralOperationError extends TaggedError("WorkbookStructuralOperationError")<{
	operation: string;
	sheetKey?: string;
	formulaName?: string;
	sheetId?: number;
	atIndex?: number;
	count?: number;
	indexOrder?: number[];
	message: string;
	cause?: unknown;
}>() {}

export class WorkbookHistoryError extends TaggedError("WorkbookHistoryError")<{
	operation: "undo" | "redo";
	message: string;
	cause?: unknown;
}>() {}

export type FormulaBridgeError =
	| FormulaSheetResolutionError
	| FormulaEngineSubscriptionError
	| FormulaEngineSyncError
	| FormulaCellUpdateError
	| FormulaDisplayValueError
	| FormulaRowOrderError;

export type WorkbookCoordinatorError =
	| WorkbookSheetNotRegisteredError
	| WorkbookBindingMismatchError
	| WorkbookDuplicateFormulaNameError
	| WorkbookSnapshotBuildError
	| WorkbookSnapshotRestoreError
	| WorkbookReferenceInsertError
	| WorkbookStructuralOperationError
	| WorkbookHistoryError;
