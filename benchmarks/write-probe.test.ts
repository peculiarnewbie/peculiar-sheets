import assert from "node:assert/strict";
import { test } from "node:test";
import { Result } from "better-result";
import { SCENARIOS } from "../apps/benchmarks/src/scenarios";
import type { BenchmarkController, BenchmarkWrite } from "../apps/benchmarks/src/types";
import { measureWrites } from "../apps/benchmarks/src/write-probe";

async function sample(
	mode: "independent" | "batch",
	frameCost: number,
	broken = false,
	zeroClock = false,
) {
	let now = 0,
		frames = 0,
		batchCalls = 0;
	const data = new Map<string, unknown>();
	const commit = (writes: readonly BenchmarkWrite[]) => {
		if (!broken) for (const w of writes) data.set(`${w.row}:${w.column}`, w.value);
	};
	const controller: BenchmarkController = {
		getScrollElement() {
			throw new Error("Unused");
		},
		scrollToRow() {},
		writeCell(row, column, value) {
			now += 1;
			return Promise.resolve().then(() => {
				now += 2;
				commit([{ row, column, value }]);
			});
		},
		writeCells(writes) {
			batchCalls++;
			now += 3;
			return Promise.resolve().then(() => {
				now += 7;
				commit(writes);
			});
		},
		readCell(row, column) {
			assert.equal(frames, 1, "Model must be verified before settling frames");
			return (data.get(`${row}:${column}`) as string) ?? null;
		},
		destroy() {},
	};
	const scenario = SCENARIOS["offscreen-writes"];
	if (scenario.kind !== "writes") throw new Error("Expected write scenario");
	const result = await measureWrites(
		controller,
		{ ...scenario, mode, rows: 10, columns: 2, count: 3 },
		{
			now: () => (zeroClock ? 0 : now),
			async frame() {
				frames++;
				now += frameCost;
			},
		},
	);
	return { result, frames, batchCalls };
}

test("API completion includes asynchronous work, excluding unrelated frame waiting", async () => {
	for (const frameCost of [16, 100]) {
		const { result, frames } = await sample("independent", frameCost);
		if (Result.isError(result)) throw result.error;
		assert.equal(result.value.durationMs, 3);
		assert.equal(result.value.completionDurationMs, 9);
		assert.equal(result.value.settledDurationMs, 9 + frameCost * 2);
		assert.equal(result.value.operationsPerSecond, (3 / 9) * 1000);
		assert.equal(frames, 3);
	}
});

test("batch completion awaits the returned batch promise without expanding it into single writes", async () => {
	const { result, batchCalls } = await sample("batch", 16);
	if (Result.isError(result)) throw result.error;
	assert.equal(batchCalls, 1);
	assert.equal(result.value.durationMs, 3);
	assert.equal(result.value.completionDurationMs, 10);
	assert.equal(result.value.operationsPerSecond, 300);
});

test("a resolved promise that has not applied its writes cannot produce a measurement", async () => {
	const { result } = await sample("batch", 16, true);
	assert.ok(Result.isError(result));
	if (Result.isError(result)) assert.match(String(result.error.cause), /completion integrity/);
});

test("unresolved clock measurements cannot become zero-time winners", async () => {
	const { result } = await sample("batch", 16, false, true);
	assert.ok(Result.isError(result));
	if (Result.isError(result)) assert.match(String(result.error.cause), /Clock cannot resolve/);
});
