import assert from "node:assert/strict";
import { test } from "node:test";
import {
	type BenchmarkResult,
	type ImplementationName,
	MEASUREMENT_PROTOCOL,
} from "../apps/benchmarks/src/types";
import {
	bootstrapRatioInterval,
	evaluateHeadlines,
	headlineVerdict,
	stoppingDecision,
} from "./adaptive-sampling";
import { summarizeOverview } from "./overview";
import type { ReportSnapshot } from "./report";
import { type AdaptiveSamplingMetadata, samplingPlan } from "./sampling";

const RULE = { confidence: 0.95, threshold: 1.2, resamples: 2_000, seed: 1 };

function mount(
	implementation: ImplementationName,
	navigationToReadyMs: number,
	heapBytes: number,
): BenchmarkResult {
	return {
		implementation,
		scenario: "mount-small",
		kind: "mount",
		rows: 1_000,
		columns: 20,
		navigationToReadyMs,
		mountMs: navigationToReadyMs / 2,
		domNodes: 100,
		heapBytesBeforeGc: heapBytes,
		heapBytes,
	};
}

/** Deterministic noise in [-1, 1) for synthetic samples. */
function noise(seed: number): () => number {
	let state = seed;
	return () => {
		state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
		return (state / 2 ** 32) * 2 - 1;
	};
}

/** Runs the runner's per-round loop for one two-library case. */
function simulate(options: {
	own: number;
	competitor: number;
	spread: number;
	minimum?: number;
	maximum?: number;
}) {
	const minimum = options.minimum ?? 4;
	const maximum = options.maximum ?? 12;
	const ownNoise = noise(7);
	const competitorNoise = noise(1_234_567);
	const results: BenchmarkResult[] = [];
	for (let rounds = 1; rounds <= maximum; rounds++) {
		results.push(
			mount("peculiar-sheets", options.own * (1 + options.spread * ownNoise()), 8e6),
			mount("ag-grid", options.competitor * (1 + options.spread * competitorNoise()), 20e6),
		);
		if (rounds < minimum) continue;
		const headlines = evaluateHeadlines("mount-small", results, {
			...RULE,
			measurementProtocol: MEASUREMENT_PROTOCOL,
		});
		const decision = stoppingDecision({ rounds, minimum, maximum, headlines });
		if (decision.stop) return { rounds, reason: decision.reason, headlines, results };
	}
	throw new Error("The stopping rule must stop at the maximum");
}

test("a clearly passing case stops at the minimum as decided", () => {
	const run = simulate({ own: 100, competitor: 200, spread: 0.05 });
	assert.equal(run.rounds, 4);
	assert.equal(run.reason, "decided");
	assert.deepEqual(
		run.headlines.map((headline) => [headline.category, headline.verdict]),
		[
			["opening", "pass"],
			["memory", "pass"],
		],
	);
	const opening = run.headlines[0];
	assert.ok(opening && opening.upper <= 1.2 && opening.ratio === 1);
});

test("a clearly failing case stops at the minimum as decided", () => {
	const run = simulate({ own: 300, competitor: 100, spread: 0.05 });
	assert.equal(run.rounds, 4);
	assert.equal(run.reason, "decided");
	const opening = run.headlines.find((headline) => headline.category === "opening");
	assert.equal(opening?.verdict, "fail");
	assert.ok(opening && opening.lower > 1.2 && opening.ratio > 2.5);
});

test("a noisy case near the threshold reaches the maximum and counts as within 1.2x", () => {
	const run = simulate({ own: 125, competitor: 100, spread: 0.3 });
	assert.equal(run.rounds, 12);
	assert.equal(run.reason, "max-reached");
	const opening = run.headlines.find((headline) => headline.category === "opening");
	assert.equal(opening?.verdict, "undecided");
	assert.ok(opening && opening.lower <= 1.2 && opening.upper > 1.2);
	// The point estimate alone would place this case outside 1.2x.
	assert.ok(opening.ratio > 1.2);
	const adaptiveSampling: AdaptiveSamplingMetadata = {
		...(samplingPlan({}, ["mount-small"]).adaptiveSampling as AdaptiveSamplingMetadata),
		cells: (["peculiar-sheets", "ag-grid"] as const).map((implementation) => ({
			scenario: "mount-small",
			implementation,
			samples: run.rounds,
			stopReason: run.reason,
		})),
		headlines: run.headlines,
	};
	const snapshot: ReportSnapshot = {
		generatedAt: "2026-11-05T00:00:00Z",
		measurementProtocol: MEASUREMENT_PROTOCOL,
		samplingMode: "adaptive",
		iterations: 12,
		adaptiveSampling,
		warmups: 0,
		results: run.results,
	};
	const ranked = summarizeOverview(snapshot).find((category) => category.id === "opening");
	assert.equal(ranked?.cases[0]?.status, "near");
	assert.deepEqual([ranked?.best, ranked?.near, ranked?.behind], [0, 1, 0]);
	// Without the undecided verdict, the same medians fall outside 1.2x.
	const unrecorded = { ...snapshot, adaptiveSampling: { ...adaptiveSampling, headlines: [] } };
	assert.equal(
		summarizeOverview(unrecorded).find((category) => category.id === "opening")?.cases[0]?.status,
		"behind",
	);
});

test("the bootstrap is deterministic for a seed and reselects the best library per resample", () => {
	const groups = [
		{ implementation: "peculiar-sheets" as const, values: [10, 12, 11, 13, 10.5] },
		{ implementation: "ag-grid" as const, values: [9, 14, 10, 12, 11] },
		{ implementation: "revogrid" as const, values: [20, 22, 21, 19, 25] },
	];
	const options = { confidence: 0.95, resamples: 2_000, seed: 1, key: "mount-small/opening" };
	const first = bootstrapRatioInterval(groups, options);
	assert.deepEqual(bootstrapRatioInterval(groups, options), first);
	assert.deepEqual(bootstrapRatioInterval([...groups].reverse(), options), first);
	assert.equal(first.ratio, 1);
	assert.ok(first.lower >= 1 && first.lower <= first.upper);
	assert.throws(
		() => bootstrapRatioInterval(groups.slice(1), options),
		/requires Peculiar Sheets samples/,
	);
});

test("verdicts need the whole interval on one side of the threshold", () => {
	assert.equal(headlineVerdict({ ratio: 1.1, lower: 1, upper: 1.2 }, 1.2), "pass");
	assert.equal(headlineVerdict({ ratio: 1.3, lower: 1.2, upper: 1.4 }, 1.2), "undecided");
	assert.equal(headlineVerdict({ ratio: 1.3, lower: 1.21, upper: 1.4 }, 1.2), "fail");
	const undecided = [{ verdict: "undecided" as const }];
	const decided = [{ verdict: "pass" as const }, { verdict: "fail" as const }];
	const bounds = { minimum: 4, maximum: 12 };
	assert.deepEqual(stoppingDecision({ ...bounds, rounds: 3, headlines: decided }), { stop: false });
	assert.deepEqual(stoppingDecision({ ...bounds, rounds: 4, headlines: decided }), {
		stop: true,
		reason: "decided",
	});
	assert.deepEqual(stoppingDecision({ ...bounds, rounds: 11, headlines: undecided }), {
		stop: false,
	});
	assert.deepEqual(stoppingDecision({ ...bounds, rounds: 12, headlines: undecided }), {
		stop: true,
		reason: "max-reached",
	});
	assert.deepEqual(stoppingDecision({ ...bounds, rounds: 12, headlines: decided }), {
		stop: true,
		reason: "decided",
	});
	assert.deepEqual(stoppingDecision({ ...bounds, rounds: 4, headlines: [] }), {
		stop: true,
		reason: "decided",
	});
});
