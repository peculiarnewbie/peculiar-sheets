/**
 * Scenario registry — keyed by `demoId` so both the Bun tests and the showcase
 * `ScenarioPlayer` can look up the list of scenarios for a given demo.
 *
 * Adding a new test file during the full rollout means:
 *   1. Create `scenarios/<file>.ts` exporting a `Scenario[]`.
 *   2. Register it here under its `demoId`.
 *   3. Update the corresponding `tests/e2e/<file>.test.ts` to loop via `runScenario`.
 */

import type { Scenario } from "../types";
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

export { basicScenarios };
