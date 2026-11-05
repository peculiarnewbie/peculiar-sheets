import {
	IMPLEMENTATIONS,
	type ImplementationName,
	SCENARIO_NAMES,
	type ScenarioName,
} from "../apps/benchmarks/src/types";

/**
 * Sequential stopping rule: a case stops once the bootstrap interval of every headline's
 * Peculiar Sheets ÷ best ratio clears the threshold. A change is a sampling change, not a speedup.
 */
export const ADAPTIVE_SAMPLING_PROTOCOL = "sequential-bootstrap-median-ratio-v1";
export const DEFAULT_ITERATIONS = 12;
export const DEFAULT_MIN_ITERATIONS = 4;
export const DEFAULT_CONFIDENCE = 0.95;
export const DEFAULT_RATIO_THRESHOLD = 1.2;
const BOOTSTRAP_RESAMPLES = 2_000;
const BOOTSTRAP_SEED = 1;

export type SamplingMode = "fixed" | "adaptive";
export type StopReason = "decided" | "max-reached";
export type HeadlineVerdict = "pass" | "fail" | "undecided";

export interface AdaptiveCell {
	scenario: ScenarioName;
	implementation: ImplementationName;
	samples: number;
	stopReason: StopReason;
}

export interface AdaptiveHeadline {
	scenario: ScenarioName;
	category: string;
	ratio: number;
	lower: number;
	upper: number;
	verdict: HeadlineVerdict;
}

export interface AdaptiveSamplingMetadata {
	protocol: string;
	minIterations: number;
	confidence: number;
	threshold: number;
	resamples: number;
	seed: number;
	cells: AdaptiveCell[];
	/** Headline intervals at each case's final round. */
	headlines: AdaptiveHeadline[];
}

export interface SamplingMetadata {
	/** Fixed: samples per case. Adaptive: the per-case maximum. */
	iterations: number;
	scenarioIterations?: Partial<Record<ScenarioName, number>>;
	/** Absent in snapshots that predate adaptive sampling; those are fixed. */
	samplingMode?: SamplingMode;
	adaptiveSampling?: AdaptiveSamplingMetadata;
}

/** A fixed precision allowance, applied equally to every library in this case. */
export function defaultScenarioIterations(
	scenarios: readonly ScenarioName[],
	hasGlobalOverride: boolean,
): Partial<Record<ScenarioName, number>> {
	return !hasGlobalOverride && scenarios.includes("replace-large-disjoint")
		? { "replace-large-disjoint": 96 }
		: {};
}

const ADAPTIVE_OPTIONS = [
	"BENCHMARK_MIN_ITERATIONS",
	"BENCHMARK_MAX_ITERATIONS",
	"BENCHMARK_CONFIDENCE",
	"BENCHMARK_RATIO_THRESHOLD",
] as const;

/**
 * Adaptive is the default. An explicit `BENCHMARK_ITERATIONS` keeps the historical fixed plan,
 * as does `BENCHMARK_SAMPLING=fixed`.
 */
export function samplingPlan(
	environment: Readonly<Record<string, string | undefined>>,
	scenarios: readonly ScenarioName[],
): SamplingMetadata {
	const explicitIterations = environment.BENCHMARK_ITERATIONS !== undefined;
	const mode = environment.BENCHMARK_SAMPLING ?? (explicitIterations ? "fixed" : "adaptive");
	if (mode !== "fixed" && mode !== "adaptive")
		throw new Error("BENCHMARK_SAMPLING must be fixed or adaptive");
	if (mode === "fixed") {
		const adaptiveOnly = ADAPTIVE_OPTIONS.filter((name) => environment[name] !== undefined);
		if (adaptiveOnly.length)
			throw new Error(`${adaptiveOnly.join(", ")} only apply to adaptive sampling`);
		const scenarioIterations = defaultScenarioIterations(scenarios, explicitIterations);
		return {
			samplingMode: "fixed",
			iterations: Number(environment.BENCHMARK_ITERATIONS ?? DEFAULT_ITERATIONS),
			...(Object.keys(scenarioIterations).length ? { scenarioIterations } : {}),
		};
	}
	if (explicitIterations)
		throw new Error(
			"BENCHMARK_ITERATIONS selects fixed sampling; use BENCHMARK_MAX_ITERATIONS with adaptive sampling",
		);
	const explicitMaximum = environment.BENCHMARK_MAX_ITERATIONS !== undefined;
	const maximum = Number(environment.BENCHMARK_MAX_ITERATIONS ?? DEFAULT_ITERATIONS);
	const scenarioIterations = defaultScenarioIterations(scenarios, explicitMaximum);
	return {
		samplingMode: "adaptive",
		iterations: maximum,
		...(Object.keys(scenarioIterations).length ? { scenarioIterations } : {}),
		adaptiveSampling: {
			protocol: ADAPTIVE_SAMPLING_PROTOCOL,
			minIterations:
				environment.BENCHMARK_MIN_ITERATIONS === undefined
					? Math.min(DEFAULT_MIN_ITERATIONS, maximum)
					: Number(environment.BENCHMARK_MIN_ITERATIONS),
			confidence: Number(environment.BENCHMARK_CONFIDENCE ?? DEFAULT_CONFIDENCE),
			threshold: Number(environment.BENCHMARK_RATIO_THRESHOLD ?? DEFAULT_RATIO_THRESHOLD),
			resamples: BOOTSTRAP_RESAMPLES,
			seed: BOOTSTRAP_SEED,
			cells: [],
			headlines: [],
		},
	};
}

export function samplingMode(snapshot: SamplingMetadata): SamplingMode {
	return snapshot.samplingMode ?? "fixed";
}

export function iterationsForScenario(snapshot: SamplingMetadata, scenario: ScenarioName): number {
	return snapshot.scenarioIterations?.[scenario] ?? snapshot.iterations;
}

/** The sample count a complete snapshot must contain for one case/library pair. */
export function expectedSamples(
	snapshot: SamplingMetadata,
	scenario: ScenarioName,
	implementation: ImplementationName,
): number | undefined {
	if (!snapshot.adaptiveSampling) return iterationsForScenario(snapshot, scenario);
	return snapshot.adaptiveSampling.cells.find(
		(cell) => cell.scenario === scenario && cell.implementation === implementation,
	)?.samples;
}

export function sameSamplingCounts(
	first: SamplingMetadata,
	second: SamplingMetadata,
	scenarios: readonly ScenarioName[],
): boolean {
	return scenarios.every(
		(scenario) =>
			iterationsForScenario(first, scenario) === iterationsForScenario(second, scenario),
	);
}

/**
 * Fixed plans compare only at equal counts. Adaptive plans compare only under the same
 * stopping rule; their per-case counts legitimately differ between runs. Modes never mix.
 */
export function sameSamplingPlan(
	first: SamplingMetadata,
	second: SamplingMetadata,
	scenarios: readonly ScenarioName[],
): boolean {
	if (samplingMode(first) !== samplingMode(second)) return false;
	const left = first.adaptiveSampling;
	const right = second.adaptiveSampling;
	if (!left || !right) return sameSamplingCounts(first, second, scenarios);
	return (
		sameSamplingCounts(first, second, scenarios) &&
		left.protocol === right.protocol &&
		left.minIterations === right.minIterations &&
		left.confidence === right.confidence &&
		left.threshold === right.threshold &&
		left.resamples === right.resamples &&
		left.seed === right.seed
	);
}

export function validateSampling(snapshot: SamplingMetadata): void {
	if (!Number.isInteger(snapshot.iterations) || snapshot.iterations < 1)
		throw new Error("Invalid default sample count");
	for (const [scenario, count] of Object.entries(snapshot.scenarioIterations ?? {})) {
		if (!SCENARIO_NAMES.some((name) => name === scenario))
			throw new Error(`Unknown sampling scenario: ${scenario}`);
		if (!Number.isInteger(count) || count < 1) throw new Error(`Invalid sample count: ${scenario}`);
	}
	const mode = samplingMode(snapshot);
	if (mode !== "fixed" && mode !== "adaptive") throw new Error(`Unknown sampling mode: ${mode}`);
	const adaptive = snapshot.adaptiveSampling;
	if ((mode === "adaptive") !== (adaptive !== undefined))
		throw new Error("Adaptive sampling requires its stopping-rule metadata");
	if (!adaptive) return;
	const maximum = Math.min(
		snapshot.iterations,
		...Object.values(snapshot.scenarioIterations ?? {}).filter(
			(count): count is number => count !== undefined,
		),
	);
	if (!Number.isInteger(adaptive.minIterations) || adaptive.minIterations < 2)
		throw new Error("Adaptive sampling needs at least two samples per case");
	if (adaptive.minIterations > maximum)
		throw new Error("The adaptive minimum must not exceed the maximum");
	if (!(adaptive.confidence > 0 && adaptive.confidence < 1))
		throw new Error("Adaptive confidence must be between 0 and 1");
	if (!Number.isFinite(adaptive.threshold) || adaptive.threshold <= 0)
		throw new Error("Adaptive ratio threshold must be a positive number");
	if (!Number.isInteger(adaptive.resamples) || adaptive.resamples < 1)
		throw new Error("Invalid bootstrap resample count");
	for (const cell of adaptive.cells) {
		if (!SCENARIO_NAMES.some((name) => name === cell.scenario))
			throw new Error(`Unknown sampling scenario: ${cell.scenario}`);
		if (!IMPLEMENTATIONS.some((name) => name === cell.implementation))
			throw new Error(`Unknown sampling implementation: ${cell.implementation}`);
		if (
			!Number.isInteger(cell.samples) ||
			cell.samples < adaptive.minIterations ||
			cell.samples > iterationsForScenario(snapshot, cell.scenario)
		)
			throw new Error(`Invalid sample count: ${cell.scenario}/${cell.implementation}`);
		if (cell.stopReason !== "decided" && cell.stopReason !== "max-reached")
			throw new Error(`Invalid stop reason: ${cell.scenario}/${cell.implementation}`);
	}
}

/** Cases that reached their maximum before every headline interval cleared the threshold. */
export function maxReachedScenarios(snapshot: SamplingMetadata): ScenarioName[] {
	return [
		...new Set(
			snapshot.adaptiveSampling?.cells
				.filter((cell) => cell.stopReason === "max-reached")
				.map((cell) => cell.scenario) ?? [],
		),
	];
}

export function describeSampling(
	snapshot: SamplingMetadata,
	scenarios: readonly ScenarioName[],
): string {
	const selected = [...new Set(scenarios)];
	const adaptive = snapshot.adaptiveSampling;
	if (adaptive) {
		const rule = `stops when every headline's ${Math.round(adaptive.confidence * 100)}% bootstrap interval clears ${adaptive.threshold}x`;
		const maxima = [
			...new Set(selected.map((scenario) => iterationsForScenario(snapshot, scenario))),
		].sort((left, right) => left - right);
		const counts = adaptive.cells
			.filter((cell) => selected.includes(cell.scenario))
			.map((cell) => cell.samples);
		if (!counts.length)
			return `adaptive median of ${adaptive.minIterations}–${maxima.at(-1) ?? snapshot.iterations} runs per case (${rule})`;
		const reached = maxReachedScenarios(snapshot).filter((scenario) =>
			selected.includes(scenario),
		).length;
		return `adaptive median of ${Math.min(...counts)}–${Math.max(...counts)} runs per case (${rule}; ${reached} of ${selected.length} ${selected.length === 1 ? "case" : "cases"} reached the maximum)`;
	}
	const counts = [
		...new Set(selected.map((scenario) => iterationsForScenario(snapshot, scenario))),
	].sort((left, right) => left - right);
	if (counts.length <= 1) {
		const count = counts[0] ?? snapshot.iterations;
		return `median of ${count} ${count === 1 ? "run" : "runs"}`;
	}
	const overrides = selected
		.filter((scenario) => iterationsForScenario(snapshot, scenario) !== snapshot.iterations)
		.map((scenario) => `${scenario}: ${iterationsForScenario(snapshot, scenario)}`);
	return `median of ${counts[0]}–${counts.at(-1)} runs per case (${overrides.join(", ")})`;
}

/** Rotate equally sized iteration blocks so no implementation always runs first. */
export function sampleOrder<T>(implementations: readonly T[], iteration: number): T[] {
	if (!implementations.length) return [];
	const offset = Math.max(0, iteration) % implementations.length;
	return [...implementations.slice(offset), ...implementations.slice(0, offset)];
}
