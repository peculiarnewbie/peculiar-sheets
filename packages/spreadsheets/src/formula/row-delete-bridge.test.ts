import { describe, expect, it } from "bun:test";
import { createFormulaBridge } from "./bridge";
import type { CellValue } from "../types";

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

function createRefError(address: string) {
	return { value: "#REF!", address, type: "REF", message: "" };
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

	function evaluateSum(expression: string, sheetId: number, row: number, col: number, seen: Set<string>) {
		if (expression.includes("#REF!")) {
			return createRefError(`Test!${String.fromCharCode(65 + col)}${row + 1}`);
		}

		const rangeMatch = /^SUM\(([A-Z]+\d+):([A-Z]+\d+)\)$/i.exec(expression);
		if (!rangeMatch) return "#ERROR!";

		const start = parseCellReference(rangeMatch[1]!);
		const end = parseCellReference(rangeMatch[2]!);
		if (!start || !end) return "#ERROR!";

		let sum = 0;
		for (let r = Math.min(start.row, end.row); r <= Math.max(start.row, end.row); r++) {
			for (let c = Math.min(start.col, end.col); c <= Math.max(start.col, end.col); c++) {
				const value = evaluateCell(sheetId, r, c, seen);
				if (typeof value === "object" && value !== null && "value" in value) return value;
				if (typeof value === "number") sum += value;
			}
		}
		return sum;
	}

	function evaluateCell(sheetId: number, row: number, col: number, seen = new Set<string>()): unknown {
		const key = `${sheetId}:${row}:${col}`;
		if (seen.has(key)) return "#CYCLE!";
		seen.add(key);

		const raw = sheetContents.get(sheetId)?.[row]?.[col] ?? null;
		if (typeof raw !== "string" || !raw.startsWith("=")) return raw;

		const expression = raw.slice(1).trim();
		if (expression.includes("#REF!")) {
			return createRefError(`Test!${String.fromCharCode(65 + col)}${row + 1}`);
		}

		if (expression.startsWith("SUM(")) {
			return evaluateSum(expression, sheetId, row, col, seen);
		}

		const parts = expression.split("+").map((p) => p.trim());
		let sum = 0;
		for (const part of parts) {
			const ref = parseCellReference(part);
			if (!ref) return "#ERROR!";
			const value = evaluateCell(sheetId, ref.row, ref.col, seen);
			if (typeof value === "object" && value !== null && "value" in value) return value;
			if (typeof value !== "number") return "#ERROR!";
			sum += value;
		}
		return sum;
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
			while (sheet.length <= address.row) sheet.push([]);
			while ((sheet[address.row]?.length ?? 0) <= address.col) sheet[address.row]!.push(null);
			sheet[address.row]![address.col] = value;
		},
		getCellValue(address: { sheet: number; row: number; col: number }) {
			return evaluateCell(address.sheet, address.row, address.col);
		},
		setRowOrder(_sheetId: number, _order: number[]) { return true; },
		isItPossibleToSetRowOrder() { return true; },
		on(event: string, callback: (...args: unknown[]) => void) {
			const reg = handlers.get(event) ?? new Set();
			reg.add(callback);
			handlers.set(event, reg);
		},
		off(event: string, callback: (...args: unknown[]) => void) {
			handlers.get(event)?.delete(callback);
		},
		emitValuesUpdated(changes: unknown[]) {
			for (const handler of handlers.get("valuesUpdated") ?? []) handler(changes);
		},
		getRawSheet(sheetId: number) {
			return sheetContents.get(sheetId);
		},
	};
}

describe("formula bridge after row delete", () => {
	it("reflects recalculated display values after delete sync", () => {
		const engine = createMockEngine();
		const bridge = createFormulaBridge({ instance: engine, sheetName: "Test" })!;

		const initialData: CellValue[][] = [
			[48, 52, "=A1+B1"],
			[32, 35, "=A2+B2"],
			[28, 31, "=A3+B3"],
			[null, null, "=SUM(C1:C3)"],
		];
		bridge.syncAll(initialData);

		expect(bridge.getDisplayValue(3, 2, "=SUM(C1:C3)")).toBe(226);

		const postDelete: CellValue[][] = [
			[48, 52, "=A1+B1"],
			[28, 31, "=A2+B2"],
			[null, null, "=SUM(C1:C2)"],
		];
		bridge.syncAll(postDelete);

		expect(bridge.getDisplayValue(1, 2, "=A2+B2")).toBe(59);
		expect(bridge.getDisplayValue(2, 2, "=SUM(C1:C2)")).toBe(159);
	});

	it("surfaces #REF! displays after delete invalidates a referenced row", () => {
		const engine = createMockEngine();
		const bridge = createFormulaBridge({ instance: engine, sheetName: "Test" })!;

		bridge.syncAll([
			[10, null],
			[20, null],
			["=A3", null],
		]);

		bridge.syncAll([
			[10, null],
			["=#REF!", null],
		]);

		expect(bridge.getDisplayValue(1, 0, "=#REF!")).toBe("#REF!");
	});

	it("delete -> undo -> redo stays coherent through syncAll", () => {
		const engine = createMockEngine();
		const bridge = createFormulaBridge({ instance: engine, sheetName: "Test" })!;

		const original: CellValue[][] = [
			[10, "=A1+A2"],
			[20, null],
		];
		bridge.syncAll(original);
		expect(bridge.getDisplayValue(0, 1, "=A1+A2")).toBe(30);

		const deleted: CellValue[][] = [
			[10, "=A1+#REF!"],
		];
		bridge.syncAll(deleted);
		expect(bridge.getDisplayValue(0, 1, "=A1+#REF!")).toBe("#REF!");

		bridge.syncAll(original);
		expect(bridge.getDisplayValue(0, 1, "=A1+A2")).toBe(30);

		bridge.syncAll(deleted);
		expect(bridge.getDisplayValue(0, 1, "=A1+#REF!")).toBe("#REF!");
	});
});
