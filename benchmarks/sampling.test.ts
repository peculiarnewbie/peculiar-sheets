import assert from "node:assert/strict";
import { test } from "node:test";
import {
	defaultScenarioIterations,
	describeSampling,
	iterationsForScenario,
	sameSamplingCounts,
	sampleOrder,
} from "./sampling";

test("default sample counts balance every run position for two, three, and four libraries", () => {
	for (const iterations of [12, 96]) {
		for (const size of [2, 3, 4]) {
			const libraries = Array.from({ length: size }, (_, i) => `library-${i}`);
			const counts = new Map(libraries.map((l) => [l, new Array<number>(size).fill(0)]));
			for (let iteration = 0; iteration < iterations; iteration++) {
				const order = sampleOrder(libraries, iteration);
				assert.equal(new Set(order).size, size);
				order.forEach((library, position) => {
					const row = counts.get(library);
					if (!row) throw new Error("Unknown library");
					row[position] = (row[position] ?? 0) + 1;
				});
			}
			for (const row of counts.values())
				assert.deepEqual(row, new Array(size).fill(iterations / size));
		}
	}
	assert.deepEqual(sampleOrder([], 0), []);
});

test("the fixed precision count is case-wide and explicit overrides preserve uniform diagnostics", () => {
	const scenarios = ["mount-small", "replace-large-disjoint"] as const;
	const automatic = {
		iterations: 12,
		scenarioIterations: defaultScenarioIterations(scenarios, false),
	};
	assert.equal(iterationsForScenario(automatic, "mount-small"), 12);
	assert.equal(iterationsForScenario(automatic, "replace-large-disjoint"), 96);
	assert.deepEqual(defaultScenarioIterations(["mount-small"], false), {});
	const explicit = {
		iterations: 3,
		scenarioIterations: defaultScenarioIterations(scenarios, true),
	};
	for (const scenario of scenarios) assert.equal(iterationsForScenario(explicit, scenario), 3);
	assert.match(describeSampling(automatic, scenarios), /12–96 runs per case/);
	assert.match(describeSampling(automatic, scenarios), /replace-large-disjoint: 96/);
	assert.equal(describeSampling(automatic, ["replace-large-disjoint"]), "median of 96 runs");
	assert.equal(describeSampling({ iterations: 3 }, scenarios), "median of 3 runs");
});

test("baseline speed comparisons require equal counts for every selected case", () => {
	const old = { iterations: 12 };
	const current = {
		iterations: 12,
		scenarioIterations: { "replace-large-disjoint": 96 },
	};
	assert.equal(sameSamplingCounts(old, current, ["mount-small"]), true);
	assert.equal(sameSamplingCounts(old, current, ["replace-large-disjoint"]), false);
	assert.equal(sameSamplingCounts({ iterations: 96 }, current, ["replace-large-disjoint"]), true);
	assert.equal(sameSamplingCounts({ iterations: 3 }, current, ["mount-small"]), false);
});
