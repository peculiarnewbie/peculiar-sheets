import { Result, TaggedError } from "better-result";
import type { BenchmarkController, BenchmarkScenario, BenchmarkWrite, WriteMetrics } from "./types";

type WriteScenario = Extract<BenchmarkScenario, { kind: "writes" }>;
interface Timing {
	now(): number;
	frame(): Promise<void>;
}
class WriteProbeError extends TaggedError("WriteProbeError")<{ message: string; cause: unknown }> {}

/** API completion includes asynchronous adapters; frame waiting is a separate diagnostic. */
export function measureWrites(
	controller: BenchmarkController,
	scenario: WriteScenario,
	timing: Timing = {
		now: () => performance.now(),
		frame: () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
	},
) {
	return Result.tryPromise({
		try: async (): Promise<WriteMetrics> => {
			const writes: BenchmarkWrite[] = Array.from({ length: scenario.count }, (_, index) => ({
				row: scenario.distribution === "visible" ? index % 20 : (index * 97) % scenario.rows,
				column:
					scenario.distribution === "visible"
						? Math.floor(index / 20) % scenario.columns
						: index % scenario.columns,
				value: `value-${index}`,
			}));
			await controller.scrollToRow(0);
			await timing.frame();
			const start = timing.now();
			const pending: Promise<void>[] = [];
			if (scenario.mode === "batch") {
				const completion = controller.writeCells(writes);
				if (completion) pending.push(completion);
			} else {
				for (const write of writes) {
					const completion = controller.writeCell(write.row, write.column, write.value);
					if (completion) pending.push(completion);
				}
			}
			const durationMs = timing.now() - start;
			if (pending.length) await Promise.all(pending);
			const completionDurationMs = timing.now() - start;
			if (!Number.isFinite(completionDurationMs) || completionDurationMs <= 0)
				throw new Error("Clock cannot resolve API completion time");
			// Verify the promised model update before waiting for any rendering frames.
			const expected = new Map<string, BenchmarkWrite>();
			for (const write of writes) expected.set(`${write.row}:${write.column}`, write);
			for (const write of expected.values()) {
				const actual = controller.readCell(write.row, write.column);
				if (actual !== write.value)
					throw new Error(
						`Write completion integrity check failed at ${write.row},${write.column}: expected ${JSON.stringify(write.value)}, received ${JSON.stringify(actual)}`,
					);
			}
			await timing.frame();
			await timing.frame();
			return {
				distribution: scenario.distribution,
				mode: scenario.mode,
				count: scenario.count,
				durationMs,
				completionDurationMs,
				settledDurationMs: timing.now() - start,
				operationsPerSecond: (scenario.count / completionDurationMs) * 1000,
			};
		},
		catch: (cause) => new WriteProbeError({ message: "Write measurement failed", cause }),
	});
}
