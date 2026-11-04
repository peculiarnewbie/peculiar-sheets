import assert from "node:assert/strict";
import { test } from "node:test";
import { measureFrameAlignedReplacement } from "../apps/benchmarks/src/replacement-timing";
import { MEASUREMENT_PROTOCOL } from "../apps/benchmarks/src/types";
import { usesApiCompletion, validateReplacementTiming } from "./measurement-protocol";
import { renderReport, type ReportSnapshot } from "./report";
import { summarizeOverview } from "./overview";

test("replacement submission starts inside a frame and ends two subsequent callbacks later", async (context) => {
	const previous = Object.getOwnPropertyDescriptor(globalThis, "requestAnimationFrame");
	context.after(() => {
		if (previous) Object.defineProperty(globalThis, "requestAnimationFrame", previous);
		else Reflect.deleteProperty(globalThis, "requestAnimationFrame");
	});
	Object.defineProperty(globalThis, "requestAnimationFrame", {
		configurable: true,
		value: (callback: FrameRequestCallback) => {
			callbacks.push(callback);
			return callbacks.length;
		},
	});
	let now = 5;
	context.mock.method(performance, "now", () => now);
	const callbacks: FrameRequestCallback[] = [];
	let submissions = 0;
	const step = () => {
		const callback = callbacks.shift();
		assert.ok(callback);
		callback(now);
	};
	const measured = measureFrameAlignedReplacement(() => {
		submissions++;
		now += 3;
	});
	assert.equal(submissions, 0);
	now = 100;
	step();
	assert.equal(submissions, 1);
	now = 117;
	step();
	now = 134;
	step();
	const result = await measured;
	assert.ok(result.isOk());
	assert.deepEqual(result.value, {
		synchronousMs: 3,
		firstFrameMs: 17,
		secondFrameMs: 17,
		settledMs: 34,
	});
	// Each later step must acquire its own boundary, even after a long integrity scan.
	now = 999;
	const failed = measureFrameAlignedReplacement(() => {
		throw new Error("adapter failure");
	});
	assert.equal(callbacks.length, 1);
	step();
	assert.ok((await failed).isErr());
	assert.equal(callbacks.length, 0);
});

test("aligned reports reject historical or mixed steps and preserve API completion scoring", () => {
	assert.ok(usesApiCompletion(MEASUREMENT_PROTOCOL));
	assert.ok(usesApiCompletion("api-completion-v2"));
	const snapshot: ReportSnapshot = {
		measurementProtocol: MEASUREMENT_PROTOCOL,
		generatedAt: "2026-11-04T00:00:00Z",
		iterations: 1,
		warmups: 0,
		results: [
			{
				implementation: "peculiar-sheets",
				scenario: "replace-small-disjoint",
				kind: "replace",
				rows: 10,
				columns: 1,
				navigationToReadyMs: 1,
				mountMs: 1,
				domNodes: 1,
				heapBytesBeforeGc: 1,
				heapBytes: 1,
				replacement: {
					timingProtocol: "frame-aligned-v1",
					mode: "disjoint",
					steps: [
						{
							name: "replace",
							fromRows: 10,
							toRows: 10,
							synchronousMs: 1,
							firstFrameMs: 17,
							secondFrameMs: 17,
							settledMs: 34,
						},
					],
				},
			},
		],
	};
	validateReplacementTiming(snapshot);
	assert.match(renderReport(snapshot).markdown, /api-completion-v2-frame-aligned-v1/);
	assert.match(renderReport(snapshot).csv, /measurementProtocol/);
	assert.equal(renderReport(snapshot).rows[0]?.measurementProtocol, MEASUREMENT_PROTOCOL);
	const legacy = { ...snapshot, measurementProtocol: "api-completion-v2" };
	assert.throws(() => renderReport(legacy), /protocol mismatch/);
	assert.throws(() => summarizeOverview(legacy), /protocol mismatch/);
	for (const sample of snapshot.results) {
		if (sample.kind === "replace") delete sample.replacement.timingProtocol;
	}
	assert.throws(() => renderReport(snapshot), /protocol mismatch/);
	assert.throws(() => summarizeOverview(snapshot), /protocol mismatch/);
});
