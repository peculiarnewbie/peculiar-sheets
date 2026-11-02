import { Result, TaggedError } from "better-result";
import type {
	BenchmarkController,
	BenchmarkDataset,
	BenchmarkWrite,
	InteractionMetrics,
} from "./types";

class StreamUpdateError extends TaggedError("StreamUpdateError")<{
	message: string;
	cause: unknown;
}> {}

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
const percentile = (values: readonly number[], ratio: number) => {
	const sorted = [...values].sort((a, b) => a - b);
	return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))] ?? 0;
};

export function createInteractionProbe(controller: BenchmarkController, dataset: BenchmarkDataset) {
	let startedAt = 0;
	let active = false;
	let previousFrame = 0;
	let frameId = 0;
	let actions = 0;
	let lastInputAt = 0;
	let verifiedCells = 0;
	let streamBatches = 0;
	let streamWrites = 0;
	const responseTimes: number[] = [];
	const verifiedResponses: number[] = [];
	const frameTimes: number[] = [];
	const streamTimes: number[] = [];
	const expectedStream = new Map<string, BenchmarkWrite>();
	const longTasks: number[] = [];
	let stream: Promise<Result<void, StreamUpdateError>> | undefined;
	const position = () =>
		controller.getScrollPosition?.() ?? {
			top: controller.getScrollElement().scrollTop,
			left: controller.getScrollElement().scrollLeft,
		};
	let firstPosition = position();
	const observer = PerformanceObserver.supportedEntryTypes.includes("longtask")
		? new PerformanceObserver((list) => {
				for (const entry of list.getEntries()) longTasks.push(entry.duration);
			})
		: undefined;
	const events = ["pointerdown", "keydown", "beforeinput", "paste", "wheel"];
	const onInput = (event: Event) => {
		if (!active || !event.isTrusted) return;
		actions++;
		const start = performance.now();
		lastInputAt = start;
		requestAnimationFrame(() =>
			requestAnimationFrame(() => {
				if (active) responseTimes.push(performance.now() - start);
			}),
		);
	};
	const onFrame = (now: number) => {
		if (!active) return;
		if (previousFrame) frameTimes.push(now - previousFrame);
		previousFrame = now;
		frameId = requestAnimationFrame(onFrame);
	};
	const verifyCells = (writes: readonly BenchmarkWrite[]) => {
		const checkedAt = performance.now();
		for (const write of writes) {
			const actual = controller.readCell(write.row, write.column);
			if (actual !== write.value) {
				const message = `Interaction integrity check failed at ${write.row},${write.column}: expected ${JSON.stringify(write.value)}, received ${JSON.stringify(actual)}`;
				window.__BENCH_ERROR__ = message;
				throw new Error(message);
			}
		}
		verifiedCells += writes.length;
		if (lastInputAt) verifiedResponses.push(checkedAt - lastInputAt);
	};
	return {
		verifyCells,
		recordCompletion() {
			if (lastInputAt) verifiedResponses.push(performance.now() - lastInputAt);
		},
		start() {
			if (active) throw new Error("Interaction probe already running");
			active = true;
			startedAt = performance.now();
			firstPosition = position();
			for (const name of events)
				document.addEventListener(name, onInput, { capture: true, passive: true });
			observer?.observe({ type: "longtask" });
			frameId = requestAnimationFrame(onFrame);
		},
		startStream() {
			if (stream) throw new Error("Stream already started");
			stream = Result.tryPromise({
				try: async () => {
					const start = performance.now();
					for (let batch = 0; batch < 50; batch++) {
						const delay = start + batch * 100 - performance.now();
						if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
						if (performance.now() - start >= 5_000) break;
						const writes = Array.from({ length: 100 }, (_, index) => ({
							row: 100 + ((batch * 137 + index * 97) % (dataset.rows - 100)),
							column: 1 + (index % (dataset.columns - 1)),
							value: `stream-${batch}:${index}`,
						}));
						const before = performance.now();
						await controller.writeCells(writes);
						await frame();
						streamTimes.push(performance.now() - before);
						for (const write of writes) expectedStream.set(`${write.row}:${write.column}`, write);
						streamBatches++;
						streamWrites += writes.length;
					}
					const remaining = start + 5_000 - performance.now();
					if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
					verifyCells([...expectedStream.values()]);
				},
				catch: (cause) => new StreamUpdateError({ message: "Streaming workload failed", cause }),
			});
		},
		async finish(): Promise<InteractionMetrics> {
			if (!active) throw new Error("Interaction probe was not started");
			try {
				if (stream) {
					const result = await stream;
					result.tapError((error) =>
						console.debug("benchmark.stream.failed", { cause: error.cause }),
					);
					if (result.isErr()) throw result.error;
				}
				await frame();
				await frame();
				const lastPosition = position();
				return {
					durationMs: performance.now() - startedAt,
					actions,
					verifiedCells,
					responseP50Ms: percentile(responseTimes, 0.5),
					responseP95Ms: percentile(responseTimes, 0.95),
					responseMaxMs: Math.max(0, ...responseTimes),
					responseSamples: responseTimes.length,
					verifiedResponseP95Ms: percentile(verifiedResponses, 0.95),
					verifiedResponseSamples: verifiedResponses.length,
					frameP95Ms: percentile(frameTimes, 0.95),
					maxFrameMs: Math.max(0, ...frameTimes),
					longTaskCount: longTasks.length,
					longTaskTotalMs: longTasks.reduce((sum, value) => sum + value, 0),
					scrollDistanceX: lastPosition.left - firstPosition.left,
					scrollDistanceY: lastPosition.top - firstPosition.top,
					streamBatches,
					streamWrites,
					streamBatchP95Ms: percentile(streamTimes, 0.95),
				};
			} finally {
				active = false;
				cancelAnimationFrame(frameId);
				observer?.disconnect();
				for (const name of events) document.removeEventListener(name, onInput, true);
			}
		},
	};
}
