import assert from "node:assert/strict";
import { test } from "node:test";
import {
	defaultScenarioIterations,
	describeSampling,
	iterationsForScenario,
	sameSamplingCounts,
	sameSamplingPlan,
	sampleOrder,
	samplingPlan,
	validateSampling,
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

test("adaptive is the default and an explicit iteration count keeps the fixed plan", () => {
	const scenarios = ["mount-small", "replace-large-disjoint"] as const;
	const adaptive = samplingPlan({}, scenarios);
	assert.equal(adaptive.samplingMode, "adaptive");
	assert.equal(adaptive.iterations, 12);
	assert.equal(iterationsForScenario(adaptive, "replace-large-disjoint"), 96);
	assert.deepEqual(
		[
			adaptive.adaptiveSampling?.minIterations,
			adaptive.adaptiveSampling?.confidence,
			adaptive.adaptiveSampling?.threshold,
		],
		[4, 0.95, 1.2],
	);
	assert.match(describeSampling(adaptive, scenarios), /adaptive median of 4–96 runs per case/);
	assert.deepEqual(samplingPlan({ BENCHMARK_ITERATIONS: "5" }, scenarios), {
		samplingMode: "fixed",
		iterations: 5,
	});
	assert.deepEqual(samplingPlan({ BENCHMARK_SAMPLING: "fixed" }, scenarios), {
		samplingMode: "fixed",
		iterations: 12,
		scenarioIterations: { "replace-large-disjoint": 96 },
	});
	const tuned = samplingPlan(
		{
			BENCHMARK_MIN_ITERATIONS: "3",
			BENCHMARK_MAX_ITERATIONS: "8",
			BENCHMARK_CONFIDENCE: "0.9",
			BENCHMARK_RATIO_THRESHOLD: "1.1",
		},
		scenarios,
	);
	assert.equal(iterationsForScenario(tuned, "replace-large-disjoint"), 8);
	assert.deepEqual(
		[
			tuned.adaptiveSampling?.minIterations,
			tuned.adaptiveSampling?.confidence,
			tuned.adaptiveSampling?.threshold,
		],
		[3, 0.9, 1.1],
	);
	assert.equal(
		samplingPlan({ BENCHMARK_MAX_ITERATIONS: "3" }, scenarios).adaptiveSampling?.minIterations,
		3,
	);
	assert.throws(
		() => samplingPlan({ BENCHMARK_SAMPLING: "adaptive", BENCHMARK_ITERATIONS: "5" }, scenarios),
		/BENCHMARK_MAX_ITERATIONS/,
	);
	assert.throws(
		() => samplingPlan({ BENCHMARK_ITERATIONS: "5", BENCHMARK_MIN_ITERATIONS: "2" }, scenarios),
		/only apply to adaptive sampling/,
	);
	assert.throws(() => samplingPlan({ BENCHMARK_SAMPLING: "sometimes" }, scenarios), /fixed or/);
	for (const environment of [
		{ BENCHMARK_MAX_ITERATIONS: "1" },
		{ BENCHMARK_MIN_ITERATIONS: "13" },
		{ BENCHMARK_CONFIDENCE: "1" },
		{ BENCHMARK_RATIO_THRESHOLD: "0" },
	])
		assert.throws(() => validateSampling(samplingPlan(environment, scenarios)));
});

test("baseline comparisons never mix fixed and adaptive plans", () => {
	const scenarios = ["mount-small"] as const;
	const fixed = samplingPlan({ BENCHMARK_SAMPLING: "fixed" }, scenarios);
	const adaptive = samplingPlan({}, scenarios);
	const settings = adaptive.adaptiveSampling;
	if (!settings) throw new Error("Expected adaptive settings");
	const decided = {
		...adaptive,
		adaptiveSampling: {
			...settings,
			cells: [
				{
					scenario: "mount-small" as const,
					implementation: "ag-grid" as const,
					samples: 5,
					stopReason: "decided" as const,
				},
			],
		},
	};
	assert.equal(sameSamplingPlan(fixed, adaptive, scenarios), false);
	assert.equal(sameSamplingPlan({ iterations: 12 }, adaptive, scenarios), false);
	assert.equal(sameSamplingPlan({ iterations: 12 }, fixed, scenarios), true);
	assert.equal(sameSamplingPlan(adaptive, decided, scenarios), true);
	assert.equal(
		sameSamplingPlan(
			adaptive,
			{ ...adaptive, adaptiveSampling: { ...settings, confidence: 0.9 } },
			scenarios,
		),
		false,
	);
	assert.throws(
		() => validateSampling({ ...fixed, adaptiveSampling: settings }),
		/requires its stopping-rule metadata/,
	);
	assert.throws(
		() =>
			validateSampling({
				...decided,
				adaptiveSampling: {
					...decided.adaptiveSampling,
					cells: [{ ...decided.adaptiveSampling.cells[0], samples: 13 }],
				},
			}),
		/Invalid sample count/,
	);
});
