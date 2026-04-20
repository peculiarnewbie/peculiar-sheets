/**
 * Browser-safe barrel for `sheet-scenarios`.
 *
 * Exports types, the runner, the DOM driver, and the shared mutation buffer —
 * everything the showcase needs to replay scenarios against a live `<Sheet>`.
 *
 * The Stagehand driver is intentionally NOT re-exported here: importing it
 * pulls in `@browserbasehq/stagehand` (a Node-only, multi-MB dependency).
 * Consumers that need it must import from `"sheet-scenarios/stagehand"` —
 * that subpath lives outside the default entry and so never lands in the
 * showcase's Vite bundle.
 */

// Types — Scenario, Step, Driver, event shapes, error classes
export type {
	ActionStep,
	AssertMode,
	AssertStep,
	CellRef,
	Driver,
	DriverKind,
	MutationSnapshot,
	Scenario,
	ScenarioEvent,
	ScenarioEventHandler,
	Step,
} from "./types";
export { AssertionError, StepError } from "./types";

// Runner
export { runScenario, type RunScenarioOptions } from "./runScenario";

// DOM driver (safe to bundle into the showcase)
export { DomDriver, type DomDriverOptions } from "./drivers/dom";

// Shared mutation buffer — used by both the e2e harness (apps/e2e) and the
// showcase's replay host. Single implementation, two mount points.
export {
	createMutationBuffer,
	type CreateMutationBufferParams,
	type MutationBuffer,
	type MutationBufferBindings,
} from "./mutationBuffer";
