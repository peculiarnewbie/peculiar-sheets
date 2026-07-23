import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { IronCalcFormulaEngine } from "./index";
import { createIronCalcFormulaEngine } from "./index";

let engine: IronCalcFormulaEngine;

beforeAll(async () => {
	const entry = new URL(import.meta.resolve("@ironcalc/wasm"));
	const wasm = await readFile(fileURLToPath(new URL("wasm_bg.wasm", entry)));
	engine = await createIronCalcFormulaEngine({ wasm });
});

afterAll(() => {
	engine.dispose?.();
});

describe("IronCalc FormulaEngine conformance", () => {
	test("evaluates typed scalar, boolean, formula, and error values", () => {
		const sheet = engine.findSheetId("Sheet1");
		expect(sheet).toBe(0);
		engine.replaceSheet(sheet!, [
			[21, "=A1*2"],
			[true, "=1/0"],
		]);

		expect(engine.getCellValue({ sheet: sheet!, row: 0, col: 0 })).toBe(21);
		expect(engine.getCellValue({ sheet: sheet!, row: 0, col: 1 })).toBe(42);
		expect(engine.getCellValue({ sheet: sheet!, row: 1, col: 0 })).toBe(true);
		expect(engine.getCellValue({ sheet: sheet!, row: 1, col: 1 })).toBe("#DIV/0!");
		expect(engine.serializeSheet(sheet!)).toEqual([
			[21, "=A1*2"],
			[true, "=1/0"],
		]);
	});

	test("coalesces batch notifications and recalculates dependencies", () => {
		const sheet = engine.findSheetId("Sheet1")!;
		let revisions = 0;
		const unsubscribe = engine.subscribe(() => { revisions += 1; });

		engine.transaction(() => {
			engine.setCell({ sheet, row: 0, col: 0 }, 10);
			engine.setCell({ sheet, row: 0, col: 1 }, "=A1+5");
		});

		expect(revisions).toBe(1);
		expect(engine.getCellValue({ sheet, row: 0, col: 1 })).toBe(15);
		unsubscribe();
	});

	test("supports cross-sheet formulas and reference formatting", () => {
		const data = engine.findSheetId("Sheet1")!;
		engine.replaceSheet(data, [[7]]);
		const summary = engine.createSheet("Sales Summary");
		engine.replaceSheet(summary.id, [["=Sheet1!A1*3"]]);

		expect(engine.getCellValue({ sheet: summary.id, row: 0, col: 0 })).toBe(21);
		expect(engine.formatRange({
			start: { sheet: summary.id, row: 0, col: 0 },
			end: { sheet: summary.id, row: 1, col: 1 },
		}, data)).toBe("'Sales Summary'!A1:B2");
	});

	test("inserts, deletes, and reorders rows while preserving formulas", () => {
		const sheet = engine.findSheetId("Sheet1")!;
		engine.replaceSheet(sheet, [
			[1, "=A1*10"],
			[2, "=A2*10"],
			[3, "=A3*10"],
		]);

		engine.insertRows(sheet, 1, 1);
		expect(engine.serializeSheet(sheet)).toEqual([
			[1, "=A1*10"],
			[null, null],
			[2, "=A3*10"],
			[3, "=A4*10"],
		]);

		engine.deleteRows(sheet, 1, 1);
		engine.reorderRows(sheet, [2, 1, 0]);
		expect(engine.serializeSheet(sheet)).toEqual([
			[3, "=A1*10"],
			[2, "=A2*10"],
			[1, "=A3*10"],
		]);
		expect(engine.getCellValue({ sheet, row: 0, col: 1 })).toBe(30);
	});
});
