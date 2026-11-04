import { SCENARIO_NAMES, type ScenarioName } from "../apps/benchmarks/src/types";

export interface SamplingMetadata {
	iterations: number;
	scenarioIterations?: Partial<Record<ScenarioName, number>>;
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

export function iterationsForScenario(snapshot: SamplingMetadata, scenario: ScenarioName): number {
	return snapshot.scenarioIterations?.[scenario] ?? snapshot.iterations;
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

export function validateSampling(snapshot: SamplingMetadata): void {
	if (!Number.isInteger(snapshot.iterations) || snapshot.iterations < 1)
		throw new Error("Invalid default sample count");
	for (const [scenario, count] of Object.entries(snapshot.scenarioIterations ?? {})) {
		if (!SCENARIO_NAMES.some((name) => name === scenario))
			throw new Error(`Unknown sampling scenario: ${scenario}`);
		if (!Number.isInteger(count) || count < 1) throw new Error(`Invalid sample count: ${scenario}`);
	}
}

export function describeSampling(
	snapshot: SamplingMetadata,
	scenarios: readonly ScenarioName[],
): string {
	const selected = [...new Set(scenarios)];
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
