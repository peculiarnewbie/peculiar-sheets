import assert from "node:assert/strict";
import { test } from "node:test";
import { renderReport, type ReportSnapshot } from "./report";

const sample = {
	implementation: "peculiar-sheets" as const,
	scenario: "paste-small" as const,
	kind: "interaction" as const,
	rows: 10_000,
	columns: 20,
	navigationToReadyMs: 400,
	mountMs: 300,
	domNodes: 500,
	heapBytesBeforeGc: 10_000_000,
	heapBytes: 8_000_000,
	interaction: {
		durationMs: 200,
		actions: 1,
		verifiedCells: 2_000,
		responseP50Ms: 80,
		responseP95Ms: 80,
		responseMaxMs: 80,
		responseSamples: 1,
		verifiedResponseP95Ms: 90,
		verifiedResponseSamples: 1,
		frameP95Ms: 50,
		maxFrameMs: 50,
		longTaskCount: 0,
		longTaskTotalMs: 0,
		scrollDistanceX: 0,
		scrollDistanceY: 0,
		streamBatches: 0,
		streamWrites: 0,
		streamBatchP95Ms: 0,
	},
};
const snapshot: ReportSnapshot = {
	generatedAt: "2026-11-02T00:00:00.000Z",
	iterations: 1,
	warmups: 0,
	results: [sample],
	skipped: [
		{
			implementation: "ag-grid",
			scenario: "paste-small",
			category: "unsupported",
			reason: "Clipboard requires Enterprise",
		},
	],
};

test("an unsupported clipboard case stays missing rather than becoming a zero or a winner", () => {
	const report = renderReport(snapshot);
	assert.equal(report.rows[0]?.bars[1]?.value, null);
	assert.match(report.html, /Clipboard requires Enterprise/);
	assert.equal((report.html.match(/class="value best"/g) ?? []).length, 3);
});

test("reports reject incomplete measurements and unexplained omissions", () => {
	assert.throws(() => renderReport({ ...snapshot, iterations: 3 }), /Incomplete measurements/);
	const mount = {
		...sample,
		implementation: "ag-grid" as const,
		scenario: "mount-small" as const,
		kind: "mount" as const,
	};
	assert.throws(
		() => renderReport({ ...snapshot, skipped: [], results: [sample, mount] }),
		/Missing measurements without a skip reason/,
	);
});
