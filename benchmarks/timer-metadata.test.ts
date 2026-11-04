import assert from "node:assert/strict";
import { test } from "node:test";
import { timerMetadata } from "./timer-metadata";

test("timer metadata observes positive quantization steps and bounds a stalled clock", (context) => {
	const previous = Object.getOwnPropertyDescriptor(globalThis, "performance");
	context.after(() => {
		if (previous) Object.defineProperty(globalThis, "performance", previous);
	});
	let reads = 0;
	Object.defineProperty(globalThis, "performance", {
		configurable: true,
		value: { now: () => Math.floor(reads++ / 4) / 200 },
	});
	assert.ok(Math.abs((timerMetadata().timerGranularityMs ?? 0) - 0.005) < 1e-9);
	Object.defineProperty(globalThis, "performance", { configurable: true, value: { now: () => 1 } });
	assert.equal(timerMetadata().timerGranularityMs, null);
	assert.equal(timerMetadata().timerPositiveTicks, 0);
});
