/**
 * GhostCursor — an absolutely-positioned overlay dot + halo that tweens to
 * `{x, y}` viewport coordinates over time. The `ScenarioPlayer` hands a
 * `moveTo(x, y)` callback to the `DomDriver` via `onPointerTarget`; every
 * action step fires a move before dispatching the underlying mouse event so
 * the viewer sees the cursor glide to the target cell before the click lands.
 *
 * Uses `requestAnimationFrame` to interpolate between the current position
 * and the new target; the previous animation is cancelled so rapid-fire
 * updates don't fight each other.
 */

import { createSignal, onCleanup, Show, type JSX } from "solid-js";

export interface GhostCursorHandle {
	/** Show the cursor and tween it to viewport coordinates `(x, y)`. */
	moveTo(x: number, y: number): void;
	/** Hide the cursor (e.g., when replay ends). */
	hide(): void;
}

export interface GhostCursorProps {
	/** Called once on mount with the imperative handle. */
	ref: (handle: GhostCursorHandle) => void;
	/** Tween duration in ms. Default: 220ms. */
	tweenMs?: number;
}

const DEFAULT_TWEEN_MS = 220;

export function GhostCursor(props: GhostCursorProps): JSX.Element {
	const [pos, setPos] = createSignal<{ x: number; y: number } | null>(null);
	let currentRaf = 0;
	let animStart = 0;
	let animFrom = { x: 0, y: 0 };
	let animTo = { x: 0, y: 0 };
	let animDuration = DEFAULT_TWEEN_MS;

	function easeOutCubic(t: number): number {
		return 1 - (1 - t) ** 3;
	}

	function step(now: number) {
		const elapsed = now - animStart;
		const t = Math.min(1, elapsed / animDuration);
		const eased = easeOutCubic(t);
		setPos({
			x: animFrom.x + (animTo.x - animFrom.x) * eased,
			y: animFrom.y + (animTo.y - animFrom.y) * eased,
		});
		if (t < 1) {
			currentRaf = requestAnimationFrame(step);
		} else {
			currentRaf = 0;
		}
	}

	const handle: GhostCursorHandle = {
		moveTo(x, y) {
			if (currentRaf !== 0) cancelAnimationFrame(currentRaf);
			animFrom = pos() ?? { x, y };
			animTo = { x, y };
			animStart = performance.now();
			animDuration = props.tweenMs ?? DEFAULT_TWEEN_MS;
			if (!pos()) {
				// First placement — snap in with a tiny fade, no cross-screen tween.
				setPos({ x, y });
			}
			currentRaf = requestAnimationFrame(step);
		},
		hide() {
			if (currentRaf !== 0) cancelAnimationFrame(currentRaf);
			currentRaf = 0;
			setPos(null);
		},
	};
	props.ref(handle);

	onCleanup(() => {
		if (currentRaf !== 0) cancelAnimationFrame(currentRaf);
	});

	return (
		<Show when={pos()}>
			{(p) => (
				<div
					class="replay-cursor"
					aria-hidden="true"
					style={{
						transform: `translate3d(${p().x}px, ${p().y}px, 0)`,
					}}
				>
					<div class="replay-cursor__halo" />
					<div class="replay-cursor__dot" />
				</div>
			)}
		</Show>
	);
}
