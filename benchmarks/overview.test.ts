import assert from "node:assert/strict";
import { test } from "node:test";
import { summarizeOverview } from "./overview";
import type { ReportSnapshot } from "./report";

test("replacement roundtrips count once and use both steps", () => {
	const common = {
		scenario: "replace-filter-roundtrip" as const,
		kind: "replace" as const,
		rows: 10_000,
		columns: 1,
		navigationToReadyMs: 100,
		mountMs: 80,
		domNodes: 100,
		heapBytesBeforeGc: 1_000,
		heapBytes: 1_000,
	};
	const snapshot: ReportSnapshot = {
		generatedAt: "2026-11-02T00:00:00Z",
		iterations: 1,
		warmups: 0,
		results: [
			{
				...common,
				implementation: "peculiar-sheets",
				replacement: {
					mode: "filter-roundtrip",
					steps: [
						{ name: "replace", fromRows: 10_000, toRows: 10, synchronousMs: 1, settledMs: 10 },
						{ name: "restore", fromRows: 10, toRows: 10_000, synchronousMs: 1, settledMs: 100 },
					],
				},
			},
			{
				...common,
				implementation: "ag-grid",
				replacement: {
					mode: "filter-roundtrip",
					steps: [
						{ name: "replace", fromRows: 10_000, toRows: 10, synchronousMs: 1, settledMs: 20 },
						{ name: "restore", fromRows: 10, toRows: 10_000, synchronousMs: 1, settledMs: 40 },
					],
				},
			},
		],
	};
	const replacement = summarizeOverview(snapshot).find((category) => category.id === "replacement");
	assert.equal(replacement?.cases.length, 1);
	assert.equal(replacement?.cases[0]?.own, 110);
	assert.equal(replacement?.best, 0);
	assert.equal(replacement?.behind, 1);
});

test("cases without a comparison are omitted", () => {
	const snapshot: ReportSnapshot = {
		generatedAt: "2026-11-02T00:00:00Z",
		iterations: 1,
		warmups: 0,
		results: [
			{
				implementation: "peculiar-sheets",
				scenario: "mount-small",
				kind: "mount",
				rows: 1_000,
				columns: 20,
				navigationToReadyMs: 100,
				mountMs: 80,
				domNodes: 100,
				heapBytesBeforeGc: 1_000,
				heapBytes: 1_000,
			},
		],
	};
	assert.deepEqual(summarizeOverview(snapshot), []);
});

test("protocol v2 ranks awaited API completion and preserves legacy settled rankings", () => {
	const common = {
		scenario: "offscreen-writes" as const,
		kind: "writes" as const,
		rows: 10000,
		columns: 20,
		navigationToReadyMs: 100,
		mountMs: 80,
		domNodes: 100,
		heapBytesBeforeGc: 1000,
		heapBytes: 1000,
	};
	const snapshot: ReportSnapshot = {
		measurementProtocol: "api-completion-v2",
		generatedAt: "2026-11-04T00:00:00Z",
		iterations: 1,
		warmups: 0,
		results: [
			{
				...common,
				implementation: "peculiar-sheets",
				writes: {
					distribution: "offscreen",
					mode: "independent",
					count: 250,
					durationMs: 1,
					completionDurationMs: 8,
					settledDurationMs: 100,
					operationsPerSecond: 31250,
				},
			},
			{
				...common,
				implementation: "ag-grid",
				writes: {
					distribution: "offscreen",
					mode: "independent",
					count: 250,
					durationMs: 0.1,
					completionDurationMs: 4,
					settledDurationMs: 200,
					operationsPerSecond: 62500,
				},
			},
		],
	};
	const current = summarizeOverview(snapshot)[0]?.cases[0];
	assert.equal(current?.own, 8);
	assert.equal(current?.best, 4);
	assert.equal(current?.status, "behind");
	const { measurementProtocol: _protocol, ...legacy } = snapshot;
	assert.equal(summarizeOverview(legacy)[0]?.cases[0]?.own, 100);
	assert.equal(summarizeOverview(legacy)[0]?.cases[0]?.status, "best");
	const incomplete = {
		...snapshot,
		results: snapshot.results.map((result) => {
			if (result.kind !== "writes") return result;
			const { completionDurationMs: _completion, ...writes } = result.writes;
			return { ...result, writes };
		}),
	};
	assert.throws(() => summarizeOverview(incomplete), /requires complete API completion/);
	for (const invalid of [0, Number.NaN, Number.POSITIVE_INFINITY]) {
		const invalidSnapshot = {
			...snapshot,
			results: snapshot.results.map((result) =>
				result.kind === "writes"
					? { ...result, writes: { ...result.writes, completionDurationMs: invalid } }
					: result,
			),
		};
		assert.throws(() => summarizeOverview(invalidSnapshot), /requires complete API completion/);
	}
});
