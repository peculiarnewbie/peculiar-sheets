import { onCleanup, onMount } from "solid-js";

export interface GridLifecycleCounts {
	rowMounts: number;
	rowCleanups: number;
	rowLive: number;
	rowMaxLive: number;
	cellMounts: number;
	cellCleanups: number;
	cellLive: number;
	cellMaxLive: number;
}

interface LifecycleDiagnosticsGlobal {
	__PECULIAR_SHEETS_LIFECYCLE__?: GridLifecycleCounts;
}

/**
 * Registers benchmark-only lifecycle accounting when the benchmark adapter has
 * installed the hidden global counter. Normal consumers do not allocate hooks.
 */
export function trackGridLifecycle(kind: "row" | "cell"): void {
	const counts = (globalThis as LifecycleDiagnosticsGlobal).__PECULIAR_SHEETS_LIFECYCLE__;
	if (!counts) return;

	onMount(() => {
		if (kind === "row") {
			counts.rowMounts += 1;
			counts.rowLive += 1;
			counts.rowMaxLive = Math.max(counts.rowMaxLive, counts.rowLive);
			return;
		}
		counts.cellMounts += 1;
		counts.cellLive += 1;
		counts.cellMaxLive = Math.max(counts.cellMaxLive, counts.cellLive);
	});

	onCleanup(() => {
		if (kind === "row") {
			counts.rowCleanups += 1;
			counts.rowLive -= 1;
			return;
		}
		counts.cellCleanups += 1;
		counts.cellLive -= 1;
	});
}
