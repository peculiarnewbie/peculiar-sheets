import initializeIronCalc, {
	Model,
	type InitInput,
} from "@ironcalc/wasm";
import type {
	CellValue,
	FormulaEngine,
	FormulaEngineAddress,
	FormulaEngineConfig,
	FormulaEngineRange,
} from "peculiar-sheets";

export { Model } from "@ironcalc/wasm";

export interface IronCalcSheetDimensions {
	rows: number;
	columns: number;
}

export interface CreateIronCalcFormulaEngineOptions {
	name?: string;
	locale?: string;
	timezone?: string;
	languageId?: string;
	/** Override the WASM source. Useful for SSR, tests, and self-hosted assets. */
	wasm?: InitInput | Promise<InitInput>;
}

export interface AdaptIronCalcModelOptions {
	/** The adapter frees the model on dispose when true. */
	owned?: boolean;
	/** Required for pre-populated models because IronCalc exposes no used-range API. */
	sheetDimensions?: Readonly<Record<number, IronCalcSheetDimensions>>;
}

export interface IronCalcFormulaEngine extends FormulaEngine {
	readonly engine: "ironcalc";
	readonly model: Model;
}

let defaultInitialization: Promise<unknown> | null = null;

function initialize(wasm?: InitInput | Promise<InitInput>): Promise<unknown> {
	if (wasm !== undefined) {
		return initializeIronCalc({ module_or_path: wasm });
	}
	defaultInitialization ??= initializeIronCalc();
	return defaultInitialization;
}

function toInput(value: CellValue): string {
	if (value === null) return "";
	if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
	return String(value);
}

function columnName(index: number): string {
	let value = index + 1;
	let output = "";
	while (value > 0) {
		value -= 1;
		output = String.fromCharCode(65 + (value % 26)) + output;
		value = Math.floor(value / 26);
	}
	return output;
}

function addressToA1(address: FormulaEngineAddress): string {
	return `${columnName(address.col)}${address.row + 1}`;
}

function quoteSheetName(name: string): string {
	return /^[A-Za-z_][A-Za-z0-9_.]*$/.test(name)
		? name
		: `'${name.replaceAll("'", "''")}'`;
}

function normalizeDimensions(dimensions: IronCalcSheetDimensions): IronCalcSheetDimensions {
	return {
		rows: Math.max(0, Math.trunc(dimensions.rows)),
		columns: Math.max(0, Math.trunc(dimensions.columns)),
	};
}

function isPermutation(indexOrder: readonly number[]): boolean {
	const values = new Set(indexOrder);
	if (values.size !== indexOrder.length) return false;
	return indexOrder.every((value) => Number.isInteger(value) && value >= 0 && value < indexOrder.length);
}

function parseDisplayValue(model: Model, address: FormulaEngineAddress): CellValue {
	const sheet = address.sheet;
	const row = address.row + 1;
	const column = address.col + 1;
	const content = model.getCellContent(sheet, row, column);
	const display = model.getFormattedCellValue(sheet, row, column);
	const cellType = model.getCellType(sheet, row, column);

	if (content === "" && display === "") return null;
	if (cellType === 4) return display.toUpperCase() === "TRUE";
	if (cellType === 1) {
		const candidate = content.startsWith("=") ? display : content;
		if (/^-?(?:\d+|\d*\.\d+)(?:e[+-]?\d+)?$/i.test(candidate)) {
			return Number(candidate);
		}
	}
	return display;
}

/**
 * Adapt an initialized IronCalc model. Peculiar Sheets remains the undo/history
 * authority; the adapter never calls IronCalc's undo or redo methods.
 */
export function adaptIronCalcModel(
	model: Model,
	options: AdaptIronCalcModelOptions = {},
): IronCalcFormulaEngine {
	const dimensions = new Map<number, IronCalcSheetDimensions>();
	for (const [sheet, value] of Object.entries(options.sheetDimensions ?? {})) {
		dimensions.set(Number(sheet), normalizeDimensions(value));
	}
	for (let sheet = 0; sheet < model.getWorksheetsProperties().length; sheet += 1) {
		if (!dimensions.has(sheet)) dimensions.set(sheet, { rows: 0, columns: 0 });
	}

	const listeners = new Set<(changes?: readonly FormulaEngineAddress[]) => void>();
	let transactionDepth = 0;
	let transactionChanged = false;
	let disposed = false;

	function assertActive() {
		if (disposed) throw new Error("IronCalc formula engine has been disposed.");
	}

	function emit(changes?: readonly FormulaEngineAddress[]) {
		for (const listener of listeners) listener(changes);
	}

	function changed(changes?: readonly FormulaEngineAddress[]) {
		if (transactionDepth > 0) {
			transactionChanged = true;
			return;
		}
		model.evaluate();
		emit(changes);
	}

	function getDimensions(sheetId: number): IronCalcSheetDimensions {
		const value = dimensions.get(sheetId);
		if (!value) throw new Error(`IronCalc sheet ${sheetId} does not exist.`);
		return value;
	}

	function setDimensions(sheetId: number, rows: number, columns: number) {
		dimensions.set(sheetId, normalizeDimensions({ rows, columns }));
	}

	const engine: IronCalcFormulaEngine = {
		engine: "ironcalc",
		model,
		createSheet(name) {
			assertActive();
			model.newSheet();
			const id = model.getWorksheetsProperties().length - 1;
			if (name !== undefined) model.renameSheet(id, name);
			const createdName = model.getWorksheetsProperties()[id]?.name;
			if (!createdName) throw new Error("IronCalc created a sheet without a name.");
			dimensions.set(id, { rows: 0, columns: 0 });
			changed();
			return { id, name: createdName };
		},
		findSheetId(name) {
			const id = model.getWorksheetsProperties().findIndex((sheet) => sheet.name === name);
			return id >= 0 ? id : undefined;
		},
		findSheetName(sheetId) {
			return model.getWorksheetsProperties()[sheetId]?.name;
		},
		formatRange(range: FormulaEngineRange, contextSheetId: number) {
			const targetName = engine.findSheetName(range.start.sheet);
			if (!targetName || range.start.sheet !== range.end.sheet) return undefined;
			const prefix = range.start.sheet === contextSheetId ? "" : `${quoteSheetName(targetName)}!`;
			return `${prefix}${addressToA1(range.start)}:${addressToA1(range.end)}`;
		},
		replaceSheet(sheetId, values) {
			assertActive();
			const previous = getDimensions(sheetId);
			engine.transaction(() => {
				if (previous.rows > 0 && previous.columns > 0) {
					model.rangeClearContents(sheetId, 1, 1, previous.rows, previous.columns);
				}
				let columns = 0;
				for (let row = 0; row < values.length; row += 1) {
					const rowValues = values[row] ?? [];
					columns = Math.max(columns, rowValues.length);
					for (let col = 0; col < rowValues.length; col += 1) {
						model.setUserInput(sheetId, row + 1, col + 1, toInput(rowValues[col] ?? null));
					}
				}
				setDimensions(sheetId, values.length, columns);
				transactionChanged = true;
			});
		},
		serializeSheet(sheetId) {
			assertActive();
			const size = getDimensions(sheetId);
			return Array.from({ length: size.rows }, (_, row) =>
				Array.from({ length: size.columns }, (_, col) => {
					const content = model.getCellContent(sheetId, row + 1, col + 1);
					if (content === "") return null;
					const cellType = model.getCellType(sheetId, row + 1, col + 1);
					if (cellType === 4) return content.toUpperCase() === "TRUE";
					if (cellType === 1 && /^-?(?:\d+|\d*\.\d+)(?:e[+-]?\d+)?$/i.test(content)) {
						return Number(content);
					}
					return content;
				}),
			);
		},
		setCell(address, value) {
			assertActive();
			const size = getDimensions(address.sheet);
			model.setUserInput(address.sheet, address.row + 1, address.col + 1, toInput(value));
			setDimensions(
				address.sheet,
				Math.max(size.rows, address.row + 1),
				Math.max(size.columns, address.col + 1),
			);
			changed([address]);
		},
		getCellValue(address) {
			assertActive();
			return parseDisplayValue(model, address);
		},
		insertRows(sheetId, atIndex, count) {
			assertActive();
			if (!engine.canInsertRows(sheetId, atIndex, count)) {
				throw new Error("Invalid IronCalc row insertion.");
			}
			const size = getDimensions(sheetId);
			model.insertRows(sheetId, atIndex + 1, count);
			setDimensions(sheetId, Math.max(size.rows + count, atIndex + count), size.columns);
			changed();
		},
		canInsertRows(sheetId, atIndex, count) {
			return dimensions.has(sheetId) && Number.isInteger(atIndex) && atIndex >= 0 &&
				Number.isInteger(count) && count > 0;
		},
		deleteRows(sheetId, atIndex, count) {
			assertActive();
			if (!engine.canDeleteRows(sheetId, atIndex, count)) {
				throw new Error("Invalid IronCalc row deletion.");
			}
			const size = getDimensions(sheetId);
			model.deleteRows(sheetId, atIndex + 1, count);
			setDimensions(sheetId, Math.max(0, size.rows - count), size.columns);
			changed();
		},
		canDeleteRows(sheetId, atIndex, count) {
			const size = dimensions.get(sheetId);
			return size !== undefined && Number.isInteger(atIndex) && atIndex >= 0 &&
				Number.isInteger(count) && count > 0 && atIndex + count <= size.rows;
		},
		reorderRows(sheetId, indexOrder) {
			assertActive();
			if (!engine.canReorderRows(sheetId, indexOrder)) {
				throw new Error("Invalid IronCalc row order.");
			}
			const current = indexOrder.map((_, index) => index);
			for (let target = 0; target < indexOrder.length; target += 1) {
				const desired = indexOrder[target];
				const source = current.indexOf(desired ?? -1);
				if (source === target) continue;
				model.moveRow(sheetId, source + 1, target - source);
				const [moved] = current.splice(source, 1);
				if (moved !== undefined) current.splice(target, 0, moved);
			}
			changed();
		},
		canReorderRows(sheetId, indexOrder) {
			return dimensions.get(sheetId)?.rows === indexOrder.length && isPermutation(indexOrder);
		},
		transaction(callback) {
			assertActive();
			const isOuter = transactionDepth === 0;
			if (isOuter) {
				transactionChanged = false;
				model.pauseEvaluation();
			}
			transactionDepth += 1;
			try {
				return callback();
			} finally {
				transactionDepth -= 1;
				if (isOuter) {
					model.resumeEvaluation();
					if (transactionChanged) {
						model.evaluate();
						emit();
					}
				}
			}
		},
		subscribe(listener) {
			assertActive();
			listeners.add(listener);
			return () => { listeners.delete(listener); };
		},
		dispose() {
			if (disposed) return;
			disposed = true;
			listeners.clear();
			if (options.owned === true) model.free();
		},
	};

	return engine;
}

/** Initialize IronCalc WASM and create the recommended Peculiar Sheets engine. */
export async function createIronCalcFormulaEngine(
	options: CreateIronCalcFormulaEngineOptions = {},
): Promise<IronCalcFormulaEngine> {
	await initialize(options.wasm);
	const model = new Model(
		options.name ?? "Peculiar Sheets",
		options.locale ?? "en",
		options.timezone ?? "UTC",
		options.languageId ?? "en",
	);
	return adaptIronCalcModel(model, { owned: true });
}

export function toFormulaEngineConfig(
	engine: IronCalcFormulaEngine,
	options: {
		sheetId?: FormulaEngineConfig["sheetId"];
		sheetName?: string;
		onEngineContentChanged?: () => void;
	} = {},
): FormulaEngineConfig {
	return {
		instance: engine,
		...(options.sheetId === undefined ? {} : { sheetId: options.sheetId }),
		...(options.sheetName === undefined ? {} : { sheetName: options.sheetName }),
		...(options.onEngineContentChanged === undefined
			? {}
			: { onEngineContentChanged: options.onEngineContentChanged }),
	};
}
