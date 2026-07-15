import type { CellRange, CellValue, EditModeState, FormulaEngineConfig, SheetController, VisualCellAddress } from "../types";
import type {
	WorkbookCoordinator,
	WorkbookCoordinatorOptions,
	WorkbookReferenceResult,
	WorkbookSheetBinding,
	WorkbookStructuralOrigin,
	WorkbookStructuralResult,
} from "./types";
import type { HyperFormulaWorkbookLike } from "./hf-interface";
import {
	WorkbookBindingMismatchError,
	WorkbookReferenceInsertError,
} from "../internal/errors";
import {
	Result,
	applied,
	getErrorMessage,
	isApplied,
	noop,
} from "../internal/result";
import { errorTraceContext, withTraceContext } from "../internal/trace";
import { toNumber } from "../core/brands";
import { normalizeRange } from "../core/selection";
import { addressToA1 } from "../formula/references";

import { createSheetRegistry, type SheetRegistry } from "./registry";
import { createStructuralEngine } from "./structural-engine";
import { createHistoryManager } from "./history";
import { createReferenceSession } from "./references";

// ── Registry access helper ──────────────────────────────────────────────────

function registryAccess(registry: SheetRegistry) {
	return {
		iterSheetRuntimes: () => registry.iterSheetRuntimes(),
		tryGetSheetRuntime: (k: string) => registry.tryGetSheetRuntime(k),
	};
}

// ── Symbol for internal access ──────────────────────────────────────────────

export interface WorkbookCoordinatorInternals {
	getFormulaEngineConfig(binding: WorkbookSheetBinding): FormulaEngineConfig;
	attachController(sheetKey: string, controller: SheetController): void;
	detachController(sheetKey: string, controller: SheetController): void;
	attachDataGetter(sheetKey: string, getCells: () => CellValue[][]): void;
	detachDataGetter(sheetKey: string, getCells: () => CellValue[][]): void;
	markEngineContentUnconfirmed(sheetKey: string): void;
	getLastKnownCells(sheetKey: string): CellValue[][];
	peekHistoryEntries(): ReadonlyArray<{
		beforeSheetKeys: string[];
		afterSheetKeys: string[];
		beforeCellCount: number;
		afterCellCount: number;
	}>;
	handleCellPointerDown(sheetKey: string, address: VisualCellAddress, event: MouseEvent): boolean;
	handleCellPointerMove(sheetKey: string, address: VisualCellAddress, event: MouseEvent): boolean;
	handleEditModeChange(sheetKey: string, state: EditModeState | null): void;
}

export const workbookCoordinatorInternals = Symbol("workbookCoordinatorInternals");

type WorkbookCoordinatorWithInternals = WorkbookCoordinator & {
	[workbookCoordinatorInternals]: WorkbookCoordinatorInternals;
};

export function getWorkbookCoordinatorInternals(
	coordinator: WorkbookCoordinator,
): WorkbookCoordinatorInternals {
	return (coordinator as WorkbookCoordinatorWithInternals)[workbookCoordinatorInternals];
}

// ── Utilities ───────────────────────────────────────────────────────────────

function formatReferenceText(referenceText: string, range: CellRange): string {
	if (range.start.row !== range.end.row || range.start.col !== range.end.col) {
		return referenceText;
	}
	const cellRef = addressToA1(range.start);
	if (referenceText === `${cellRef}:${cellRef}`) return cellRef;
	if (referenceText.endsWith(`!${cellRef}:${cellRef}`)) {
		return referenceText.slice(0, -(`:${cellRef}`).length);
	}
	return referenceText;
}

function toPublicReferenceResult(result: WorkbookReferenceResult): boolean {
	return Result.isOk(result) && isApplied(result.value);
}

// ── Factory ─────────────────────────────────────────────────────────────────

export function createWorkbookCoordinator(
	options: WorkbookCoordinatorOptions,
): WorkbookCoordinator {
	const hf = options.engine as HyperFormulaWorkbookLike;

	const registry = createSheetRegistry(hf);
	const structural = createStructuralEngine(hf);
	const history = createHistoryManager();
	const references = createReferenceSession();

	const access = registryAccess(registry);

	let cleanupReferenceSession: (() => void) | null = null;

	function clearReferenceHighlights() {
		references.clearReferenceHighlights(access);
		cleanupReferenceSession?.();
	}

	function installReferenceSessionCleanup() {
		if (cleanupReferenceSession || typeof document === "undefined") return;
		const handleMouseUp = () => {
			if (references.currentSession?.didDrag) {
				clearReferenceHighlights();
			}
			references.currentSession = null;
		};
		document.addEventListener("mouseup", handleMouseUp);
		cleanupReferenceSession = () => {
			document.removeEventListener("mouseup", handleMouseUp);
			cleanupReferenceSession = null;
		};
	}

	function tryInsertReference(
		sourceSheetKey: string,
		targetSheetKey: string,
		range: CellRange,
	): WorkbookReferenceResult {
		const trace = withTraceContext({
			module: "workbook-coordinator",
			operation: "insertReference",
			phase: "reference",
			context: { sourceSheetKey, targetSheetKey },
		});
		trace.start();

		const result = Result.gen(function* () {
			const source = yield* access.tryGetSheetRuntime(sourceSheetKey);
			const target = yield* access.tryGetSheetRuntime(targetSheetKey);
			const sourceController = source.controller;
			const targetController = target.controller;
			const currentSession = references.currentSession;
			const isActiveReferenceSession =
				currentSession?.sourceSheetKey === sourceSheetKey &&
				currentSession?.targetSheetKey === targetSheetKey;

			if (!sourceController || !targetController) {
				return Result.ok(noop("missing-controller"));
			}
			if (!sourceController.canInsertReference() && !isActiveReferenceSession) {
				return Result.ok(noop("missing-controller"));
			}

			const normalized = normalizeRange(range);
			const sheetRange = {
				start: { ...normalized.start, sheet: target.sheetId },
				end: { ...normalized.end, sheet: target.sheetId },
			};
			const referenceResult = Result.try({
				try: () => hf.simpleCellRangeToString(sheetRange, source.sheetId),
				catch: (cause) => new WorkbookReferenceInsertError({
					operation: "simpleCellRangeToString",
					sourceSheetKey,
					targetSheetKey,
					message: getErrorMessage(cause),
					cause,
				}),
			});
			if (Result.isError(referenceResult)) return referenceResult;
			if (!referenceResult.value) {
				return Result.ok(noop("reference-unavailable"));
			}

			const referenceText = formatReferenceText(referenceResult.value, normalized);
			const applyReferenceResult = Result.try({
				try: () => {
					sourceController.insertReferenceText(referenceText);
					targetController.setReferenceHighlight(normalized);
				},
				catch: (cause) => new WorkbookReferenceInsertError({
					operation: "applyReference",
					sourceSheetKey,
					targetSheetKey,
					message: getErrorMessage(cause),
					cause,
				}),
			});
			if (Result.isError(applyReferenceResult)) return applyReferenceResult;

			return Result.ok(applied(true));
		});

		if (Result.isError(result)) {
			trace.err(errorTraceContext(result.error));
			return result;
		}
		if (!isApplied(result.value)) {
			trace.noop({ reason: result.value.reason });
			return result;
		}

		trace.ok();
		return result;
	}

	const internals: WorkbookCoordinatorInternals = {
		getFormulaEngineConfig(binding) {
			const runtime = registry.getSheetRuntime(binding.sheetKey);
			if (runtime.formulaName !== binding.formulaName) {
				throw new WorkbookBindingMismatchError({
					sheetKey: binding.sheetKey,
					expectedFormulaName: runtime.formulaName,
					receivedFormulaName: binding.formulaName,
					message: `Workbook binding mismatch for "${binding.sheetKey}": expected formula name "${runtime.formulaName}", received "${binding.formulaName}".`,
				});
			}
			return {
				instance: hf,
				sheetId: runtime.sheetId,
				sheetName: runtime.formulaName,
				onEngineContentChanged: () => registry.markEngineContentUnconfirmed(binding.sheetKey),
			};
		},

		attachController(sheetKey, controller) {
			registry.attachController(sheetKey, controller);
			withTraceContext({
				module: "workbook-coordinator",
				operation: "attachController",
				phase: "lifecycle",
				context: { sheetKey },
			}).ok();
		},

		detachController(sheetKey, controller) {
			registry.detachController(sheetKey, controller);
			const currentSession = references.currentSession;
			if (currentSession?.sourceSheetKey === sheetKey || currentSession?.targetSheetKey === sheetKey) {
				clearReferenceHighlights();
			}
			withTraceContext({
				module: "workbook-coordinator",
				operation: "detachController",
				phase: "lifecycle",
				context: { sheetKey },
			}).ok();
		},

		attachDataGetter(sheetKey, getCells) {
			registry.attachDataGetter(sheetKey, getCells);
		},

		detachDataGetter(sheetKey, getCells) {
			registry.detachDataGetter(sheetKey, getCells);
		},

		markEngineContentUnconfirmed(sheetKey) {
			registry.markEngineContentUnconfirmed(sheetKey);
		},

		getLastKnownCells(sheetKey) {
			return registry.getSheetRuntime(sheetKey).lastKnownCells.map((row) => [...row]);
		},

		peekHistoryEntries() {
			return history.peekEntries().map((entry) => ({
				beforeSheetKeys: entry.before.map((snapshot) => snapshot.sheetKey),
				afterSheetKeys: entry.after.map((snapshot) => snapshot.sheetKey),
				beforeCellCount: entry.before.reduce(
					(total, snapshot) => total + snapshot.cells.reduce((rowTotal, row) => rowTotal + row.length, 0),
					0,
				),
				afterCellCount: entry.after.reduce(
					(total, snapshot) => total + snapshot.cells.reduce((rowTotal, row) => rowTotal + row.length, 0),
					0,
				),
			}));
		},

		handleCellPointerDown(sheetKey, address, event) {
			if (event.button === 2) return false;
			const source = references.findActiveReferenceSource(sheetKey, access);
			if (!source) return false;
			event.preventDefault();
			event.stopPropagation();
			const inserted = tryInsertReference(source.sheetKey, sheetKey, {
				start: address,
				end: address,
			});
			if (!toPublicReferenceResult(inserted)) return false;
			references.currentSession = {
				sourceSheetKey: source.sheetKey,
				targetSheetKey: sheetKey,
				anchor: address,
				didDrag: false,
			};
			installReferenceSessionCleanup();
			return true;
		},

		handleCellPointerMove(sheetKey, address, event) {
			const currentSession = references.currentSession;
			if (!currentSession || currentSession.targetSheetKey !== sheetKey) return false;
			if ((event.buttons & 1) === 0) return false;
			const { sourceSheetKey, anchor } = currentSession;
			const inserted = tryInsertReference(sourceSheetKey, sheetKey, {
				start: anchor,
				end: address,
			});
			if (toPublicReferenceResult(inserted)) {
				references.currentSession = { ...currentSession, didDrag: true };
				return true;
			}
			return false;
		},

		handleEditModeChange(sheetKey, state) {
			if (!state) {
				clearReferenceHighlights();
				const currentSession = references.currentSession;
				if (currentSession?.sourceSheetKey === sheetKey) {
					references.currentSession = null;
				}
			}
		},
	};

	// Wires structural operations to history recording
	function applyStructuralOp(
		origin: WorkbookStructuralOrigin,
		engineApply: () => void,
	): WorkbookStructuralResult {
		return structural.tryApplyStructuralOperation(
			origin,
			engineApply,
			(entry) => history.pushHistoryEntry(entry),
			access,
		);
	}

	const coordinator: WorkbookCoordinatorWithInternals = {
		bindSheet(definition) {
			const binding = registry.bindSheet(definition, coordinator);
			return {
				coordinator: binding.coordinator as WorkbookCoordinator,
				sheetKey: binding.sheetKey,
				formulaName: binding.formulaName,
			};
		},

		subscribe(listener) {
			return structural.subscribe(listener);
		},

		getController(sheetKey) {
			return registry.getController(sheetKey);
		},

		insertReference(sourceSheetKey, targetSheetKey, range) {
			return tryInsertReference(sourceSheetKey, targetSheetKey, range);
		},

		setReferenceHighlight(sheetKey, range) {
			references.setReferenceHighlight(sheetKey, range, access);
		},

		clearReferenceHighlights,

		insertRows(sheetKey, atIndex, count) {
			if (count <= 0) {
				withTraceContext({
					module: "workbook-coordinator",
					operation: "insertRows",
					phase: "structural",
					context: { sheetKey, atIndex, count },
				}).noop({ reason: "invalid-count" });
				return Result.ok(noop("invalid-count"));
			}
			return applyStructuralOp(
				{ type: "insertRows", sheetKey, atIndex, count },
				() => { hf.addRows(toNumber(registry.getSheetRuntime(sheetKey).sheetId), [toNumber(atIndex), count]); },
			);
		},

		deleteRows(sheetKey, atIndex, count) {
			if (count <= 0) {
				withTraceContext({
					module: "workbook-coordinator",
					operation: "deleteRows",
					phase: "structural",
					context: { sheetKey, atIndex, count },
				}).noop({ reason: "invalid-count" });
				return Result.ok(noop("invalid-count"));
			}
			return applyStructuralOp(
				{ type: "deleteRows", sheetKey, atIndex, count },
				() => { hf.removeRows(toNumber(registry.getSheetRuntime(sheetKey).sheetId), [toNumber(atIndex), count]); },
			);
		},

		setRowOrder(sheetKey, indexOrder) {
			return applyStructuralOp(
				{ type: "setRowOrder", sheetKey, indexOrder: [...indexOrder] },
				() => { hf.setRowOrder(toNumber(registry.getSheetRuntime(sheetKey).sheetId), indexOrder.map(toNumber)); },
			);
		},

		undo() {
			return history.undo((origin, snapshots) =>
				structural.tryRestoreSnapshots(origin, snapshots, access),
			);
		},

		redo() {
			return history.redo((origin, snapshots) =>
				structural.tryRestoreSnapshots(origin, snapshots, access),
			);
		},

		canUndo() {
			return history.canUndo();
		},

		canRedo() {
			return history.canRedo();
		},

		[workbookCoordinatorInternals]: internals,
	};

	return coordinator;
}

// Re-export for backward compatibility
export type {
	WorkbookCoordinator,
	WorkbookCoordinatorOptions,
	WorkbookHistoryResult,
	WorkbookReferenceResult,
	WorkbookSheetBinding,
	WorkbookStructuralChange,
	WorkbookStructuralOrigin,
	WorkbookStructuralResult,
} from "./types";
export type {
	WorkbookSheetRuntime,
} from "./registry";
export type {
	HyperFormulaWorkbookLike,
} from "./hf-interface";
