import type { CellValue } from "../types";

export interface FormulaEngineAddress {
	sheet: number;
	row: number;
	col: number;
}

export interface FormulaEngineRange {
	start: FormulaEngineAddress;
	end: FormulaEngineAddress;
}

/**
 * Engine-neutral synchronous formula and workbook boundary.
 *
 * Adapters own coordinate conversion, evaluation timing, and engine-specific
 * events. Peculiar Sheets owns UI history and never calls an engine's undo API.
 */
export interface FormulaEngine {
	readonly engine: "ironcalc" | "hyperformula" | (string & {});

	createSheet(name?: string): { id: number; name: string };
	findSheetId(name: string): number | undefined;
	findSheetName(sheetId: number): string | undefined;
	formatRange(range: FormulaEngineRange, contextSheetId: number): string | undefined;

	replaceSheet(sheetId: number, values: CellValue[][]): void;
	serializeSheet(sheetId: number): CellValue[][];
	setCell(address: FormulaEngineAddress, value: CellValue): void;
	getCellValue(address: FormulaEngineAddress): unknown;

	insertRows(sheetId: number, atIndex: number, count: number): void;
	canInsertRows(sheetId: number, atIndex: number, count: number): boolean;
	deleteRows(sheetId: number, atIndex: number, count: number): void;
	canDeleteRows(sheetId: number, atIndex: number, count: number): boolean;
	reorderRows(sheetId: number, indexOrder: number[]): void;
	canReorderRows(sheetId: number, indexOrder: number[]): boolean;

	transaction<T>(callback: () => T): T;
	subscribe(listener: (changes?: readonly FormulaEngineAddress[]) => void): () => void;
	dispose?(): void;
}

/** @deprecated Use FormulaEngine. Kept as a source-compatible migration alias. */
export interface HyperFormulaWorkbookLike {
	addSheet(name?: string): string;
	getSheetId(name: string): number | undefined;
	getSheetName(sheetId: number): string | undefined;
	simpleCellRangeToString(range: FormulaEngineRange, contextSheetId: number): string | undefined;
	setSheetContent(sheetId: number, values: unknown[][]): unknown;
	getSheetSerialized(sheetId: number): unknown[][];
	addRows(sheetId: number, ...indexes: [number, number][]): unknown;
	isItPossibleToAddRows(sheetId: number, ...indexes: [number, number][]): boolean;
	removeRows(sheetId: number, ...indexes: [number, number][]): unknown;
	isItPossibleToRemoveRows(sheetId: number, ...indexes: [number, number][]): boolean;
	setRowOrder(sheetId: number, newRowOrder: number[]): unknown;
	isItPossibleToSetRowOrder(sheetId: number, newRowOrder: number[]): boolean;
	setCellContents(address: FormulaEngineAddress, value: unknown | unknown[][]): unknown;
	getCellValue(address: FormulaEngineAddress): unknown;
	batch?<T>(callback: () => T): T;
	on(event: string, callback: (...args: unknown[]) => void): void;
	off(event: string, callback: (...args: unknown[]) => void): void;
}

function normalizeCellValue(value: unknown): CellValue {
	if (value === null || value === undefined) return null;
	if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
		return value;
	}
	return String(value);
}

export function isFormulaEngine(value: unknown): value is FormulaEngine {
	if (typeof value !== "object" || value === null) return false;
	const candidate = value as Partial<FormulaEngine>;
	return (
		typeof candidate.engine === "string" &&
		typeof candidate.createSheet === "function" &&
		typeof candidate.replaceSheet === "function" &&
		typeof candidate.subscribe === "function"
	);
}

/** Wrap a direct HyperFormula instance without importing its GPL package. */
export function adaptHyperFormula(instance: unknown): FormulaEngine {
	if (isFormulaEngine(instance)) return instance;

	const hf = instance as HyperFormulaWorkbookLike;
	return {
		engine: "hyperformula",
		createSheet(name) {
			const createdName = hf.addSheet(name);
			const id = hf.getSheetId(createdName);
			if (id === undefined) throw new Error(`Formula engine did not resolve sheet "${createdName}".`);
			return { id, name: createdName };
		},
		findSheetId: (name) => hf.getSheetId(name),
		findSheetName: (sheetId) => hf.getSheetName(sheetId),
		formatRange: (range, contextSheetId) => hf.simpleCellRangeToString(range, contextSheetId),
		replaceSheet: (sheetId, values) => { hf.setSheetContent(sheetId, values); },
		serializeSheet: (sheetId) => hf.getSheetSerialized(sheetId).map((row) => row.map(normalizeCellValue)),
		setCell: (address, value) => { hf.setCellContents(address, value); },
		getCellValue: (address) => hf.getCellValue(address),
		insertRows: (sheetId, atIndex, count) => { hf.addRows(sheetId, [atIndex, count]); },
		canInsertRows: (sheetId, atIndex, count) => hf.isItPossibleToAddRows(sheetId, [atIndex, count]),
		deleteRows: (sheetId, atIndex, count) => { hf.removeRows(sheetId, [atIndex, count]); },
		canDeleteRows: (sheetId, atIndex, count) => hf.isItPossibleToRemoveRows(sheetId, [atIndex, count]),
		reorderRows: (sheetId, indexOrder) => { hf.setRowOrder(sheetId, indexOrder); },
		canReorderRows: (sheetId, indexOrder) => hf.isItPossibleToSetRowOrder(sheetId, indexOrder),
		transaction: (callback) => typeof hf.batch === "function" ? hf.batch(callback) : callback(),
		subscribe(listener) {
			const handleValuesUpdated = (...args: unknown[]) => {
				const [changes] = args;
				if (!Array.isArray(changes)) {
					listener();
					return;
				}
				const addresses = changes.flatMap((change): FormulaEngineAddress[] => {
					if (typeof change !== "object" || change === null || !("address" in change)) return [];
					const address = (change as { address?: FormulaEngineAddress }).address;
					return address ? [address] : [];
				});
				listener(addresses.length > 0 ? addresses : undefined);
			};
			hf.on("valuesUpdated", handleValuesUpdated);
			return () => { hf.off("valuesUpdated", handleValuesUpdated); };
		},
	};
}
