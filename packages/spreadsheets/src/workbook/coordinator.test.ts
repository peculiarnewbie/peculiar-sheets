import { afterEach, describe, expect, it } from "bun:test";
import * as HyperFormulaNS from "hyperformula";
import type { CellRange, CellValue, SheetController } from "../types";
import { columnIdx, physicalRow } from "../core/brands";
import { createFormulaBridge } from "../formula/bridge";
import { setInternalTraceSink, type InternalTraceEvent } from "../internal/trace";
import { Result, isApplied, isNoop, type OperationOutcome, type ResultLike } from "../internal/result";
import { createWorkbookCoordinator, getWorkbookCoordinatorInternals } from "./coordinator";

const HyperFormula = HyperFormulaNS.HyperFormula ?? HyperFormulaNS.default;

function createStubController(
	overrides: Partial<SheetController> = {},
): SheetController {
	return {
		getSelection: () => ({
			ranges: [],
			anchor: { row: 0, col: 0 },
			focus: { row: 0, col: 0 },
			editing: null,
		}),
		setSelection: () => {},
		clearSelection: () => {},
		scrollToCell: () => {},
		startEditing: () => {},
		stopEditing: () => {},
		getRawCellValue: () => null,
		getDisplayCellValue: () => null,
		getEditorText: () => null,
		canInsertReference: () => false,
		insertReferenceText: () => {},
		setReferenceHighlight: () => {},
		setActiveEditorValue: () => {},
		commitActiveEditor: () => {},
		cancelActiveEditor: () => {},
		getCellValue: () => null,
		setCellValue: () => {},
		insertRows: () => {},
		deleteRows: () => {},
		getColumnMeta: () => undefined,
		undo: () => {},
		redo: () => {},
		canUndo: () => false,
		canRedo: () => false,
		getCanvasElement: () => null,
		...overrides,
	};
}

function expectAppliedResult<T, Reason extends string, Error>(
	result: ResultLike<OperationOutcome<T, Reason>, Error>,
): T {
	expect(Result.isOk(result)).toBe(true);
	if (!Result.isOk(result) || !isApplied(result.value)) {
		throw new Error("Expected applied Result");
	}
	return result.value.value;
}

function expectNoopResult<T, Reason extends string, Error>(
	result: ResultLike<OperationOutcome<T, Reason>, Error>,
	reason: Reason,
) {
	expect(Result.isOk(result)).toBe(true);
	if (!Result.isOk(result) || !isNoop(result.value)) {
		throw new Error("Expected noop Result");
	}
	expect(result.value.reason).toBe(reason);
}

describe("workbook coordinator", () => {
	let traceEvents: InternalTraceEvent[] = [];
	let resetTraceSink: (() => void) | null = null;

	afterEach(() => {
		traceEvents = [];
		resetTraceSink?.();
		resetTraceSink = null;
	});

	it("binds sheets once and reuses the same sheet ids", () => {
		const coordinator = createWorkbookCoordinator({
			engine: HyperFormula.buildEmpty({ licenseKey: "gpl-v3" }),
		});

		const first = coordinator.bindSheet({ sheetKey: "data", formulaName: "Data" });
		const second = coordinator.bindSheet({ sheetKey: "data", formulaName: "Data" });
		const internals = getWorkbookCoordinatorInternals(coordinator);

		expect(first.sheetKey).toBe("data");
		expect(second.formulaName).toBe("Data");
		expect(internals.getFormulaEngineConfig(first).sheetId).toBe(
			internals.getFormulaEngineConfig(second).sheetId,
		);
	});

	it("rejects duplicate formula names across different sheet keys", () => {
		const coordinator = createWorkbookCoordinator({
			engine: HyperFormula.buildEmpty({ licenseKey: "gpl-v3" }),
		});

		coordinator.bindSheet({ sheetKey: "data", formulaName: "Data" });

		expect(() =>
			coordinator.bindSheet({ sheetKey: "summary", formulaName: "Data" })
		).toThrow(/already used/i);
	});

	it("inserts cross-sheet references through attached controllers", () => {
		const coordinator = createWorkbookCoordinator({
			engine: HyperFormula.buildEmpty({ licenseKey: "gpl-v3" }),
		});
		const data = coordinator.bindSheet({ sheetKey: "data", formulaName: "Data" });
		const summary = coordinator.bindSheet({ sheetKey: "summary", formulaName: "Summary" });
		const internals = getWorkbookCoordinatorInternals(coordinator);
		const insertedTexts: string[] = [];
		const highlightedRanges: Array<CellRange | null> = [];

		internals.attachController(summary.sheetKey, createStubController({
			canInsertReference: () => true,
			insertReferenceText: (text) => insertedTexts.push(text),
		}));
		internals.attachController(data.sheetKey, createStubController({
			setReferenceHighlight: (range) => highlightedRanges.push(range),
		}));

		const inserted = coordinator.insertReference(summary.sheetKey, data.sheetKey, {
			start: { row: 0, col: 0 },
			end: { row: 1, col: 0 },
		});

		expectAppliedResult(inserted);
		expect(insertedTexts).toEqual(["Data!A1:A2"]);
		expect(highlightedRanges).toEqual([{
			start: { row: 0, col: 0 },
			end: { row: 1, col: 0 },
		}]);
	});

	it("emits workbook snapshots for insert, delete, and undo/redo", () => {
		const hf = HyperFormula.buildEmpty({ licenseKey: "gpl-v3" });
		const coordinator = createWorkbookCoordinator({ engine: hf });
		const data = coordinator.bindSheet({ sheetKey: "data", formulaName: "Data" });
		const summary = coordinator.bindSheet({ sheetKey: "summary", formulaName: "Summary" });
		const internals = getWorkbookCoordinatorInternals(coordinator);

		let dataCells: CellValue[][] = [["Alpha", 10], ["Beta", 20], ["Gamma", 30]];
		let summaryCells: CellValue[][] = [["Total", "=SUM(Data!B1:B3)"], ["Mid", "=Data!B2"]];

		internals.attachDataGetter(data.sheetKey, () => dataCells);
		internals.attachDataGetter(summary.sheetKey, () => summaryCells);

		const insertChange = expectAppliedResult(coordinator.insertRows(data.sheetKey, 1, 1));
		const insertData = insertChange.snapshots.find((entry) => entry.sheetKey === "data")!;
		const insertSummary = insertChange.snapshots.find((entry) => entry.sheetKey === "summary");

		// The newly inserted row must be padded to the same column count as
		// existing rows — HyperFormula serialises blank rows as [] which would
		// cause the reconciler to skip the row entirely if not padded.
		expect(insertData.cells).toHaveLength(4);
		expect(insertData.cells[1]).toEqual([null, null]); // blank inserted row
		expect(insertData.cells[2]).toEqual(["Beta", 20]); // shifted down

		expect(insertSummary?.cells[0]?.[1]).toBe("=SUM(Data!B1:B4)");
		expect(insertSummary?.cells[1]?.[1]).toBe("=Data!B3");

		dataCells = insertData.cells;
		summaryCells = insertSummary!.cells;

		const deleteChange = expectAppliedResult(coordinator.deleteRows(data.sheetKey, 1, 1));
		const deleteSummary = deleteChange.snapshots.find((entry) => entry.sheetKey === "summary");
		expect(deleteSummary?.cells[0]?.[1]).toBe("=SUM(Data!B1:B3)");
		expect(deleteSummary?.cells[1]?.[1]).toBe("=Data!B2");

		const undoChange = expectAppliedResult(coordinator.undo());
		const undoSummary = undoChange.snapshots.find((entry) => entry.sheetKey === "summary");
		expect(undoSummary?.cells[0]?.[1]).toBe("=SUM(Data!B1:B4)");

		const redoChange = expectAppliedResult(coordinator.redo());
		const redoSummary = redoChange.snapshots.find((entry) => entry.sheetKey === "summary");
		expect(redoSummary?.cells[0]?.[1]).toBe("=SUM(Data!B1:B3)");
	});

	it("reorders rows through HyperFormula and preserves dependent displays", () => {
		const hf = HyperFormula.buildEmpty({ licenseKey: "gpl-v3" });
		const coordinator = createWorkbookCoordinator({ engine: hf });
		const data = coordinator.bindSheet({ sheetKey: "data", formulaName: "Data" });
		const summary = coordinator.bindSheet({ sheetKey: "summary", formulaName: "Summary" });
		const internals = getWorkbookCoordinatorInternals(coordinator);

		const dataCells: CellValue[][] = [["Alpha", 10], ["Beta", 20], ["Gamma", 30]];
		const summaryCells: CellValue[][] = [["First", "=Data!A1"], ["Total", "=SUM(Data!B1:B3)"]];

		internals.attachDataGetter(data.sheetKey, () => dataCells);
		internals.attachDataGetter(summary.sheetKey, () => summaryCells);

		const change = expectAppliedResult(coordinator.setRowOrder(data.sheetKey, [2, 1, 0]));
		const nextData = change.snapshots.find((entry) => entry.sheetKey === "data")!.cells;
		const nextSummary = change.snapshots.find((entry) => entry.sheetKey === "summary")!.cells;

		expect(nextData[0]?.[0]).toBe("Gamma");
		expect(nextSummary[0]?.[1]).toBe("=Data!A1");
		expect(hf.getSheetValues(internals.getFormulaEngineConfig(summary).sheetId!)[0]?.[1]).toBe("Gamma");
	});

	it("returns noop Results and emits noop traces for invalid structural operations", () => {
		resetTraceSink = setInternalTraceSink((event) => traceEvents.push(event));
		const coordinator = createWorkbookCoordinator({
			engine: HyperFormula.buildEmpty({ licenseKey: "gpl-v3" }),
		});
		coordinator.bindSheet({ sheetKey: "data", formulaName: "Data" });

		expectNoopResult(coordinator.insertRows("data", 0, 0), "invalid-count");
		expect(traceEvents.some((event) =>
			event.operation === "insertRows" &&
			event.status === "noop" &&
			event.context.reason === "invalid-count"
		)).toBe(true);
	});

	it("returns noop Results and emits noop traces when no active reference source exists", () => {
		resetTraceSink = setInternalTraceSink((event) => traceEvents.push(event));
		const coordinator = createWorkbookCoordinator({
			engine: HyperFormula.buildEmpty({ licenseKey: "gpl-v3" }),
		});
		coordinator.bindSheet({ sheetKey: "data", formulaName: "Data" });
		coordinator.bindSheet({ sheetKey: "summary", formulaName: "Summary" });

		const inserted = coordinator.insertReference("summary", "data", {
			start: { row: 0, col: 0 },
			end: { row: 0, col: 0 },
		});

		expectNoopResult(inserted, "missing-controller");
		expect(traceEvents.some((event) =>
			event.operation === "insertReference" &&
			event.status === "noop" &&
			event.context.reason === "missing-controller"
		)).toBe(true);
	});

	it("emits an error trace when rollback capture fails before mutation", () => {
		const hf = HyperFormula.buildEmpty({ licenseKey: "gpl-v3" });
		resetTraceSink = setInternalTraceSink((event) => traceEvents.push(event));
		const coordinator = createWorkbookCoordinator({ engine: hf });
		coordinator.bindSheet({ sheetKey: "data", formulaName: "Data" });

		const original = hf.getSheetSerialized.bind(hf);
		hf.getSheetSerialized = (() => {
			throw new Error("snapshot build failed");
		}) as typeof hf.getSheetSerialized;

		const result = coordinator.insertRows("data", 0, 1);
		expect(Result.isError(result)).toBe(true);
		expect(traceEvents.some((event) =>
			event.operation === "captureRollbackState" &&
			event.status === "err" &&
			event.context.message === "snapshot build failed"
		)).toBe(true);

		hf.getSheetSerialized = original;
	});

	describe("atomic structural failure rollback", () => {
		type AtomicFixture = {
			hf: ReturnType<typeof HyperFormula.buildEmpty>;
			coordinator: ReturnType<typeof createWorkbookCoordinator>;
			internals: ReturnType<typeof getWorkbookCoordinatorInternals>;
			dataSheetId: number;
			summarySheetId: number;
			dataCells: CellValue[][];
			summaryCells: CellValue[][];
			baselineSerialized: Record<string, CellValue[][]>;
			baselineLastKnown: Record<string, CellValue[][]>;
			changes: unknown[];
			unsubscribe: () => void;
		};

		function createAtomicFixture(): AtomicFixture {
			const hf = HyperFormula.buildEmpty({ licenseKey: "gpl-v3" });
			const coordinator = createWorkbookCoordinator({ engine: hf });
			const data = coordinator.bindSheet({ sheetKey: "data", formulaName: "Data" });
			const summary = coordinator.bindSheet({ sheetKey: "summary", formulaName: "Summary" });
			const internals = getWorkbookCoordinatorInternals(coordinator);

			const dataCells: CellValue[][] = [["Alpha", 10], ["Beta", 20], ["Gamma", 30]];
			const summaryCells: CellValue[][] = [["Total", "=SUM(Data!B1:B3)"], ["Mid", "=Data!B2"]];
			internals.attachDataGetter(data.sheetKey, () => dataCells);
			internals.attachDataGetter(summary.sheetKey, () => summaryCells);

			// Seed engine + caches through a successful structural no-op path's sync by inserting then undoing.
			expectAppliedResult(coordinator.insertRows(data.sheetKey, 1, 1));
			expectAppliedResult(coordinator.undo());

			const dataSheetId = internals.getFormulaEngineConfig(data).sheetId!;
			const summarySheetId = internals.getFormulaEngineConfig(summary).sheetId!;
			const baselineSerialized = {
				data: structuredClone(hf.getSheetSerialized(dataSheetId)) as CellValue[][],
				summary: structuredClone(hf.getSheetSerialized(summarySheetId)) as CellValue[][],
			};
			const baselineLastKnown = {
				data: internals.getLastKnownCells("data"),
				summary: internals.getLastKnownCells("summary"),
			};

			const changes: unknown[] = [];
			const unsubscribe = coordinator.subscribe((change) => changes.push(change));

			return {
				hf,
				coordinator,
				internals,
				dataSheetId,
				summarySheetId,
				dataCells,
				summaryCells,
				baselineSerialized,
				baselineLastKnown,
				changes,
				unsubscribe,
			};
		}

		function expectUnchangedAtomicState(fixture: AtomicFixture) {
			expect(fixture.hf.getSheetSerialized(fixture.dataSheetId)).toEqual(fixture.baselineSerialized.data);
			expect(fixture.hf.getSheetSerialized(fixture.summarySheetId)).toEqual(fixture.baselineSerialized.summary);
			expect(fixture.internals.getLastKnownCells("data")).toEqual(fixture.baselineLastKnown.data);
			expect(fixture.internals.getLastKnownCells("summary")).toEqual(fixture.baselineLastKnown.summary);
			expect(fixture.coordinator.canUndo()).toBe(false);
			expect(fixture.coordinator.canRedo()).toBe(true);
			expect(fixture.changes).toHaveLength(0);
		}

		it("rolls back when syncing a later sheet fails", () => {
			const fixture = createAtomicFixture();
			// Force both sheets dirty so sync cannot skip engine writes.
			fixture.dataCells[0]![1] = 11;
			fixture.summaryCells[0]![0] = "Total!";
			fixture.baselineSerialized = {
				data: structuredClone(fixture.hf.getSheetSerialized(fixture.dataSheetId)) as CellValue[][],
				summary: structuredClone(fixture.hf.getSheetSerialized(fixture.summarySheetId)) as CellValue[][],
			};
			fixture.baselineLastKnown = {
				data: fixture.internals.getLastKnownCells("data"),
				summary: fixture.internals.getLastKnownCells("summary"),
			};

			let setCalls = 0;
			const original = fixture.hf.setSheetContent.bind(fixture.hf);
			fixture.hf.setSheetContent = ((sheetId, content) => {
				setCalls += 1;
				// Capture does not write. Sync writes sheet 1 then sheet 2 — fail the second write.
				if (setCalls === 2) {
					throw new Error("sync later sheet failed");
				}
				return original(sheetId, content);
			}) as typeof fixture.hf.setSheetContent;

			const result = fixture.coordinator.insertRows("data", 1, 1);
			expect(Result.isError(result)).toBe(true);
			expectUnchangedAtomicState(fixture);

			fixture.hf.setSheetContent = original;
			fixture.unsubscribe();
		});

		it("rolls back when the structural mutation fails", () => {
			const fixture = createAtomicFixture();
			const original = fixture.hf.addRows.bind(fixture.hf);
			fixture.hf.addRows = (() => {
				throw new Error("structural mutation failed");
			}) as typeof fixture.hf.addRows;

			const result = fixture.coordinator.insertRows("data", 1, 1);
			expect(Result.isError(result)).toBe(true);
			expectUnchangedAtomicState(fixture);

			fixture.hf.addRows = original;
			fixture.unsubscribe();
		});

		it("rolls back when the after-snapshot fails", () => {
			const fixture = createAtomicFixture();
			let getCalls = 0;
			const original = fixture.hf.getSheetSerialized.bind(fixture.hf);
			fixture.hf.getSheetSerialized = ((sheetId) => {
				getCalls += 1;
				// Confirmed capture + cache before skip serialize. After fails on first sheet.
				if (getCalls === 1) {
					throw new Error("after snapshot failed");
				}
				return original(sheetId);
			}) as typeof fixture.hf.getSheetSerialized;

			const result = fixture.coordinator.insertRows("data", 1, 1);
			expect(Result.isError(result)).toBe(true);
			expectUnchangedAtomicState(fixture);

			fixture.hf.getSheetSerialized = original;
			fixture.unsubscribe();
		});

		it("returns a tagged rollback error when restoration itself fails", () => {
			resetTraceSink = setInternalTraceSink((event) => traceEvents.push(event));
			const fixture = createAtomicFixture();
			fixture.changes.length = 0;

			let phase: "forward" | "restore" = "forward";
			const originalAddRows = fixture.hf.addRows.bind(fixture.hf);
			const originalSetSheetContent = fixture.hf.setSheetContent.bind(fixture.hf);

			fixture.hf.addRows = (() => {
				phase = "restore";
				throw new Error("structural mutation failed");
			}) as typeof fixture.hf.addRows;

			fixture.hf.setSheetContent = ((sheetId, content) => {
				if (phase === "restore") {
					throw new Error("rollback restore failed");
				}
				return originalSetSheetContent(sheetId, content);
			}) as typeof fixture.hf.setSheetContent;

			const result = fixture.coordinator.insertRows("data", 1, 1);
			expect(Result.isError(result)).toBe(true);
			if (!Result.isError(result)) {
				throw new Error("Expected error Result");
			}
			expect(result.error._tag).toBe("WorkbookStructuralRollbackError");
			expect((result.error as { engineInconsistent: boolean }).engineInconsistent).toBe(true);
			expect(String((result.error as { message: string }).message)).toContain(
				"engine restore was incomplete",
			);
			expect(fixture.changes).toHaveLength(0);
			expect(traceEvents.some((event) =>
				event.operation === "insertRows" &&
				event.status === "err"
			)).toBe(true);

			fixture.hf.addRows = originalAddRows;
			fixture.hf.setSheetContent = originalSetSheetContent;
			fixture.unsubscribe();
		});

		it("rolls back a partial undo when a later sheet restore fails", () => {
			const hf = HyperFormula.buildEmpty({ licenseKey: "gpl-v3" });
			const coordinator = createWorkbookCoordinator({ engine: hf });
			const data = coordinator.bindSheet({ sheetKey: "data", formulaName: "Data" });
			const summary = coordinator.bindSheet({ sheetKey: "summary", formulaName: "Summary" });
			const internals = getWorkbookCoordinatorInternals(coordinator);

			const dataCells: CellValue[][] = [["Alpha", 10], ["Beta", 20], ["Gamma", 30]];
			const summaryCells: CellValue[][] = [["Total", "=SUM(Data!B1:B3)"], ["Mid", "=Data!B2"]];
			internals.attachDataGetter(data.sheetKey, () => dataCells);
			internals.attachDataGetter(summary.sheetKey, () => summaryCells);

			const insertChange = expectAppliedResult(coordinator.insertRows(data.sheetKey, 1, 1));
			const dataSheetId = internals.getFormulaEngineConfig(data).sheetId!;
			const summarySheetId = internals.getFormulaEngineConfig(summary).sheetId!;
			const baselineSerialized = {
				data: structuredClone(hf.getSheetSerialized(dataSheetId)) as CellValue[][],
				summary: structuredClone(hf.getSheetSerialized(summarySheetId)) as CellValue[][],
			};
			const baselineLastKnown = {
				data: internals.getLastKnownCells("data"),
				summary: internals.getLastKnownCells("summary"),
			};
			const changes: unknown[] = [];
			coordinator.subscribe((change) => changes.push(change));

			let setCalls = 0;
			const original = hf.setSheetContent.bind(hf);
			hf.setSheetContent = ((sheetId, content) => {
				setCalls += 1;
				// Undo restores scoped before snapshots (data then summary). Fail the second write.
				if (setCalls === 2) {
					throw new Error("undo restore later sheet failed");
				}
				return original(sheetId, content);
			}) as typeof hf.setSheetContent;

			const result = coordinator.undo();
			expect(Result.isError(result)).toBe(true);
			expect(hf.getSheetSerialized(dataSheetId)).toEqual(baselineSerialized.data);
			expect(hf.getSheetSerialized(summarySheetId)).toEqual(baselineSerialized.summary);
			expect(internals.getLastKnownCells("data")).toEqual(baselineLastKnown.data);
			expect(internals.getLastKnownCells("summary")).toEqual(baselineLastKnown.summary);
			expect(coordinator.canUndo()).toBe(true);
			expect(coordinator.canRedo()).toBe(false);
			expect(changes).toHaveLength(0);
			expect(insertChange.origin.type).toBe("insertRows");

			hf.setSheetContent = original;
		});

		it("preserves ordinary formula-bridge edits when a structural operation rolls back", () => {
			const hf = HyperFormula.buildEmpty({ licenseKey: "gpl-v3" });
			const coordinator = createWorkbookCoordinator({ engine: hf });
			const data = coordinator.bindSheet({ sheetKey: "data", formulaName: "Data" });
			const internals = getWorkbookCoordinatorInternals(coordinator);
			const engineConfig = internals.getFormulaEngineConfig(data);

			const dataCells: CellValue[][] = [[1]];
			internals.attachDataGetter(data.sheetKey, () => dataCells);

			// Confirm workbook caches against engine state.
			expectAppliedResult(coordinator.insertRows(data.sheetKey, 1, 1));
			expectAppliedResult(coordinator.undo());
			expect(hf.getSheetSerialized(engineConfig.sheetId!)[0]?.[0]).toBe(1);

			const bridgeResult = createFormulaBridge(engineConfig);
			expect(Result.isOk(bridgeResult)).toBe(true);
			if (!Result.isOk(bridgeResult)) {
				throw new Error("Expected formula bridge");
			}
			const bridge = bridgeResult.value;
			expectAppliedResult(bridge.setCell(physicalRow(0), columnIdx(0), 99));
			dataCells[0]![0] = 99;
			expect(hf.getSheetSerialized(engineConfig.sheetId!)[0]?.[0]).toBe(99);

			const originalAddRows = hf.addRows.bind(hf);
			hf.addRows = (() => {
				throw new Error("structural mutation failed");
			}) as typeof hf.addRows;

			const result = coordinator.insertRows(data.sheetKey, 1, 1);
			expect(Result.isError(result)).toBe(true);
			expect(hf.getSheetSerialized(engineConfig.sheetId!)[0]?.[0]).toBe(99);
			expect(coordinator.canUndo()).toBe(false);

			hf.addRows = originalAddRows;
			bridge.dispose();
		});
	});

	describe("scoped workbook history", () => {
		it("keeps all-sheet public snapshots while retaining only changed sheets in history", () => {
			const hf = HyperFormula.buildEmpty({ licenseKey: "gpl-v3" });
			const coordinator = createWorkbookCoordinator({ engine: hf });
			const data = coordinator.bindSheet({ sheetKey: "data", formulaName: "Data" });
			const summary = coordinator.bindSheet({ sheetKey: "summary", formulaName: "Summary" });
			const unrelated = coordinator.bindSheet({ sheetKey: "unrelated", formulaName: "Unrelated" });
			const internals = getWorkbookCoordinatorInternals(coordinator);

			const dataCells: CellValue[][] = [["Alpha", 10], ["Beta", 20], ["Gamma", 30]];
			const summaryCells: CellValue[][] = [["Total", "=SUM(Data!B1:B3)"]];
			const unrelatedCells: CellValue[][] = [["Note", "unchanged"]];
			internals.attachDataGetter(data.sheetKey, () => dataCells);
			internals.attachDataGetter(summary.sheetKey, () => summaryCells);
			internals.attachDataGetter(unrelated.sheetKey, () => unrelatedCells);

			let setSheetContentCalls = 0;
			let getSheetSerializedCalls = 0;
			const originalSet = hf.setSheetContent.bind(hf);
			const originalGet = hf.getSheetSerialized.bind(hf);
			hf.setSheetContent = ((sheetId, content) => {
				setSheetContentCalls += 1;
				return originalSet(sheetId, content);
			}) as typeof hf.setSheetContent;
			hf.getSheetSerialized = ((sheetId) => {
				getSheetSerializedCalls += 1;
				return originalGet(sheetId);
			}) as typeof hf.getSheetSerialized;

			// Seed so subsequent insert can skip clean-sheet sync writes and confirmed capture serializes.
			expectAppliedResult(coordinator.insertRows(data.sheetKey, 1, 1));
			expectAppliedResult(coordinator.undo());
			setSheetContentCalls = 0;
			getSheetSerializedCalls = 0;

			const change = expectAppliedResult(coordinator.insertRows(data.sheetKey, 1, 1));
			expect(change.snapshots.map((snapshot) => snapshot.sheetKey).sort()).toEqual([
				"data",
				"summary",
				"unrelated",
			]);

			const historyEntries = internals.peekHistoryEntries();
			expect(historyEntries).toHaveLength(1);
			const entry = historyEntries[0]!;
			expect(entry.beforeSheetKeys.sort()).toEqual(["data", "summary"]);
			expect(entry.afterSheetKeys.sort()).toEqual(["data", "summary"]);
			expect(entry.beforeSheetKeys.includes("unrelated")).toBe(false);
			expect(entry.afterSheetKeys.includes("unrelated")).toBe(false);

			// Clean sheets should not be rewritten during sync after seeding.
			expect(setSheetContentCalls).toBe(0);
			// Confirmed rollback capture + cache `before` skip serialize; only public `after` serializes once per sheet.
			expect(getSheetSerializedCalls).toBe(3);

			const undoChange = expectAppliedResult(coordinator.undo());
			expect(undoChange.snapshots.map((snapshot) => snapshot.sheetKey).sort()).toEqual([
				"data",
				"summary",
				"unrelated",
			]);
			expect(undoChange.snapshots.find((snapshot) => snapshot.sheetKey === "summary")?.cells[0]?.[1])
				.toBe("=SUM(Data!B1:B3)");

			hf.setSheetContent = originalSet;
			hf.getSheetSerialized = originalGet;
		});

		it("undo/redo remain stable across repeated scoped history cycles", () => {
			const hf = HyperFormula.buildEmpty({ licenseKey: "gpl-v3" });
			const coordinator = createWorkbookCoordinator({ engine: hf });
			const data = coordinator.bindSheet({ sheetKey: "data", formulaName: "Data" });
			const summary = coordinator.bindSheet({ sheetKey: "summary", formulaName: "Summary" });
			const internals = getWorkbookCoordinatorInternals(coordinator);

			let dataCells: CellValue[][] = [["Alpha", 10], ["Beta", 20], ["Gamma", 30]];
			let summaryCells: CellValue[][] = [["Total", "=SUM(Data!B1:B3)"], ["Mid", "=Data!B2"]];
			internals.attachDataGetter(data.sheetKey, () => dataCells);
			internals.attachDataGetter(summary.sheetKey, () => summaryCells);

			const insertChange = expectAppliedResult(coordinator.insertRows(data.sheetKey, 1, 1));
			dataCells = insertChange.snapshots.find((snapshot) => snapshot.sheetKey === "data")!.cells;
			summaryCells = insertChange.snapshots.find((snapshot) => snapshot.sheetKey === "summary")!.cells;

			for (let cycle = 0; cycle < 3; cycle += 1) {
				const undoChange = expectAppliedResult(coordinator.undo());
				expect(undoChange.snapshots.find((snapshot) => snapshot.sheetKey === "summary")?.cells[0]?.[1])
					.toBe("=SUM(Data!B1:B3)");
				const redoChange = expectAppliedResult(coordinator.redo());
				expect(redoChange.snapshots.find((snapshot) => snapshot.sheetKey === "summary")?.cells[0]?.[1])
					.toBe("=SUM(Data!B1:B4)");
			}
		});
	});
});
