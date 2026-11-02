import type { BenchmarkCellValue, BenchmarkDataset, BenchmarkScenario } from "./types";

export function createDataset(scenario: BenchmarkScenario): BenchmarkDataset {
	const { rows, columns } = scenario;
	return {
		rows,
		columns,
		rowIds: Array.from({ length: rows }, (_, row) => `initial-${row}`),
		values: Array.from({ length: rows }, (_, row) =>
			Array.from({ length: columns }, (_, column): BenchmarkCellValue => {
				const index = row * columns + column;
				if (scenario.kind === "mount" && scenario.dataShape === "sparse")
					return index % 20 === 0 ? index : null;
				if (scenario.kind === "mount" && scenario.dataShape === "mixed") {
					switch (index % 5) {
						case 0:
							return index;
						case 1:
							return `Record ${row}, column ${column}`;
						case 2:
							return null;
						case 3:
							return row % 2 === 0;
						default:
							return `Long text ${row}: ${"spreadsheet data ".repeat(12)}`;
					}
				}
				return index;
			}),
		),
	};
}

export function createReplacementDataset(
	scenario: Extract<BenchmarkScenario, { kind: "replace" }>,
	initial: BenchmarkDataset,
): BenchmarkDataset {
	if (scenario.replacement === "retained" || scenario.replacement === "filter-roundtrip") {
		const start = Math.max(0, initial.rows - scenario.replacementRows);
		return {
			rows: scenario.replacementRows,
			columns: scenario.columns,
			rowIds: initial.rowIds.slice(start),
			values: initial.values.slice(start).map((row) => [...row]),
		};
	}
	if (scenario.replacement === "few-cells") {
		const values = initial.values.map((row) => [...row]);
		for (const row of [0, Math.floor(initial.rows / 2), initial.rows - 1])
			if (values[row]) values[row][0] = `changed-${row}`;
		return { ...initial, values };
	}
	if (scenario.replacement === "reorder") {
		return {
			...initial,
			rowIds: initial.rowIds.slice().reverse(),
			values: initial.values
				.slice()
				.reverse()
				.map((row) => [...row]),
		};
	}
	if (scenario.replacement === "insert-delete") {
		const at = Math.floor(initial.rows / 2);
		const count = scenario.replacementRows - initial.rows;
		return {
			rows: scenario.replacementRows,
			columns: initial.columns,
			rowIds: [
				...initial.rowIds.slice(0, at),
				...Array.from({ length: count }, (_, row) => `inserted-${row}`),
				...initial.rowIds.slice(at),
			],
			values: [
				...initial.values.slice(0, at).map((row) => [...row]),
				...Array.from({ length: count }, (_, row) =>
					Array.from({ length: initial.columns }, (_, column) => `inserted-${row}:${column}`),
				),
				...initial.values.slice(at).map((row) => [...row]),
			],
		};
	}
	return {
		rows: scenario.replacementRows,
		columns: scenario.columns,
		rowIds: Array.from({ length: scenario.replacementRows }, (_, row) => `replacement-${row}`),
		values: Array.from({ length: scenario.replacementRows }, (_, row) =>
			Array.from(
				{ length: scenario.columns },
				(_, column) => 1_000_000 + row * scenario.columns + column,
			),
		),
	};
}
