import type { CellRange, CellValue, SheetController } from "../types";
import type { PhysicalRowIndex } from "../core/brands";
import type { WorkbookCoordinatorError } from "../internal/errors";
import type { OperationOutcome, ResultLike } from "../internal/result";

export interface WorkbookCoordinatorOptions {
	/** FormulaEngine adapter or a legacy direct HyperFormula instance. */
	engine: unknown;
}

export interface WorkbookSheetDefinition {
	sheetKey: string;
	formulaName: string;
}

export interface WorkbookSheetBinding {
	coordinator: WorkbookCoordinator;
	sheetKey: string;
	formulaName: string;
}

export type WorkbookStructuralOrigin =
	| { type: "insertRows"; sheetKey: string; atIndex: PhysicalRowIndex; count: number }
	| { type: "deleteRows"; sheetKey: string; atIndex: PhysicalRowIndex; count: number }
	| { type: "setRowOrder"; sheetKey: string; indexOrder: PhysicalRowIndex[] }
	| { type: "undo" }
	| { type: "redo" };

export interface WorkbookStructuralChange {
	origin: WorkbookStructuralOrigin;
	snapshots: Array<{
		sheetKey: string;
		cells: CellValue[][];
	}>;
}

export type WorkbookStructuralNoopReason = "invalid-count" | "engine-rejected";
export type WorkbookReferenceNoopReason = "missing-controller" | "reference-unavailable";
export type WorkbookHistoryNoopReason = "history-empty";

export type WorkbookStructuralResult = ResultLike<
	OperationOutcome<WorkbookStructuralChange, WorkbookStructuralNoopReason>,
	WorkbookCoordinatorError
>;
export type WorkbookReferenceResult = ResultLike<
	OperationOutcome<boolean, WorkbookReferenceNoopReason>,
	WorkbookCoordinatorError
>;
export type WorkbookHistoryResult = ResultLike<
	OperationOutcome<WorkbookStructuralChange, WorkbookHistoryNoopReason>,
	WorkbookCoordinatorError
>;

export interface WorkbookCoordinator {
	bindSheet(definition: WorkbookSheetDefinition): WorkbookSheetBinding;
	subscribe(listener: (change: WorkbookStructuralChange) => void): () => void;

	getController(sheetKey: string): SheetController | null;

	insertReference(sourceSheetKey: string, targetSheetKey: string, range: CellRange): WorkbookReferenceResult;
	setReferenceHighlight(sheetKey: string, range: CellRange | null): void;
	clearReferenceHighlights(): void;

	insertRows(sheetKey: string, atIndex: PhysicalRowIndex, count: number): WorkbookStructuralResult;
	deleteRows(sheetKey: string, atIndex: PhysicalRowIndex, count: number): WorkbookStructuralResult;
	setRowOrder(sheetKey: string, indexOrder: PhysicalRowIndex[]): WorkbookStructuralResult;

	undo(): WorkbookHistoryResult;
	redo(): WorkbookHistoryResult;
	canUndo(): boolean;
	canRedo(): boolean;
}
