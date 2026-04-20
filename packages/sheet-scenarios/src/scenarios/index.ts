/**
 * Scenario registry — keyed by `demoId` so both the Bun tests and the showcase
 * `ScenarioPlayer` can look up the list of scenarios for a given demo.
 *
 * Adding a new test file during the full rollout means:
 *   1. Create `scenarios/<file>.ts` exporting a `Scenario[]`.
 *   2. Register it here under its `demoId`.
 *   3. Update the corresponding `tests/e2e/<file>.test.ts` to loop via `runScenario`.
 */

import type { Scenario, Step } from "../types";
import { basicScenarios } from "./basic";

export const SCENARIOS: Record<string, Scenario[]> = {
	basic: basicScenarios,
};

/** Look up scenarios for a demo id. Returns `[]` when the demo has no scenarios yet. */
export function getScenariosFor(demoId: string): Scenario[] {
	return SCENARIOS[demoId] ?? [];
}

/** Flat list of every scenario — used by the Bun top-level test index. */
export const ALL_SCENARIOS: Scenario[] = Object.values(SCENARIOS).flat();

/**
 * Minimum number of non-assertion steps a scenario must have to qualify as a
 * "real" demo. Scenarios below this threshold (e.g. "click a cell and assert
 * selection") are auto-culled from the Replay picker — they're valid tests
 * but too trivial to watch.
 */
const MIN_ACTION_STEPS_FOR_REPLAY = 2;

/** An "action" step is anything that mutates UI state. Assertion steps (which
 *  only read) don't count toward the replay-worthiness threshold. */
function isActionStep(step: Step): boolean {
	return !step.kind.startsWith("assert");
}

/**
 * True when the scenario is meaty enough for the Replay trailer: passes the
 * action-step threshold and hasn't been manually opted-out via `skipInReplay`.
 */
export function isReplayable(scenario: Scenario): boolean {
	if (scenario.skipInReplay) return false;
	const actionSteps = scenario.steps.filter(isActionStep).length;
	return actionSteps >= MIN_ACTION_STEPS_FOR_REPLAY;
}

/**
 * Scenarios for a demo, filtered for the showcase Replay picker. Drops:
 *   - scenarios flagged `skipInReplay: true`
 *   - scenarios with fewer than 2 action steps (e.g. "click-and-assert")
 *
 * The Bun tests still see the full list via `getScenariosFor` / `ALL_SCENARIOS`.
 */
export function getReplayScenariosFor(demoId: string): Scenario[] {
	return getScenariosFor(demoId).filter(isReplayable);
}

export { basicScenarios };
