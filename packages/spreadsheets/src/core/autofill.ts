import type {
	AutoFillMode,
	CellAddress,
	CellMutation,
	CellRange,
	CellValue,
	ColumnDef,
	FillAxis,
	FillPreview,
	Selection,
} from "../types";
import { normalizeRange, rangeContains } from "./selection";
import { isFormulaValue, shiftFormulaByDelta } from "../formula/references";

export function getAutoFillSourceRange(selection: Selection): CellRange | null {
	if (selection.ranges.length !== 1) return null;
	return normalizeRange(selection.ranges[0]!);
}

export function computeFillPreview(
	sourceRange: CellRange,
	dragTarget: CellAddress,
	axis: FillAxis,
): FillPreview | null {
	if (axis !== "vertical") return null;

	const source = normalizeRange(sourceRange);

	// Clamp the column to the source range so the preview persists even when
	// the cursor drifts horizontally outside the selected columns.
	const clampedTarget: CellAddress = {
		row: dragTarget.row,
		col: Math.max(source.start.col, Math.min(dragTarget.col, source.end.col)),
	};

	if (rangeContains(source, clampedTarget)) return null;

	if (clampedTarget.row > source.end.row) {
		return {
			axis,
			source,
			extension: {
				start: { row: source.end.row + 1, col: source.start.col },
				end: { row: clampedTarget.row, col: source.end.col },
			},
			direction: "down",
		};
	}

	if (clampedTarget.row < source.start.row) {
		return {
			axis,
			source,
			extension: {
				start: { row: clampedTarget.row, col: source.start.col },
				end: { row: source.start.row - 1, col: source.end.col },
			},
			direction: "up",
		};
	}

	return null;
}

export function resolveAutoFillMode(sourceValues: CellValue[]): AutoFillMode {
	if (
		sourceValues.length > 0 &&
		sourceValues.every((value) => isFormulaValue(value))
	) {
		return "formula-copy";
	}

	if (
		sourceValues.length >= 2 &&
		sourceValues.every((value) => typeof value === "number")
	) {
		return "linear-series";
	}

	return "copy";
}

export function buildVerticalFillMutations(
	sourceRange: CellRange,
	preview: FillPreview | null,
	currentCells: CellValue[][],
	columns: ColumnDef[],
): CellMutation[] {
	if (!preview || preview.axis !== "vertical") return [];

	const source = normalizeRange(sourceRange);
	const extension = normalizeRange(preview.extension);
	const width = source.end.col - source.start.col + 1;
	const height = source.end.row - source.start.row + 1;

	if (
		extension.start.col !== source.start.col ||
		extension.end.col !== source.end.col ||
		width <= 0 ||
		height <= 0
	) {
		return [];
	}

	const columnStates = Array.from({ length: width }, (_, offset) => {
		const col = source.start.col + offset;
		const seedValues = Array.from(
			{ length: height },
			(_, rowOffset) => currentCells[source.start.row + rowOffset]?.[col] ?? null,
		);

		return {
			mode: resolveAutoFillMode(seedValues),
			seedValues,
		};
	});

	const mutations: CellMutation[] = [];

	for (let row = extension.start.row; row <= extension.end.row; row++) {
		for (let col = extension.start.col; col <= extension.end.col; col++) {
			const columnOffset = col - source.start.col;
			const column = columns[col];
			if (!column || column.editable === false) continue;

			const destination = { row, col };
			if (rangeContains(source, destination)) continue;

			const columnState = columnStates[columnOffset]!;
			const sourceRow = mapDestinationRowToSourceRow(source, preview, row);
			const sourceValue = currentCells[sourceRow]?.[col] ?? null;
			const nextValue = computeFilledValue(
				columnState.mode,
				columnState.seedValues,
				sourceValue,
				source,
				preview,
				sourceRow,
				row,
			);
			const oldValue = currentCells[row]?.[col] ?? null;
			if (oldValue === nextValue) continue;

			mutations.push({
				address: destination,
				columnId: column.id,
				oldValue,
				newValue: nextValue,
				source: "fill",
			});
		}
	}

	return mutations;
}

function mapDestinationRowToSourceRow(
	source: CellRange,
	preview: FillPreview,
	destinationRow: number,
): number {
	const height = source.end.row - source.start.row + 1;
	if (preview.direction === "down") {
		const offset = destinationRow - (source.end.row + 1);
		return source.start.row + modulo(offset, height);
	}

	const offset = (source.start.row - 1) - destinationRow;
	return source.end.row - modulo(offset, height);
}

function computeFilledValue(
	mode: AutoFillMode,
	seedValues: CellValue[],
	sourceValue: CellValue,
	source: CellRange,
	preview: FillPreview,
	sourceRow: number,
	destinationRow: number,
): CellValue {
	switch (mode) {
		case "formula-copy": {
			if (typeof sourceValue !== "string" || !isFormulaValue(sourceValue)) {
				return sourceValue;
			}

			return shiftFormulaByDelta(
				sourceValue,
				destinationRow - sourceRow,
				0,
			);
		}

		case "linear-series":
			return computeLinearSeriesValue(seedValues, source, preview, destinationRow);

		case "copy":
		default:
			return sourceValue;
	}
}

function computeLinearSeriesValue(
	seedValues: CellValue[],
	source: CellRange,
	preview: FillPreview,
	destinationRow: number,
): CellValue {
	const numericSeed = seedValues as number[];
	const lastSeed = numericSeed[numericSeed.length - 1]!;
	const previousSeed = numericSeed[numericSeed.length - 2]!;
	const step = lastSeed - previousSeed;

	if (preview.direction === "down") {
		const distance = destinationRow - source.end.row;
		return lastSeed + step * distance;
	}

	const firstSeed = numericSeed[0]!;
	const distance = source.start.row - destinationRow;
	return firstSeed - step * distance;
}

function modulo(value: number, divisor: number): number {
	return ((value % divisor) + divisor) % divisor;
}
