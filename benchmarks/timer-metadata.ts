/** Page-side observation, outside every measured workload interval. */
export function timerMetadata() {
	let previous = performance.now();
	let minimum = Infinity;
	let ticks = 0;
	for (let reads = 0; reads < 100_000 && ticks < 128; reads++) {
		const now = performance.now();
		const delta = now - previous;
		if (delta > 0) {
			minimum = Math.min(minimum, delta);
			ticks++;
		}
		previous = now;
	}
	return {
		crossOriginIsolated: globalThis.crossOriginIsolated,
		timerGranularityMs: Number.isFinite(minimum) ? minimum : null,
		timerPositiveTicks: ticks,
	};
}
