import assert from "node:assert/strict";
import { test } from "node:test";
import { createDataset, createReplacementDataset } from "../apps/benchmarks/src/datasets";
import { SCENARIOS, scenarioSkip } from "../apps/benchmarks/src/scenarios";
import { SCENARIO_NAMES } from "../apps/benchmarks/src/types";

test("all scenario IDs resolve and unsupported editions have explicit reasons", () => {
	assert.deepEqual(Object.keys(SCENARIOS), [...SCENARIO_NAMES]);
	assert.equal(scenarioSkip("ag-grid", "paste-large")?.category, "unsupported");
	assert.equal(scenarioSkip("revogrid", "clear-undo-redo")?.category, "unsupported");
	assert.equal(scenarioSkip("gridsheet", "edit-commit")?.category, "adapter");
	assert.equal(scenarioSkip("handsontable", "paste-large"), undefined);
	assert.equal(scenarioSkip("ag-grid", "keyboard-navigation"), undefined);
});

test("structural replacement changes preserve source data and unique row identities", () => {
	const initial = createDataset({ ...SCENARIOS["mount-small"], rows: 20, columns: 4 });
	for (const name of ["row-reorder", "row-insert-delete", "replace-wide-retained"] as const) {
		const scenario = SCENARIOS[name];
		assert.equal(scenario.kind, "replace");
		if (scenario.kind !== "replace") throw new Error("Expected replacement scenario");
		const result = createReplacementDataset(
			{
				...scenario,
				rows: 20,
				columns: 4,
				replacementRows: name === "row-insert-delete" ? 25 : name === "row-reorder" ? 20 : 5,
			},
			initial,
		);
		assert.equal(result.rowIds.length, result.rows);
		assert.equal(new Set(result.rowIds).size, result.rows);
		assert.equal(result.values.length, result.rows);
		assert(result.values.every((row) => row.length === 4));
		for (const [index, id] of result.rowIds.entries()) {
			const previousIndex = initial.rowIds.indexOf(id);
			if (previousIndex >= 0) assert.deepEqual(result.values[index], initial.values[previousIndex]);
		}
	}
	assert.equal(initial.values[0]?.[0], 0);
	assert.equal(initial.rowIds[0], "initial-0");
});

test("blank-heavy and mixed workloads retain their intended data distributions", () => {
	const sparse = createDataset({ ...SCENARIOS["mount-sparse"], rows: 10, columns: 20 });
	assert.equal(sparse.values.flat().filter((value) => value !== null).length, 10);
	const mixed = createDataset({ ...SCENARIOS["mount-mixed"], rows: 10, columns: 20 });
	assert.deepEqual(mixed.values[0]?.slice(0, 4), [0, "Record 0, column 1", null, true]);
});
