import { createSignal } from "solid-js";
import type { CellValue, FormulaEngineConfig } from "../types";
import { isFormulaValue } from "./references";

// ── HyperFormula Bridge ──────────────────────────────────────────────────────
//
// This module wraps HyperFormula as an optional formula engine. It uses dynamic
// property access so the library has no hard compile-time dependency on
// HyperFormula — it's a peer dependency that may or may not be installed.

/** Minimal interface we expect from a HyperFormula instance. */
interface HyperFormulaLike {
	setCellContents(address: { sheet: number; row: number; col: number }, value: unknown): void;
	getCellValue(address: { sheet: number; row: number; col: number }): unknown;
	addSheet(name?: string): string;
	getSheetId(name: string): number | undefined;
	setSheetContent(sheetId: number, data: unknown[][]): void;
	setRowOrder(sheetId: number, newRowOrder: number[]): unknown;
	isItPossibleToSetRowOrder(sheetId: number, newRowOrder: number[]): boolean;
	on(event: string, callback: (...args: unknown[]) => void): void;
	off(event: string, callback: (...args: unknown[]) => void): void;
}

export interface FormulaBridge {
	/** Ensure the target sheet exists and return its sheet id. */
	ensureSheet(): number | null;
	/** Reactive revision number bumped when formula outputs change. */
	revision(): number;
	/** Sync all cell data to the formula engine. */
	syncAll(cells: CellValue[][]): void;
	/** Update a single cell in the formula engine. */
	setCell(row: number, col: number, value: CellValue): void;
	/** Reorder rows structurally in the formula engine. */
	setRowOrder(newRowOrder: number[]): boolean;
	/** Get the display value for a cell (evaluated formula result or raw value). */
	getDisplayValue(row: number, col: number, rawValue: CellValue): CellValue;
	/** Check if a cell value is a formula. */
	isFormula(value: CellValue): boolean;
	/** Cleanup listeners. */
	dispose(): void;
}

/**
 * Creates a formula bridge from the engine config.
 * Returns null if no config is provided.
 */
export function createFormulaBridge(
	config: FormulaEngineConfig | undefined,
): FormulaBridge | null {
	if (!config) return null;

	const hf = config.instance as HyperFormulaLike;
	let resolvedSheetId: number | null = config.sheetId ?? null;
	const sheetName = config.sheetName ?? "Sheet1";
	const [revision, setRevision] = createSignal(0);

	function bumpRevision() {
		setRevision((value) => value + 1);
	}

	function normalizeEngineValue(value: CellValue): CellValue {
		if (typeof value !== "string") return value;

		const trimmed = value.trim();
		if (!trimmed.startsWith("=")) return value;

		let rest = trimmed.slice(1);
		while (rest.startsWith("=")) {
			rest = rest.slice(1);
		}

		return `=${rest}`;
	}

	function coerceDisplayValue(result: unknown, rawValue: CellValue): CellValue {
		if (result === null || result === undefined) return null;
		if (typeof result === "string" || typeof result === "number" || typeof result === "boolean") {
			return result;
		}

		if (typeof result === "object" && result !== null) {
			const err = result as { value?: unknown; message?: unknown };
			if (typeof err.value === "string") return err.value;
			if (typeof err.message === "string") return err.message;
		}

		return typeof rawValue === "string" ? rawValue : String(result);
	}

	function resolveSheetId(): number | null {
		if (resolvedSheetId !== null) return resolvedSheetId;

		try {
			const existingId = hf.getSheetId(sheetName);
			if (existingId !== undefined) {
				resolvedSheetId = existingId;
				return resolvedSheetId;
			}
		} catch {
			// Ignore lookup errors and try adding.
		}

		try {
			const actualName = hf.addSheet(sheetName);
			const addedId = hf.getSheetId(actualName);
			if (addedId !== undefined) {
				resolvedSheetId = addedId;
				return resolvedSheetId;
			}
		} catch {
			// Ignore engine setup errors.
		}

		return null;
	}

	function handleValuesUpdated(...args: unknown[]) {
		const [changes] = args;
		if (!Array.isArray(changes)) return;

		const sheetId = resolveSheetId();
		if (sheetId === null) return;

		const affectsSheet = changes.some((change) => {
			if (typeof change !== "object" || change === null) return false;
			if (!("address" in change)) return true;

			const address = (change as { address?: { sheet?: unknown } }).address;
			return address?.sheet === sheetId;
		});

		if (affectsSheet) {
			bumpRevision();
		}
	}

	try {
		hf.on("valuesUpdated", handleValuesUpdated);
	} catch {
		// Ignore event subscription errors.
	}

	const bridge: FormulaBridge = {
		ensureSheet() {
			return resolveSheetId();
		},

		revision() {
			return revision();
		},

		syncAll(cells: CellValue[][]) {
			const sheetId = resolveSheetId();
			if (sheetId === null) return;

			try {
				hf.setSheetContent(
					sheetId,
					cells.map((row) => row.map((value) => normalizeEngineValue(value))),
				);
				bumpRevision();
			} catch {
				// Sheet might not exist yet — silently fail
			}
		},

		setCell(row: number, col: number, value: CellValue) {
			const sheetId = resolveSheetId();
			if (sheetId === null) return;

			try {
				hf.setCellContents(
					{ sheet: sheetId, row, col },
					normalizeEngineValue(value),
				);
				bumpRevision();
			} catch {
				// Ignore errors for now
			}
		},

		setRowOrder(newRowOrder: number[]) {
			const sheetId = resolveSheetId();
			if (sheetId === null) return false;

			try {
				if (!hf.isItPossibleToSetRowOrder(sheetId, newRowOrder)) {
					return false;
				}
				hf.setRowOrder(sheetId, newRowOrder);
				bumpRevision();
				return true;
			} catch {
				return false;
			}
		},

		getDisplayValue(row: number, col: number, rawValue: CellValue): CellValue {
			if (!bridge.isFormula(rawValue)) return rawValue;
			const sheetId = resolveSheetId();
			if (sheetId === null) return rawValue;

			try {
				const result = hf.getCellValue({ sheet: sheetId, row, col });
				return coerceDisplayValue(result, rawValue);
			} catch {
				return rawValue;
			}
		},

		isFormula(value: CellValue): boolean {
			return isFormulaValue(value);
		},

		dispose() {
			try {
				hf.off("valuesUpdated", handleValuesUpdated);
			} catch {
				// Ignore cleanup errors.
			}
		},
	};

	return bridge;
}
