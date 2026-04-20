/**
 * Scenario / Driver type definitions.
 *
 * A `Scenario` is plain data: an ordered list of `Step`s that a `Driver` executes.
 * One shape, two interpreters:
 *   - `StagehandDriver` drives a real browser over CDP for Bun e2e tests (hard asserts).
 *   - `DomDriver` runs in-page against the live Sheet for the showcase (soft asserts, animated).
 */

import { TaggedError } from "better-result";
import type { CellValue } from "peculiar-sheets";

export type CellRef = { row: number; col: number };

/** `hard` → throw on assertion failure (used by CI). `soft` → surface a pip but continue playback (used by the showcase). */
export type AssertMode = "hard" | "soft";

export type DriverKind = "stagehand" | "dom";

export interface MutationSnapshot {
	source: string;
	newValue: CellValue;
	oldValue: CellValue;
}

// ── Action steps ────────────────────────────────────────────────────────────

export type ActionStep =
	| { kind: "click"; at: CellRef; shift?: boolean; button?: "left" | "right"; caption?: string }
	| { kind: "doubleClick"; at: CellRef; caption?: string }
	| { kind: "shiftClick"; at: CellRef; caption?: string }
	| { kind: "rightClick"; at: CellRef; caption?: string }
	| { kind: "type"; text: string; confirm?: boolean; caption?: string }
	| { kind: "press"; key: string; caption?: string }
	| { kind: "clickColumnHeader"; label: string; caption?: string }
	| { kind: "contextMenu"; label: string; caption?: string }
	| { kind: "dragFill"; to: CellRef; caption?: string }
	| { kind: "wait"; ms: number; caption?: string }
	| { kind: "resetSheet"; caption?: string }
	| {
		kind: "custom";
		/**
		 * Escape hatch for scenarios that don't fit the standard action set
		 * (editor introspection, raw key dispatch, etc.). The runner passes the
		 * live driver; custom steps can inspect `d.kind` to branch on Stagehand vs DOM.
		 */
		run: (d: Driver) => Promise<void>;
		caption?: string;
	};

// ── Assertion steps ─────────────────────────────────────────────────────────

export type AssertStep =
	| { kind: "assertSelection"; anchor: CellRef; mode?: AssertMode; caption?: string }
	| { kind: "assertCellValue"; at: CellRef; value: CellValue; mode?: AssertMode; caption?: string }
	| { kind: "assertDisplayValue"; at: CellRef; text: string; mode?: AssertMode; caption?: string }
	| {
		kind: "assertMutation";
		index: number;
		match: Partial<MutationSnapshot>;
		mode?: AssertMode;
		caption?: string;
	}
	| { kind: "assertMutationCount"; count: number; mode?: AssertMode; caption?: string };

export type Step = ActionStep | AssertStep;

// ── Scenario ────────────────────────────────────────────────────────────────

export interface Scenario {
	/** Stable id, usually `${demoId}/${title-slug}`. */
	id: string;
	/** Human-readable title; also used as the Bun `it(...)` name. */
	title: string;
	/** Matches `DEMOS[].id` in the showcase; drives registry lookup and replay mount. */
	demoId: string;
	/** E2E harness route (e.g. `/basic`). Stagehand driver navigates here; DOM driver uses the already-mounted demo. */
	route: `/${string}`;
	/** Whether to clear the mutation log before running (matches the current `beforeEach`). */
	beforeEach?: "clearMutations" | "none";
	/**
	 * Opt-out from the showcase Replay picker. CI still runs it — this flag
	 * only hides the scenario from `getReplayScenariosFor(...)`. Set to `true`
	 * when a scenario is a useful regression test but too narrow or awkward
	 * to showcase (e.g. edge-case introspection, duplicate of another demo).
	 *
	 * The Replay picker also auto-culls scenarios with fewer than 2 action
	 * steps — no need to flag those explicitly; they're filtered by length.
	 */
	skipInReplay?: boolean;
	steps: Step[];
}

// ── Runner events ───────────────────────────────────────────────────────────

export type ScenarioEvent =
	| { type: "start"; scenario: Scenario }
	| { type: "step-start"; index: number; step: Step }
	| { type: "step-end"; index: number; step: Step }
	| { type: "assert-pass"; index: number; step: AssertStep }
	| { type: "assert-fail"; index: number; step: AssertStep; message: string }
	| { type: "error"; index: number; step: Step; message: string }
	| { type: "done" };

export type ScenarioEventHandler = (event: ScenarioEvent) => void;

// ── Driver interface ────────────────────────────────────────────────────────

export interface Driver {
	readonly kind: DriverKind;

	// Navigation / lifecycle
	/** Stagehand: navigate to `/${route}` and wait for harness mount. DOM: no-op (showcase already mounted). */
	navigate(route: `/${string}`): Promise<void>;
	/** Restore initial state and clear mutation log. */
	reset(): Promise<void>;

	// Actions
	click(row: number, col: number, opts?: { shift?: boolean; button?: "left" | "right" }): Promise<void>;
	doubleClick(row: number, col: number): Promise<void>;
	clickColumnHeader(label: string): Promise<void>;
	rightClickCell(row: number, col: number): Promise<void>;
	clickContextMenuItem(label: string): Promise<void>;
	dragFill(to: CellRef): Promise<void>;
	type(text: string, opts?: { confirm?: boolean }): Promise<void>;
	press(key: string): Promise<void>;
	wait(ms: number): Promise<void>;

	// Reads
	getSelection(): Promise<{ anchor: CellRef; focus: CellRef } | null>;
	getRawCellValue(row: number, col: number): Promise<CellValue>;
	getDisplayCellValue(row: number, col: number): Promise<CellValue>;
	getMutations(): Promise<MutationSnapshot[]>;
	clearMutations(): Promise<void>;

	// Step-boundary hook
	/**
	 * Optional: called by `runScenario` once every step has completed (action
	 * or assertion, pass or soft-fail). The DOM driver uses this to inject a
	 * visible pause between steps so playback is legible; Stagehand leaves it
	 * unimplemented so CI runs flat-out.
	 */
	afterStep?(step: Step): Promise<void>;
}

// ── Errors ──────────────────────────────────────────────────────────────────

export class AssertionError extends TaggedError("ScenarioAssertionError")<{
	message: string;
	stepIndex: number;
	stepKind: string;
}>() {}

export class StepError extends TaggedError("ScenarioStepError")<{
	message: string;
	stepIndex: number;
	stepKind: string;
	cause: unknown;
}>() {}
