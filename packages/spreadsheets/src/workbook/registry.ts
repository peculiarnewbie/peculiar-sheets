import type { CellValue, SheetController } from "../types";
import type {
	WorkbookSheetDefinition,
} from "./types";
import type { FormulaSheetId } from "../core/brands";
import type { FormulaEngine } from "./formula-engine";
import {
	WorkbookDuplicateFormulaNameError,
	WorkbookSheetNotRegisteredError,
	WorkbookStructuralOperationError,
	type WorkbookCoordinatorError,
} from "../internal/errors";
import {
	Result,
	getErrorMessage,
	type ResultLike,
} from "../internal/result";
import { errorTraceContext, withTraceContext } from "../internal/trace";
import { formulaSheetId } from "../core/brands";

// ── Types ───────────────────────────────────────────────────────────────────

export interface WorkbookSheetRuntime {
	sheetKey: string;
	formulaName: string;
	sheetId: FormulaSheetId;
	controller: SheetController | null;
	getCells: (() => CellValue[][]) | null;
	lastKnownCells: CellValue[][];
	/** False until engine content is known to match lastKnownCells. */
	engineContentConfirmed: boolean;
}

export type RuntimeResult = ResultLike<WorkbookSheetRuntime, WorkbookCoordinatorError>;

export interface SheetRegistry {
	bindSheet(definition: WorkbookSheetDefinition, coordinator: unknown): { coordinator: unknown; sheetKey: string; formulaName: string };
	getController(sheetKey: string): SheetController | null;
	tryGetSheetRuntime(sheetKey: string): RuntimeResult;
	getSheetRuntime(sheetKey: string): WorkbookSheetRuntime;
	iterSheetRuntimes(): IterableIterator<WorkbookSheetRuntime>;
	attachController(sheetKey: string, controller: SheetController): void;
	detachController(sheetKey: string, controller: SheetController): void;
	attachDataGetter(sheetKey: string, getCells: () => CellValue[][]): void;
	detachDataGetter(sheetKey: string, getCells: () => CellValue[][]): void;
	/** Mark that HyperFormula may no longer match lastKnownCells (e.g. after formula-bridge writes). */
	markEngineContentUnconfirmed(sheetKey: string): void;
}

// ── Utilities ───────────────────────────────────────────────────────────────

function cloneCells(cells: CellValue[][]): CellValue[][] {
	return cells.map((row) => [...row]);
}

// ── Factory ─────────────────────────────────────────────────────────────────

export function createSheetRegistry(
	engine: FormulaEngine,
): SheetRegistry {
	const sheets = new Map<string, WorkbookSheetRuntime>();
	const sheetKeysByFormulaName = new Map<string, string>();

	// Ensure a sheet exists in the formula engine (getById or create).
	function tryEnsureSheetId(formulaName: string): ResultLike<FormulaSheetId, WorkbookCoordinatorError> {
		const trace = withTraceContext({
			module: "workbook-coordinator",
			operation: "ensureSheetId",
			phase: "binding",
			context: { formulaName },
		});
		trace.start();

		const existingIdResult = Result.try({
			try: () => engine.findSheetId(formulaName),
			catch: (cause) => new WorkbookStructuralOperationError({
				operation: "getSheetId",
				formulaName,
				message: getErrorMessage(cause),
				cause,
			}),
		});
		if (Result.isError(existingIdResult)) {
			trace.err(errorTraceContext(existingIdResult.error));
			return existingIdResult;
		}
		if (existingIdResult.value !== undefined) {
			trace.ok({ sheetId: existingIdResult.value });
			return Result.ok(formulaSheetId(existingIdResult.value));
		}

		const addedNameResult = Result.try({
			try: () => engine.createSheet(formulaName),
			catch: (cause) => new WorkbookStructuralOperationError({
				operation: "addSheet",
				formulaName,
				message: getErrorMessage(cause),
				cause,
			}),
		});
		if (Result.isError(addedNameResult)) {
			trace.err(errorTraceContext(addedNameResult.error));
			return addedNameResult;
		}

		const addedIdResult = Result.try({
			try: () => addedNameResult.value.id,
			catch: (cause) => new WorkbookStructuralOperationError({
				operation: "getAddedSheetId",
				formulaName,
				message: getErrorMessage(cause),
				cause,
			}),
		});
		if (Result.isError(addedIdResult)) {
			trace.err(errorTraceContext(addedIdResult.error));
			return addedIdResult;
		}
		if (addedIdResult.value === undefined) {
			const error = new WorkbookStructuralOperationError({
				operation: "ensureSheetId",
				formulaName,
				message: `Failed to create workbook sheet "${formulaName}".`,
			});
			trace.err(errorTraceContext(error));
			return Result.err(error);
		}

		trace.ok({ sheetId: addedIdResult.value });
		return Result.ok(formulaSheetId(addedIdResult.value));
	}

	return {
		bindSheet(definition, coordinator) {
			const trace = withTraceContext({
				module: "workbook-coordinator",
				operation: "bindSheet",
				phase: "binding",
				context: { sheetKey: definition.sheetKey, formulaName: definition.formulaName },
			});
			trace.start();

			const existing = sheets.get(definition.sheetKey);
			if (existing) {
				if (existing.formulaName !== definition.formulaName) {
					throw new Error(
						`Workbook sheet "${definition.sheetKey}" is already bound to formula name "${existing.formulaName}".`,
					);
				}
				trace.ok({ reused: true, sheetId: existing.sheetId });
				return {
					coordinator,
					sheetKey: definition.sheetKey,
					formulaName: definition.formulaName,
				};
			}

			const duplicateByName = sheetKeysByFormulaName.get(definition.formulaName);
			if (duplicateByName && duplicateByName !== definition.sheetKey) {
				throw new WorkbookDuplicateFormulaNameError({
					sheetKey: definition.sheetKey,
					formulaName: definition.formulaName,
					existingSheetKey: duplicateByName,
					message: `Workbook formula name "${definition.formulaName}" is already used by sheet "${duplicateByName}".`,
				});
			}

			const sheetIdResult = tryEnsureSheetId(definition.formulaName);
			if (Result.isError(sheetIdResult)) {
				throw new Error(sheetIdResult.error.message);
			}

			sheets.set(definition.sheetKey, {
				sheetKey: definition.sheetKey,
				formulaName: definition.formulaName,
				sheetId: sheetIdResult.value,
				controller: null,
				getCells: null,
				lastKnownCells: [],
				engineContentConfirmed: false,
			});
			sheetKeysByFormulaName.set(definition.formulaName, definition.sheetKey);
			trace.ok({ sheetId: sheetIdResult.value });

			return {
				coordinator,
				sheetKey: definition.sheetKey,
				formulaName: definition.formulaName,
			};
		},

		getController(sheetKey) {
			return sheets.get(sheetKey)?.controller ?? null;
		},

		getSheetRuntime(sheetKey) {
			const runtime = sheets.get(sheetKey);
			if (!runtime) {
				throw new Error(`Workbook sheet "${sheetKey}" is not registered.`);
			}
			return runtime;
		},

		tryGetSheetRuntime(sheetKey) {
			const runtime = sheets.get(sheetKey);
			if (!runtime) {
				return Result.err(new WorkbookSheetNotRegisteredError({
					sheetKey,
					message: `Workbook sheet "${sheetKey}" is not registered.`,
				}));
			}
			return Result.ok(runtime);
		},

		iterSheetRuntimes() {
			return sheets.values();
		},

		attachController(sheetKey, controller) {
			this.getSheetRuntime(sheetKey).controller = controller;
		},

		detachController(sheetKey, controller) {
			const runtime = this.getSheetRuntime(sheetKey);
			if (runtime.controller === controller) {
				runtime.controller = null;
			}
		},

		attachDataGetter(sheetKey, getCells) {
			const runtime = this.getSheetRuntime(sheetKey);
			runtime.getCells = getCells;
			runtime.lastKnownCells = cloneCells(getCells());
			// Host data is cached, but the engine may still be empty/stale until sync.
			runtime.engineContentConfirmed = false;
		},

		detachDataGetter(sheetKey, getCells) {
			const runtime = this.getSheetRuntime(sheetKey);
			if (runtime.getCells === getCells) {
				runtime.lastKnownCells = cloneCells(getCells());
				runtime.getCells = null;
				runtime.engineContentConfirmed = false;
			}
		},

		markEngineContentUnconfirmed(sheetKey) {
			this.getSheetRuntime(sheetKey).engineContentConfirmed = false;
		},
	};
}
