import type { CellValue } from "../types";

const BLOCK_ROWS = 128;
// Amortize the buffer and block metadata over enough row headers.
const MIN_BLOCK_ROWS = 32;
const MAX_CACHED_VIEWS = BLOCK_ROWS * 2;
// A conservative estimate of per-row array metadata. Smaller sheets keep
// ordinary arrays to avoid conversion costs for less than 1 MiB of savings.
const ESTIMATED_ROW_METADATA_BYTES = 24;
const MIN_METADATA_SAVINGS_BYTES = 1024 * 1024;
export type CellRowValues = readonly CellValue[] | Readonly<Int32Array>;
interface NumericBlock {
	values: Int32Array;
	width: number;
	count: number;
	remaining: number;
}
const isInt32 = (value: CellValue): value is number =>
	typeof value === "number" &&
	Number.isInteger(value) &&
	value >= -2147483648 &&
	value <= 2147483647 &&
	!Object.is(value, -0);

/** Own all input values synchronously; compact integer rows share bounded buffers. */
export function createCellRows(initialData: readonly CellValue[][]) {
	let logicalRowLengths = new WeakMap<CellValue[], number>();
	let hasCompactRows = false;
	function copyInitialRow(source: CellValue[]): CellValue[] {
		let end = source.length;
		while (end > 0 && source[end - 1] === null) end--;
		if (source.length - end < 16) return [...source];
		const row = [...source.slice(0, end)];
		logicalRowLengths.set(row, source.length);
		hasCompactRows = true;
		return row;
	}
	function logicalRowLength(row: CellValue[]): number {
		return hasCompactRows
			? Math.max(row.length, logicalRowLengths.get(row) ?? row.length)
			: row.length;
	}
	function copyRow(row: CellValue[]): CellValue[] {
		const length = logicalRowLength(row);
		if (length === row.length) return [...row];
		const copy = new Array<CellValue>(length).fill(null);
		let column = 0;
		for (const value of row) copy[column++] = value;
		return copy;
	}
	function canPack(rows: CellValue[][], width: number): rows is number[][] {
		if (rows.length < MIN_BLOCK_ROWS || width === 0) return false;
		for (const row of rows)
			if (!row || row.length !== width || logicalRowLength(row) !== width || !row.every(isInt32))
				return false;
		return true;
	}
	const allowPacking =
		initialData.length * ESTIMATED_ROW_METADATA_BYTES >= MIN_METADATA_SAVINGS_BYTES;
	const values: CellValue[][] = allowPacking
		? new Array(initialData.length)
		: initialData.map(copyInitialRow);
	const blocks: Array<NumericBlock | undefined> = [];
	const views = new Map<number, Int32Array>();
	let activeBlocks = 0;
	for (let start = 0; allowPacking && start < initialData.length; start += BLOCK_ROWS) {
		const end = Math.min(start + BLOCK_ROWS, initialData.length),
			copies: CellValue[][] = [];
		for (let index = start; index < end; index++) {
			if (!(index in initialData)) {
				copies.length++;
				continue;
			}
			const source = initialData[index];
			if (!source) throw new Error(`Missing initial cell row ${index}`);
			// Inspect the owned copy, so host getters/iterators are not invoked twice.
			copies.push(copyInitialRow(source));
		}
		const width = copies[0]?.length ?? 0;
		if (canPack(copies, width)) {
			const packed = new Int32Array(copies.length * width);
			let offset = 0;
			for (const row of copies) {
				packed.set(row, offset);
				offset += width;
			}
			blocks[start / BLOCK_ROWS] = {
				values: packed,
				width,
				count: copies.length,
				remaining: copies.length,
			};
			activeBlocks++;
		} else
			for (let index = 0; index < copies.length; index++) {
				const row = copies[index];
				if (row) values[start + index] = row;
			}
	}
	/** Internal read-only views stay bounded as the viewport traverses the sheet. */
	function readRow(index: number): CellRowValues | undefined {
		const existing = values[index];
		if (existing) return existing;
		const block = blocks[Math.floor(index / BLOCK_ROWS)];
		if (!block || !Number.isInteger(index) || index < 0 || index >= values.length) return undefined;
		let view = views.get(index);
		if (!view) {
			const start = (index % BLOCK_ROWS) * block.width;
			view = block.values.subarray(start, start + block.width);
			if (views.size >= MAX_CACHED_VIEWS) {
				const oldest = views.keys().next().value;
				if (oldest !== undefined) views.delete(oldest);
			}
			views.set(index, view);
		}
		return view;
	}
	function readCell(row: number, column: number): CellValue | undefined {
		const existing = values[row];
		if (existing) return existing[column];
		const block = blocks[Math.floor(row / BLOCK_ROWS)];
		if (
			!block ||
			!Number.isInteger(row) ||
			row < 0 ||
			row >= values.length ||
			column < 0 ||
			column >= block.width
		)
			return undefined;
		return block.values[(row % BLOCK_ROWS) * block.width + column];
	}
	function releaseBlock(index: number): void {
		const block = blocks[index];
		if (!block) return;
		const first = index * BLOCK_ROWS;
		for (let local = 0; local < block.count; local++) {
			const row = first + local;
			if (values[row]) continue;
			const start = local * block.width;
			values[row] = Array.from(block.values.subarray(start, start + block.width));
			views.delete(row);
		}
		blocks[index] = undefined;
		activeBlocks--;
	}
	/** Obtain an ordinary mutable row for structural operations and history. */
	function getRow(index: number): CellValue[] | undefined {
		const existing = values[index];
		if (existing) return existing;
		const blockIndex = Math.floor(index / BLOCK_ROWS),
			block = blocks[blockIndex];
		if (!block || !Number.isInteger(index) || index < 0 || index >= values.length) return undefined;
		const start = (index % BLOCK_ROWS) * block.width,
			row = Array.from<CellValue>(block.values.subarray(start, start + block.width));
		values[index] = row;
		views.delete(index);
		block.remaining--;
		// Once edits make at least half a block ordinary rows, release its duplicate
		// backing storage instead of retaining both representations indefinitely.
		if (block.remaining <= block.count / 2) releaseBlock(blockIndex);
		return row;
	}
	function materializePacked(): void {
		if (activeBlocks === 0) return;
		for (let index = 0; index < blocks.length; index++) releaseBlock(index);
	}
	function copy(): CellValue[][] {
		const result: CellValue[][] = new Array(values.length);
		for (let index = 0; index < values.length; index++) {
			const existing = values[index];
			if (existing) {
				result[index] = copyRow(existing);
				continue;
			}
			const block = blocks[Math.floor(index / BLOCK_ROWS)];
			if (!block) continue;
			const start = (index % BLOCK_ROWS) * block.width;
			result[index] = Array.from<CellValue>(block.values.subarray(start, start + block.width));
		}
		return result;
	}
	function materialize(): CellValue[][] {
		materializePacked();
		if (hasCompactRows) {
			for (const row of values) {
				if (!row) continue;
				const length = logicalRowLength(row),
					storedLength = row.length;
				if (storedLength < length) {
					row.length = length;
					row.fill(null, storedLength);
				}
			}
			logicalRowLengths = new WeakMap();
			hasCompactRows = false;
		}
		return values;
	}
	function write(row: number, column: number, value: CellValue, colCount: number): void {
		const block = values[row] ? undefined : blocks[Math.floor(row / BLOCK_ROWS)];
		if (
			block &&
			Number.isInteger(row) &&
			Number.isInteger(column) &&
			row >= 0 &&
			row < values.length &&
			column >= 0 &&
			column < block.width &&
			isInt32(value)
		) {
			block.values[(row % BLOCK_ROWS) * block.width + column] = value;
			return;
		}
		while (values.length <= row) values.push(new Array<CellValue>(colCount).fill(null));
		const target = getRow(row);
		if (!target) throw new Error(`Missing owned cell row ${row}`);
		while (target.length <= column) target.push(null);
		target[column] = value;
	}
	function mutate(update: (rows: CellValue[][]) => void): void {
		materializePacked();
		update(values);
	}
	function replace(rows: readonly CellValue[][]): void {
		if (rows === values) return;
		blocks.length = 0;
		activeBlocks = 0;
		views.clear();
		values.length = 0;
		for (const row of rows) values.push(row);
	}
	return {
		values,
		getRow,
		readRow,
		readCell,
		copyRow,
		logicalRowLength,
		copy,
		materialize,
		write,
		mutate,
		replace,
	};
}
