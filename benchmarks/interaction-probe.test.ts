import assert from "node:assert/strict";
import { test } from "node:test";
import { createDataset } from "../apps/benchmarks/src/datasets";
import { createInteractionProbe } from "../apps/benchmarks/src/interaction-probe";
import { SCENARIOS } from "../apps/benchmarks/src/scenarios";
import type { BenchmarkController } from "../apps/benchmarks/src/types";

test("a slow stream completes and verifies every batch before measurement ends", async (context) => {
	const replaceGlobal = (name: string, value: unknown) => {
		const previous = Object.getOwnPropertyDescriptor(globalThis, name);
		Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
		context.after(() => {
			if (previous) Object.defineProperty(globalThis, name, previous);
			else Reflect.deleteProperty(globalThis, name);
		});
	};
	let now = 1;
	let nextFrame = 0;
	const frames = new Map<number, FrameRequestCallback>();
	replaceGlobal("performance", { now: () => now });
	replaceGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
		frames.set(++nextFrame, callback);
		return nextFrame;
	});
	replaceGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
	replaceGlobal("PerformanceObserver", { supportedEntryTypes: [] });
	replaceGlobal("document", new EventTarget());
	replaceGlobal("window", {});
	const dataset = createDataset(SCENARIOS["streaming-updates"]);
	let batches = 0;
	let writes = 0;
	const writtenCells = new Set<string>();
	const controller: BenchmarkController = {
		getScrollElement() {
			throw new Error("Use the supplied scroll position");
		},
		getScrollPosition: () => ({ top: 0, left: 0 }),
		readCell: (row, column) => dataset.values[row]?.[column] ?? null,
		writeCell(row, column, value) {
			const target = dataset.values[row];
			if (!target) throw new Error("Missing test row");
			target[column] = value;
		},
		async writeCells(batch) {
			batches++;
			writes += batch.length;
			now += 140;
			for (const write of batch) {
				writtenCells.add(`${write.row}:${write.column}`);
				const row = dataset.values[write.row];
				if (!row) throw new Error("Missing test row");
				row[write.column] = write.value;
			}
		},
		scrollToRow() {},
		destroy() {},
	};
	const probe = createInteractionProbe(controller, dataset);
	probe.start();
	probe.startStream();
	let finished = false;
	const result = probe.finish().finally(() => {
		finished = true;
	});
	for (let step = 0; step < 1000 && !finished; step++) {
		await Promise.resolve();
		const callbacks = [...frames.values()];
		frames.clear();
		now += 16;
		for (const callback of callbacks) callback(now);
		await Promise.resolve();
	}
	assert(finished, "stream and final frames must complete");
	const metrics = await result;
	assert.equal(batches, 50);
	assert.equal(writes, 5000);
	assert.equal(metrics.streamBatches, 50);
	assert.equal(metrics.streamWrites, 5000);
	assert.equal(metrics.verifiedCells, writtenCells.size);
	assert(metrics.durationMs > 5000);
});
