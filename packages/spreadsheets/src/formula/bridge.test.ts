import { afterEach, describe, expect, it } from "bun:test";
import { createFormulaBridge } from "./bridge";
import { Result, isApplied, isNoop } from "../internal/result";
import { setInternalTraceSink, type InternalTraceEvent } from "../internal/trace";

function columnLettersToIndex(input: string): number {
	let index = 0;
	for (const char of input) {
		index = index * 26 + (char.charCodeAt(0) - 64);
	}
	return index - 1;
}

function parseCellReference(reference: string) {
	const match = /^([A-Z]+)(\d+)$/.exec(reference.trim().toUpperCase());
	if (!match) return null;

	return {
		col: columnLettersToIndex(match[1]!),
		row: Number(match[2]) - 1,
	};
}

function createMockEngine() {
	const sheetIds = new Map<string, number>();
	const sheetContents = new Map<number, unknown[][]>();
	const handlers = new Map<string, Set<(...args: unknown[]) => void>>();
	let nextSheetId = 0;

	function ensureSheet(sheetId: number) {
		const existing = sheetContents.get(sheetId);
		if (existing) return existing;
		const created: unknown[][] = [];
		sheetContents.set(sheetId, created);
		return created;
	}

	function evaluateCell(sheetId: number, row: number, col: number, seen = new Set<string>()): unknown {
		const key = `${sheetId}:${row}:${col}`;
		if (seen.has(key)) return "#CYCLE!";
		seen.add(key);

		const raw = sheetContents.get(sheetId)?.[row]?.[col] ?? null;
		if (typeof raw !== "string" || !raw.startsWith("=")) {
			return raw;
		}

		const expression = raw.slice(1).trim();
		const parts = expression.split("+").map((part) => part.trim());
		if (parts.length === 0) return null;

		let sum = 0;
		for (const part of parts) {
			const ref = parseCellReference(part);
			if (!ref) return "#ERROR!";
			const value = evaluateCell(sheetId, ref.row, ref.col, seen);
			if (typeof value !== "number") return "#ERROR!";
			sum += value;
		}

		return sum;
	}

	function emit(event: string, ...args: unknown[]) {
		for (const handler of handlers.get(event) ?? []) {
			handler(...args);
		}
	}

	return {
		addSheet(name = `Sheet${nextSheetId + 1}`) {
			const id = nextSheetId++;
			sheetIds.set(name, id);
			sheetContents.set(id, []);
			return name;
		},
		getSheetId(name: string) {
			return sheetIds.get(name);
		},
		setSheetContent(sheetId: number, data: unknown[][]) {
			sheetContents.set(sheetId, data.map((row) => [...row]));
		},
		setCellContents(address: { sheet: number; row: number; col: number }, value: unknown) {
			const sheet = ensureSheet(address.sheet);
			while (sheet.length <= address.row) {
				sheet.push([]);
			}
			while ((sheet[address.row]?.length ?? 0) <= address.col) {
				sheet[address.row]!.push(null);
			}
			sheet[address.row]![address.col] = value;
		},
		getCellValue(address: { sheet: number; row: number; col: number }) {
			return evaluateCell(address.sheet, address.row, address.col);
		},
		isItPossibleToSetRowOrder(_sheetId: number, _newRowOrder: number[]) {
			return true;
		},
		setRowOrder(sheetId: number, newRowOrder: number[]) {
			const current = sheetContents.get(sheetId) ?? [];
			sheetContents.set(sheetId, newRowOrder.map((index) => [...(current[index] ?? [])]));
		},
		on(event: string, callback: (...args: unknown[]) => void) {
			const registered = handlers.get(event) ?? new Set<(...args: unknown[]) => void>();
			registered.add(callback);
			handlers.set(event, registered);
		},
		off(event: string, callback: (...args: unknown[]) => void) {
			handlers.get(event)?.delete(callback);
		},
		emitValuesUpdated(changes: unknown[]) {
			emit("valuesUpdated", changes);
		},
		getListenerCount(event: string) {
			return handlers.get(event)?.size ?? 0;
		},
	};
}

function expectAppliedNumber(result: ReturnType<NonNullable<ReturnType<typeof createFormulaBridge>>["ensureSheet"]>) {
	expect(Result.isOk(result)).toBe(true);
	if (!Result.isOk(result) || !isApplied(result.value)) {
		throw new Error("Expected applied Result");
	}
	return result.value.value;
}

describe("formula bridge", () => {
	let traceEvents: InternalTraceEvent[] = [];
	let resetTraceSink: (() => void) | null = null;

	afterEach(() => {
		traceEvents = [];
		resetTraceSink?.();
		resetTraceSink = null;
	});

	it("creates and reuses sheets by name", () => {
		const engine = createMockEngine();
		const bridge = createFormulaBridge({
			instance: engine,
			sheetName: "Gameplay",
		});

		expect(bridge).not.toBeNull();
		expect(expectAppliedNumber(bridge!.ensureSheet())).toBe(0);
		expect(expectAppliedNumber(bridge!.ensureSheet())).toBe(0);
	});

	it("returns evaluated display values for formulas", () => {
		const engine = createMockEngine();
		const bridge = createFormulaBridge({
			instance: engine,
			sheetName: "Gameplay",
		});

		expectAppliedNumber(bridge!.syncAll([
			[1, 2],
			["=A1+B1", null],
		]));

		expect(bridge!.getDisplayValue(1, 0, "=A1+B1")).toBe(3);
		expect(bridge!.getDisplayValue(0, 0, 1)).toBe(1);
	});

	it("tracks recalculation revisions and unsubscribes on dispose", () => {
		const engine = createMockEngine();
		const bridge = createFormulaBridge({
			instance: engine,
			sheetName: "Gameplay",
		});

		expect(engine.getListenerCount("valuesUpdated")).toBe(1);
		expect(bridge!.revision()).toBe(0);

		expectAppliedNumber(bridge!.ensureSheet());
		engine.emitValuesUpdated([{ address: { sheet: 0, row: 1, col: 0 } }]);

		expect(bridge!.revision()).toBe(1);

		bridge!.dispose();
		expect(engine.getListenerCount("valuesUpdated")).toBe(0);
	});

	it("bumps revision immediately when a cell is updated", () => {
		const engine = createMockEngine();
		const bridge = createFormulaBridge({
			instance: engine,
			sheetName: "Gameplay",
		});

		expectAppliedNumber(bridge!.ensureSheet());
		expect(bridge!.revision()).toBe(0);

		expectAppliedNumber(bridge!.setCell(0, 0, "=A1"));

		expect(bridge!.revision()).toBe(1);
	});

	it("normalizes repeated leading equals before sending formulas to the engine", () => {
		const engine = createMockEngine();
		const bridge = createFormulaBridge({
			instance: engine,
			sheetName: "Gameplay",
		});

		expectAppliedNumber(bridge!.syncAll([[1, 2, null]]));
		expectAppliedNumber(bridge!.setCell(0, 2, "==A1+B1"));

		expect(bridge!.getDisplayValue(0, 2, "=A1+B1")).toBe(3);
	});

	it("recomputes dependent formula display after recalculation", () => {
		const engine = createMockEngine();
		const bridge = createFormulaBridge({
			instance: engine,
			sheetName: "Gameplay",
		});

		expectAppliedNumber(bridge!.syncAll([[1, 2, "=A1+B1"]]));
		expect(bridge!.getDisplayValue(0, 2, "=A1+B1")).toBe(3);

		expectAppliedNumber(bridge!.setCell(0, 0, 5));
		engine.emitValuesUpdated([
			{ address: { sheet: 0, row: 0, col: 0 } },
			{ address: { sheet: 0, row: 0, col: 2 } },
		]);

		expect(bridge!.revision()).toBeGreaterThan(1);
		expect(bridge!.getDisplayValue(0, 2, "=A1+B1")).toBe(7);
	});

	it("traces subscription failures without throwing during bridge creation", () => {
		const engine = createMockEngine();
		resetTraceSink = setInternalTraceSink((event) => traceEvents.push(event));
		engine.on = () => {
			throw new Error("subscribe failed");
		};

		const bridge = createFormulaBridge({
			instance: engine,
			sheetName: "Gameplay",
		});

		expect(bridge).not.toBeNull();
		expect(traceEvents.some((event) =>
			event.operation === "subscribeValuesUpdated" &&
			event.status === "err" &&
			event.context.message === "subscribe failed"
		)).toBe(true);
	});

	it("traces sync errors and returns an error Result", () => {
		const engine = createMockEngine();
		resetTraceSink = setInternalTraceSink((event) => traceEvents.push(event));
		const bridge = createFormulaBridge({
			instance: engine,
			sheetName: "Gameplay",
		});
		engine.setSheetContent = () => {
			throw new Error("sync failed");
		};

		const result = bridge!.syncAll([[1]]);

		expect(Result.isError(result)).toBe(true);
		expect(traceEvents.some((event) =>
			event.operation === "syncAll" &&
			event.status === "err" &&
			event.context.message === "sync failed"
		)).toBe(true);
	});

	it("traces cell update errors and returns an error Result", () => {
		const engine = createMockEngine();
		resetTraceSink = setInternalTraceSink((event) => traceEvents.push(event));
		const bridge = createFormulaBridge({
			instance: engine,
			sheetName: "Gameplay",
		});

		expectAppliedNumber(bridge!.ensureSheet());
		engine.setCellContents = () => {
			throw new Error("cell update failed");
		};

		const result = bridge!.setCell(0, 0, 1);

		expect(Result.isError(result)).toBe(true);
		expect(traceEvents.some((event) =>
			event.operation === "setCell" &&
			event.status === "err" &&
			event.context.message === "cell update failed"
		)).toBe(true);
	});

	it("returns a noop Result when row reordering is rejected by the engine", () => {
		const engine = createMockEngine();
		const bridge = createFormulaBridge({
			instance: engine,
			sheetName: "Gameplay",
		});
		engine.isItPossibleToSetRowOrder = () => false;

		const result = bridge!.setRowOrder([0]);

		expect(Result.isOk(result)).toBe(true);
		if (!Result.isOk(result) || !isNoop(result.value)) {
			throw new Error("Expected noop Result");
		}
		expect(result.value.reason).toBe("engine-rejected");
	});

	it("falls back to the raw formula text when display evaluation fails", () => {
		const engine = createMockEngine();
		resetTraceSink = setInternalTraceSink((event) => traceEvents.push(event));
		const bridge = createFormulaBridge({
			instance: engine,
			sheetName: "Gameplay",
		});

		expectAppliedNumber(bridge!.syncAll([["=A1"]]));
		engine.getCellValue = () => {
			throw new Error("display failed");
		};

		expect(bridge!.getDisplayValue(0, 0, "=A1")).toBe("=A1");
		expect(traceEvents.some((event) =>
			event.operation === "getDisplayValue" &&
			event.status === "err" &&
			event.context.message === "display failed"
		)).toBe(true);
	});
});
