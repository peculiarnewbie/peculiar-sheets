/**
 * Shared scenario runner.
 *
 * Walks `scenario.steps`, dispatches each to the given `Driver`, and emits
 * `ScenarioEvent`s for progress + assertion outcomes.
 *
 * - CI (StagehandDriver, `defaultAssertMode: "hard"`): assertion failures throw.
 *   Bun's `it(...)`/`expect(...)` catches the throw and fails the test.
 * - Showcase (DomDriver, `defaultAssertMode: "soft"`): assertion failures emit
 *   an `assert-fail` event and playback continues — the UI shows a red pip.
 *
 * Action-step errors (driver errors, invalid coords, missing DOM) always throw —
 * those represent broken scenarios, not expected runtime failures.
 */

import type {
	AssertMode,
	AssertStep,
	Driver,
	Scenario,
	ScenarioEventHandler,
	Step,
} from "./types";
import { AssertionError } from "./types";

export interface RunScenarioOptions {
	/** Callback for every runner event — progress, assertions, done. */
	onEvent?: ScenarioEventHandler;
	/** Fallback assert mode when a step doesn't specify one. Default: "hard". */
	defaultAssertMode?: AssertMode;
	/**
	 * Skip the driver's `navigate`/`reset` entrypoint — useful for running
	 * multiple scenarios back-to-back against the same driver without a full
	 * page reload. Each scenario still calls `clearMutations` if configured.
	 */
	skipNavigate?: boolean;
}

function isAssertStep(step: Step): step is AssertStep {
	return step.kind.startsWith("assert");
}

function deepEqual(a: unknown, b: unknown): boolean {
	if (a === b) return true;
	if (a == null || b == null) return false;
	if (typeof a !== "object" || typeof b !== "object") return false;
	if (Array.isArray(a) !== Array.isArray(b)) return false;
	if (Array.isArray(a) && Array.isArray(b)) {
		if (a.length !== b.length) return false;
		for (let i = 0; i < a.length; i++) {
			if (!deepEqual(a[i], b[i])) return false;
		}
		return true;
	}
	const ka = Object.keys(a as object);
	const kb = Object.keys(b as object);
	if (ka.length !== kb.length) return false;
	for (const k of ka) {
		if (!deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) {
			return false;
		}
	}
	return true;
}

async function executeStep(driver: Driver, step: Step, stepIndex: number): Promise<void> {
	switch (step.kind) {
		case "click": {
			const opts: { shift?: boolean; button?: "left" | "right" } = {};
			if (step.shift !== undefined) opts.shift = step.shift;
			if (step.button !== undefined) opts.button = step.button;
			await driver.click(step.at.row, step.at.col, opts);
			return;
		}
		case "doubleClick":
			await driver.doubleClick(step.at.row, step.at.col);
			return;
		case "shiftClick":
			await driver.click(step.at.row, step.at.col, { shift: true });
			return;
		case "rightClick":
			await driver.rightClickCell(step.at.row, step.at.col);
			return;
		case "type": {
			const opts: { confirm?: boolean } = {};
			if (step.confirm !== undefined) opts.confirm = step.confirm;
			await driver.type(step.text, opts);
			return;
		}
		case "press":
			await driver.press(step.key);
			return;
		case "clickColumnHeader":
			await driver.clickColumnHeader(step.label);
			return;
		case "contextMenu":
			await driver.clickContextMenuItem(step.label);
			return;
		case "dragFill":
			await driver.dragFill(step.to);
			return;
		case "wait":
			await driver.wait(step.ms);
			return;
		case "resetSheet":
			await driver.reset();
			return;
		case "custom":
			await step.run(driver);
			return;

		// ── Assertions ─────────────────────────────────────────────────────
		case "assertSelection": {
			const sel = await driver.getSelection();
			if (!sel || sel.anchor.row !== step.anchor.row || sel.anchor.col !== step.anchor.col) {
				throw new AssertionError({
					message: `expected selection anchor ${JSON.stringify(step.anchor)}, got ${JSON.stringify(sel?.anchor ?? null)}`,
					stepIndex,
					stepKind: "assertSelection",
				});
			}
			return;
		}
		case "assertCellValue": {
			const actual = await driver.getRawCellValue(step.at.row, step.at.col);
			if (!deepEqual(actual, step.value)) {
				throw new AssertionError({
					message: `cell (${step.at.row},${step.at.col}) expected ${JSON.stringify(step.value)}, got ${JSON.stringify(actual)}`,
					stepIndex,
					stepKind: "assertCellValue",
				});
			}
			return;
		}
		case "assertDisplayValue": {
			const actual = await driver.getDisplayCellValue(step.at.row, step.at.col);
			const actualText = actual == null ? "" : String(actual);
			if (actualText !== step.text) {
				throw new AssertionError({
					message: `cell (${step.at.row},${step.at.col}) display expected ${JSON.stringify(step.text)}, got ${JSON.stringify(actualText)}`,
					stepIndex,
					stepKind: "assertDisplayValue",
				});
			}
			return;
		}
		case "assertMutation": {
			const mutations = await driver.getMutations();
			const m = mutations[step.index];
			if (!m) {
				throw new AssertionError({
					message: `no mutation at index ${step.index} (have ${mutations.length})`,
					stepIndex,
					stepKind: "assertMutation",
				});
			}
			for (const key of Object.keys(step.match) as Array<keyof typeof step.match>) {
				const expected = step.match[key];
				const actual = m[key];
				if (!deepEqual(actual, expected)) {
					throw new AssertionError({
						message: `mutation[${step.index}].${key} expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
						stepIndex,
						stepKind: "assertMutation",
					});
				}
			}
			return;
		}
		case "assertMutationCount": {
			const mutations = await driver.getMutations();
			if (mutations.length !== step.count) {
				throw new AssertionError({
					message: `expected ${step.count} mutations, got ${mutations.length}`,
					stepIndex,
					stepKind: "assertMutationCount",
				});
			}
			return;
		}
	}
}

export async function runScenario(
	scenario: Scenario,
	driver: Driver,
	opts: RunScenarioOptions = {},
): Promise<void> {
	const { onEvent, defaultAssertMode = "hard", skipNavigate = false } = opts;

	onEvent?.({ type: "start", scenario });

	// ── Entry: stagehand navigates every run (new page = fresh state); DOM driver
	// resets the in-place replay host so successive scenarios don't leak state.
	if (!skipNavigate) {
		if (driver.kind === "stagehand") {
			await driver.navigate(scenario.route);
		} else {
			await driver.reset();
		}
	}
	if ((scenario.beforeEach ?? "clearMutations") === "clearMutations") {
		await driver.clearMutations();
	}

	for (let i = 0; i < scenario.steps.length; i++) {
		const step = scenario.steps[i]!;
		onEvent?.({ type: "step-start", index: i, step });

		try {
			await executeStep(driver, step, i);
			if (isAssertStep(step)) {
				onEvent?.({ type: "assert-pass", index: i, step });
			}
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);

			if (isAssertStep(step)) {
				onEvent?.({ type: "assert-fail", index: i, step, message });
				const mode: AssertMode = step.mode ?? defaultAssertMode;
				if (mode === "hard") {
					onEvent?.({ type: "done" });
					throw err;
				}
			} else {
				onEvent?.({ type: "error", index: i, step, message });
				onEvent?.({ type: "done" });
				throw err;
			}
		}

		onEvent?.({ type: "step-end", index: i, step });
	}

	onEvent?.({ type: "done" });
}
