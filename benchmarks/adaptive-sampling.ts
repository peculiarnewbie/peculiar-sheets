import type { BenchmarkResult, ScenarioName } from "../apps/benchmarks/src/types";
import { type HeadlineGroup, scenarioHeadlines } from "./overview";
import type {
	AdaptiveHeadline,
	AdaptiveSamplingMetadata,
	HeadlineVerdict,
	StopReason,
} from "./sampling";

export interface RatioInterval {
	ratio: number;
	lower: number;
	upper: number;
}

type StoppingRule = Pick<
	AdaptiveSamplingMetadata,
	"confidence" | "threshold" | "resamples" | "seed"
>;

/** Sorts in place; callers pass scratch buffers. */
function medianInPlace(values: Float64Array): number {
	values.sort();
	const middle = values.length >> 1;
	return values.length % 2
		? (values[middle] ?? 0)
		: ((values[middle - 1] ?? 0) + (values[middle] ?? 0)) / 2;
}

/** Peculiar Sheets ÷ best median, matching the overview's best-of-all-libraries rule. */
function ratioToBest(own: number, best: number): number {
	if (best > 0) return own / best;
	return own === best ? 1 : Number.POSITIVE_INFINITY;
}

/** FNV-1a, so each headline draws an independent but reproducible stream. */
function hashSeed(seed: number, key: string): number {
	let hash = (2166136261 ^ seed) >>> 0;
	for (let index = 0; index < key.length; index++) {
		hash ^= key.charCodeAt(index);
		hash = Math.imul(hash, 16777619) >>> 0;
	}
	return hash;
}

/** mulberry32: small, fast and deterministic across platforms. */
function random(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let value = state;
		value = Math.imul(value ^ (value >>> 15), value | 1);
		value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
		return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
	};
}

/**
 * Percentile bootstrap of the median ratio. Each library is resampled independently with
 * replacement; the best library is re-chosen in every resample, as the overview would.
 */
export function bootstrapRatioInterval(
	groups: readonly HeadlineGroup[],
	options: Pick<StoppingRule, "confidence" | "resamples" | "seed"> & { key: string },
): RatioInterval {
	const ownIndex = groups.findIndex((group) => group.implementation === "peculiar-sheets");
	if (ownIndex < 0) throw new Error("A headline ratio requires Peculiar Sheets samples");
	if (groups.some((group) => !group.values.length))
		throw new Error("Every headline library needs at least one sample");
	const point = groups.map((group) => medianInPlace(Float64Array.from(group.values)));
	const ratio = ratioToBest(point[ownIndex] ?? 0, Math.min(...point));
	const next = random(hashSeed(options.seed, options.key));
	const scratch = groups.map((group) => new Float64Array(group.values.length));
	const medians = new Float64Array(groups.length);
	const ratios = new Float64Array(options.resamples);
	for (let resample = 0; resample < options.resamples; resample++) {
		for (let index = 0; index < groups.length; index++) {
			const values = groups[index]?.values ?? [];
			const buffer = scratch[index] ?? new Float64Array(0);
			for (let draw = 0; draw < buffer.length; draw++)
				buffer[draw] = values[Math.floor(next() * values.length)] ?? 0;
			medians[index] = medianInPlace(buffer);
		}
		ratios[resample] = ratioToBest(medians[ownIndex] ?? 0, Math.min(...medians));
	}
	ratios.sort();
	const tail = (1 - options.confidence) / 2;
	const last = options.resamples - 1;
	return {
		ratio,
		lower: ratios[Math.floor(tail * last)] ?? ratio,
		upper: ratios[Math.ceil((1 - tail) * last)] ?? ratio,
	};
}

/** Decided only when the whole interval lies on one side of the threshold. */
export function headlineVerdict(interval: RatioInterval, threshold: number): HeadlineVerdict {
	if (interval.upper <= threshold) return "pass";
	if (interval.lower > threshold) return "fail";
	return "undecided";
}

export function evaluateHeadlines(
	scenario: ScenarioName,
	results: readonly BenchmarkResult[],
	options: StoppingRule & { measurementProtocol: string | undefined },
): AdaptiveHeadline[] {
	return scenarioHeadlines(scenario, results, options.measurementProtocol).map(
		({ category, groups }) => {
			const interval = bootstrapRatioInterval(groups, {
				...options,
				key: `${scenario}/${category}`,
			});
			return {
				scenario,
				category,
				...interval,
				verdict: headlineVerdict(interval, options.threshold),
			};
		},
	);
}

export type StoppingDecision = { stop: false } | { stop: true; reason: StopReason };

/** Evaluated after each complete round, once every library in the case has the same count. */
export function stoppingDecision(options: {
	rounds: number;
	minimum: number;
	maximum: number;
	headlines: readonly Pick<AdaptiveHeadline, "verdict">[];
}): StoppingDecision {
	if (options.rounds < options.minimum) return { stop: false };
	if (options.headlines.every((headline) => headline.verdict !== "undecided"))
		return { stop: true, reason: "decided" };
	if (options.rounds >= options.maximum) return { stop: true, reason: "max-reached" };
	return { stop: false };
}
