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
