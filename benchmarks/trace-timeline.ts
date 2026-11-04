export interface TimelineEvent {
	name: string;
	ts: number;
	dur?: number;
	tid: number;
	pid: number;
	args?: unknown;
}

/** Preserve nested events: durations are not additive CPU totals. CDP times are µs. */
export function replacementTimeline(events: readonly TimelineEvent[]) {
	return events
		.filter((event) => /^replace:.*:start$/.test(event.name))
		.map((start) => {
			const prefix = start.name.slice(0, -"start".length);
			const thread = events.filter((event) => event.pid === start.pid && event.tid === start.tid);
			const first = thread.find((event) => event.name === `${prefix}raf1` && event.ts >= start.ts);
			const second = thread.find((event) => event.name === `${prefix}raf2` && event.ts >= start.ts);
			if (!first || !second) throw new Error(`Incomplete replacement trace: ${prefix}`);
			return {
				step: prefix,
				firstFrameMs: (first.ts - start.ts) / 1000,
				secondFrameMs: (second.ts - first.ts) / 1000,
				events: thread
					.filter((event) => event.ts <= second.ts && event.ts + (event.dur ?? 0) >= start.ts)
					.map((event) => ({
						name: event.name,
						startMs: (event.ts - start.ts) / 1000,
						durationMs: (event.dur ?? 0) / 1000,
						phase: event.ts < first.ts ? "before-raf1" : "raf1-to-raf2",
						...(event.args === undefined ? {} : { args: event.args }),
					})),
			};
		});
}
