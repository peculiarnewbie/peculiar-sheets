/**
 * Basic editing scenarios.
 *
 * Test bodies are declarative `Scenario` data in
 * `packages/sheet-scenarios/src/scenarios/basic.ts`. This file just loops
 * over them, drives each through `StagehandDriver`, and fails via the
 * runner's `hard` mode (the default) so Bun's `it(...)` catches the throw.
 *
 * The same scenario data powers the showcase's live replay view; one source
 * of truth for CI + the marketing demo.
 */

import { beforeAll, describe, it } from "bun:test";
import type { Stagehand } from "@browserbasehq/stagehand";
import { runScenario } from "sheet-scenarios";
import { basicScenarios } from "sheet-scenarios/scenarios";
import { StagehandDriver } from "sheet-scenarios/stagehand";
import { getStagehand } from "./setup";

describe("basic", () => {
	let driver: StagehandDriver;

	beforeAll(async () => {
		const sh: Stagehand = await getStagehand();
		driver = new StagehandDriver(sh);
	});

	for (const scenario of basicScenarios) {
		it(scenario.title, async () => {
			await runScenario(scenario, driver);
		});
	}
});
