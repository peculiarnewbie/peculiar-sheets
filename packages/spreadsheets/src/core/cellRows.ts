import type { CellValue } from "../types";

const PACKED_BLOCK_ROWS = 128;
const MIN_PACKED_ROWS = 4096;

function canPackRows(data: readonly CellValue[][]): boolean {
	if (data.length < MIN_PACKED_ROWS) return false;
	const width = data[0]?.length ?? 0;
	return data.every((row) => {
		if (row.length !== width || row[Symbol.iterator] !== Array.prototype.values) return false;
		// Long blank tails are smaller in the sparse representation below.
		for (let column = width - 1; column >= Math.max(0, width - 16); column--) {
			if (row[column] !== null) return true;
		}
		return width < 16;
	});
}

/** Owned cell storage. Packing saves row headers without retaining host arrays. */
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

	const packedWidth = initialData[0]?.length ?? 0;
	let packedBlocks: Array<CellValue[] | undefined> | undefined;
	let packedRemaining: Uint16Array | undefined;
	let remainingBlocks = 0;
	// Internal slots can be absent until their owned packed values become rows.
	// Public matrix access materializes every slot before returning this array.
	const values: CellValue[][] = canPackRows(initialData)
		? new Array<CellValue[]>(initialData.length)
		: initialData.map(copyInitialRow);
	if (values.length > 0 && values[0] === undefined) {
		const blocks = Math.ceil(initialData.length / PACKED_BLOCK_ROWS);
		packedBlocks = new Array<CellValue[]>(blocks);
		packedRemaining = new Uint16Array(blocks);
		remainingBlocks = blocks;
		for (let index = 0; index < initialData.length; index += PACKED_BLOCK_ROWS) {
			const end = Math.min(initialData.length, index + PACKED_BLOCK_ROWS);
			const block = new Array<CellValue>((end - index) * packedWidth);
			let offset = 0;
			for (let row = index; row < end; row++) {
				const source = initialData[row];
				if (!source) throw new Error(`Missing initial cell row ${row}`);
				for (const value of source) block[offset++] = value;
			}
			const blockIndex = index / PACKED_BLOCK_ROWS;
			packedBlocks[blockIndex] = block;
			packedRemaining[blockIndex] = end - index;
		}
	}

	function getRow(index: number): CellValue[] | undefined {
		const existing = values[index];
		if (existing) return existing;
		const blockIndex = Math.floor(index / PACKED_BLOCK_ROWS);
		const blocks = packedBlocks;
		const block = blocks?.[blockIndex];
		const remaining = packedRemaining;
		if (!blocks || !block || !remaining || index < 0 || index >= values.length) return undefined;
		const start = (index % PACKED_BLOCK_ROWS) * packedWidth;
		const row = block.slice(start, start + packedWidth);
		values[index] = row;
		// A materialized row owns these values now. Release overwritten strings
		// immediately and release each backing block when its last row is read.
		block.fill(null, start, start + packedWidth);
		const count = (remaining[blockIndex] ?? 0) - 1;
		remaining[blockIndex] = count;
		if (count === 0) {
			blocks[blockIndex] = undefined;
			remainingBlocks--;
			if (remainingBlocks === 0) {
				packedBlocks = undefined;
				packedRemaining = undefined;
			}
		}
		return row;
	}

	function readCell(row: number, column: number): CellValue | undefined {
		const existing = values[row];
		if (existing) return existing[column];
		if (column < 0 || column >= packedWidth || row < 0 || row >= values.length) return undefined;
		return packedBlocks?.[Math.floor(row / PACKED_BLOCK_ROWS)]?.[
			(row % PACKED_BLOCK_ROWS) * packedWidth + column
		];
	}

	function copy(): CellValue[][] {
		return Array.from({ length: values.length }, (_, index) => {
			const existing = values[index];
			if (existing) return copyRow(existing);
			const block = packedBlocks?.[Math.floor(index / PACKED_BLOCK_ROWS)];
			if (!block) throw new Error(`Missing owned cell row ${index}`);
			const start = (index % PACKED_BLOCK_ROWS) * packedWidth;
			return block.slice(start, start + packedWidth);
		});
	}

	function materializePacked(): void {
		if (!packedBlocks) return;
		for (let index = 0; index < values.length; index++) getRow(index);
	}

	function materialize(): CellValue[][] {
		materializePacked();
		if (hasCompactRows) {
			for (const row of values) {
				const length = logicalRowLength(row);
				const storedLength = row.length;
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
		packedBlocks = undefined;
		packedRemaining = undefined;
		remainingBlocks = 0;
		values.length = 0;
		for (const row of rows) values.push(row);
	}

	return {
		values,
		getRow,
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
