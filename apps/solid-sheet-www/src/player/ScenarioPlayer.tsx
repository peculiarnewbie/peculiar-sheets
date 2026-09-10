import type { JSX } from "@solidjs/web";
/**
 * ScenarioPlayer — the UI shell for replaying scenarios against a live
 * `<Sheet>`. Reads scenarios from `sheet-scenarios/scenarios`, drives them
 * through `DomDriver`, and renders:
 *
 *   - a dropdown of scenarios for the current demo id
 *   - play / step-through controls
 *   - a caption bar showing the current step's description
 *   - an assertion pip strip (green ●, red ✖, grey ○)
 *   - a ghost cursor that glides to every pointer target
 *
 * Runs in "soft" assert mode: assertion failures show up as red pips but
 * playback continues to the last step. Action-step errors still halt.
 */

import { createEffect, createSignal, For, Show, createMemo, onCleanup } from "solid-js";
import {
	DomDriver,
	isScenarioAbortError,
	runScenario,
	type Scenario,
	type ScenarioEvent,
	type Step,
} from "sheet-scenarios";
import type { ReplayHostHandle } from "./ReplayHost";
import { GhostCursor, type GhostCursorHandle } from "./GhostCursor";

export interface ScenarioPlayerProps {
	/** Scenarios to pick from — typically `SCENARIOS[demoId]`. */
	scenarios: Scenario[];
	/** Live handle from the surrounding `ReplayHost`. */
	host: ReplayHostHandle | null;
	/** Kick off the first scenario automatically once the host is ready.
	 *  Defaults to `true` — Replay mode is the demo's "trailer". */
	autoPlay?: boolean;
}

type PipState = "pending" | "pass" | "fail";

interface PipInfo {
	index: number;
	state: PipState;
	kind: string;
	message?: string;
}

function isAssertStepKind(kind: string): boolean {
	return kind.startsWith("assert");
}

function formatStep(step: Step): string {
	if (step.caption) return step.caption;
	switch (step.kind) {
		case "click":
			return `Click (${step.at.row + 1},${step.at.col + 1})`;
		case "doubleClick":
			return `Double-click (${step.at.row + 1},${step.at.col + 1})`;
		case "shiftClick":
			return `Shift-click (${step.at.row + 1},${step.at.col + 1})`;
		case "rightClick":
			return `Right-click (${step.at.row + 1},${step.at.col + 1})`;
		case "type":
			return `Type "${step.text}"${step.confirm === false ? "" : " + Enter"}`;
		case "press":
			return `Press ${step.key}`;
		case "clickColumnHeader":
			return `Click column ${step.label}`;
		case "contextMenu":
			return `Context menu → ${step.label}`;
		case "dragFill":
			return `Drag-fill → (${step.to.row + 1},${step.to.col + 1})`;
		case "wait":
			return `Wait ${step.ms}ms`;
		case "resetSheet":
			return "Reset sheet";
		case "custom":
			return "Custom step";
		case "assertSelection":
			return `Assert selection @ (${step.anchor.row + 1},${step.anchor.col + 1})`;
		case "assertCellValue":
			return `Assert cell (${step.at.row + 1},${step.at.col + 1}) = ${JSON.stringify(step.value)}`;
		case "assertDisplayValue":
			return `Assert display (${step.at.row + 1},${step.at.col + 1}) = ${JSON.stringify(step.text)}`;
		case "assertMutation":
			return `Assert mutation[${step.index}]`;
		case "assertMutationCount":
			return `Assert ${step.count} mutations`;
	}
}

export function ScenarioPlayer(props: ScenarioPlayerProps): JSX.Element {
	const [selectedId, setSelectedId] = createSignal<string>(props.scenarios[0]?.id ?? "");
	const [isRunning, setIsRunning] = createSignal(false);
	const [currentStepIndex, setCurrentStepIndex] = createSignal<number | null>(null);
	const [caption, setCaption] = createSignal<string>("");
	const [pips, setPips] = createSignal<PipInfo[]>([]);
	const [errorMessage, setErrorMessage] = createSignal<string | null>(null);

	let cursor: GhostCursorHandle | null = null;
	// Flipped to true when the component unmounts mid-run (e.g., user clicked
	// the shield to drop back to Live mode). The DomDriver checks this after
	// every action and throws `ScenarioAbortError` so we stop dispatching
	// synthetic events against a sheet the user is now steering themselves.
	let aborted = false;

	// Pause between loop iterations. Replay mode is a "trailer" — we re-run
	// the scenario forever until the user interacts, leaving a visible beat
	// so viewers can read the final caption + pip strip before it restarts.
	const LOOP_GAP_MS = 3000;
	let loopTimer: ReturnType<typeof setTimeout> | null = null;
	function cancelLoopTimer(): void {
		if (loopTimer != null) {
			clearTimeout(loopTimer);
			loopTimer = null;
		}
	}

	const activeScenario = createMemo(
		() => props.scenarios.find((s) => s.id === selectedId()) ?? props.scenarios[0],
	);

	onCleanup(() => {
		aborted = true;
		cancelLoopTimer();
		cursor?.hide();
	});

	// Reset UI + kick off playback whenever the active scenario or host
	// handle changes. Covers two paths:
	//   - first mount (once `props.host` populates),
	//   - user picks a different scenario from the dropdown.
	// Cancels any pending loop timer so we don't race a stale restart
	// against the fresh run.
	createEffect(
		() => ({ id: selectedId(), host: props.host, autoPlay: props.autoPlay }),
		({ id, host, autoPlay }) => {
			setCurrentStepIndex(null);
			setCaption("");
			setPips([]);
			setErrorMessage(null);
			cancelLoopTimer();

			if (!(autoPlay ?? true)) return;
			if (!host) return;
			if (!id) return;

			// Defer one tick so the sheet has painted and any previous in-flight
			// run has released its iteration before we start firing events.
			queueMicrotask(() => {
				if (aborted) return;
				if (isRunning()) return;
				if (selectedId() !== id) return;
				void play();
			});
		},
	);

	function handleEvent(event: ScenarioEvent): void {
		switch (event.type) {
			case "start": {
				// Pre-populate pips with one entry per assertion step, all "pending".
				const initial: PipInfo[] = [];
				event.scenario.steps.forEach((s, i) => {
					if (isAssertStepKind(s.kind)) {
						initial.push({ index: i, state: "pending", kind: s.kind });
					}
				});
				setPips(initial);
				setErrorMessage(null);
				break;
			}
			case "step-start":
				setCurrentStepIndex(event.index);
				setCaption(formatStep(event.step));
				break;
			case "assert-pass":
				setPips((prev) => prev.map((p) => (p.index === event.index ? { ...p, state: "pass" } : p)));
				break;
			case "assert-fail":
				setPips((prev) =>
					prev.map((p) =>
						p.index === event.index ? { ...p, state: "fail", message: event.message } : p,
					),
				);
				break;
			case "error":
				setErrorMessage(`Step ${event.index}: ${event.message}`);
				break;
			case "done":
				// Leave `currentStepIndex` + `caption` on the last step so the
				// caption bar keeps reading "Step N: <last caption>" after the
				// run finishes — nulling the index made it render "Step 1"
				// alongside the last step's text, which was misleading.
				break;
		}
	}

	async function play() {
		const scenario = activeScenario();
		if (!scenario || isRunning() || !props.host) return;

		// Any pending loop restart is superseded by this explicit run.
		cancelLoopTimer();

		setIsRunning(true);
		setErrorMessage(null);

		const driver = new DomDriver({
			controller: props.host.controller,
			buffer: props.host.buffer,
			onPointerTarget: (x, y) => cursor?.moveTo(x, y),
			isAborted: () => aborted,
		});

		let completedCleanly = false;
		try {
			await runScenario(scenario, driver, {
				onEvent: handleEvent,
				defaultAssertMode: "soft",
			});
			completedCleanly = true;
		} catch (err) {
			// Abort is the expected path when the user clicks the shield to
			// drop back to Live — swallow silently and DON'T reschedule.
			if (isScenarioAbortError(err)) return;
			// Action-step errors still throw (scenario structurally broken). Surface
			// them in the caption bar instead of crashing the page.
			setErrorMessage(err instanceof Error ? err.message : String(err));
		} finally {
			setIsRunning(false);
			cursor?.hide();
		}

		// Trailer loop: on a clean run, wait LOOP_GAP_MS then restart — but
		// only if we're still mounted AND the user hasn't picked a different
		// scenario during the wait. Broken runs (errors) don't re-loop so the
		// failure message stays visible.
		if (!completedCleanly || aborted) return;
		const loopedId = scenario.id;
		loopTimer = setTimeout(() => {
			loopTimer = null;
			if (aborted) return;
			if (activeScenario()?.id !== loopedId) return;
			void play();
		}, LOOP_GAP_MS);
	}

	const passCount = createMemo(() => pips().filter((p) => p.state === "pass").length);
	const failCount = createMemo(() => pips().filter((p) => p.state === "fail").length);

	return (
		<div class={["replay-player", { "replay-player--active": isRunning() }]}>
			<GhostCursor ref={(h) => (cursor = h)} />

			<div class="replay-player__controls">
				<select
					class="replay-player__select"
					value={selectedId()}
					onChange={(e) => setSelectedId(e.currentTarget.value)}
					disabled={isRunning()}
				>
					<For each={props.scenarios}>{(s) => <option value={s.id}>{s.title}</option>}</For>
				</select>

				<button
					class="replay-player__play"
					type="button"
					onClick={play}
					disabled={isRunning() || !props.host}
					title={isRunning() ? "Running…" : "Play scenario"}
				>
					<Show when={isRunning()} fallback={<span aria-hidden="true">▶</span>}>
						<span aria-hidden="true">⏵</span>
					</Show>
					<span class="replay-player__play-label">{isRunning() ? "Running" : "Play"}</span>
				</button>
			</div>

			{/*
			 * Caption row holds: step chip + caption text (left), assertion pips
			 * (right, pushed via margin-left: auto). Keeping the pips here — not
			 * in the controls row — stops the Play button from sliding sideways
			 * when the pip strip mounts mid-run.
			 */}
			<div class="replay-player__caption" aria-live="polite">
				<Show
					when={errorMessage()}
					fallback={
						<Show
							when={caption()}
							fallback={
								<span class="replay-player__caption-hint">Pick a scenario and press Play.</span>
							}
						>
							<span class="replay-player__caption-step">Step {(currentStepIndex() ?? 0) + 1}</span>
							<span class="replay-player__caption-text">{caption()}</span>
						</Show>
					}
				>
					<span class="replay-player__caption-error">{errorMessage()}</span>
				</Show>

				<Show when={pips().length > 0}>
					<div class="replay-player__pips" aria-label="assertion results">
						<For each={pips()}>
							{(pip) => (
								<span
									class={`replay-pip replay-pip--${pip.state}`}
									title={pip.state === "fail" ? `${pip.kind}: ${pip.message}` : pip.kind}
								>
									{pip.state === "pass" ? "●" : pip.state === "fail" ? "✖" : "○"}
								</span>
							)}
						</For>
						<span class="replay-player__counts">
							<span class="replay-player__count replay-player__count--pass">{passCount()}</span>
							<Show when={failCount() > 0}>
								<span class="replay-player__count replay-player__count--fail">{failCount()}</span>
							</Show>
							<span class="replay-player__count-total">/ {pips().length}</span>
						</span>
					</div>
				</Show>
			</div>
		</div>
	);
}
