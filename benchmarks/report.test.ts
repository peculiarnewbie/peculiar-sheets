import assert from "node:assert/strict";
import { test } from "node:test";
import { COMPETITOR_CONFIG } from "../apps/benchmarks/src/types";
import { renderOverview } from "./overview";
import { type ReportSnapshot, renderReport } from "./report";
import { ADAPTIVE_SAMPLING_PROTOCOL } from "./sampling";

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

test("mixed-count reports require complete case-specific samples and display their actual counts", () => {
	const mount = { ...sample, scenario: "mount-small" as const, kind: "mount" as const };
	const mixed: ReportSnapshot = {
		...snapshot,
		scenarioIterations: { "paste-small": 2 },
		results: [sample, { ...sample }, mount, { ...mount, implementation: "ag-grid" }],
	};
	const report = renderReport(mixed);
	assert.equal(report.rows.find((row) => row.scenario === "paste-small")?.bars[0]?.samples, 2);
	assert.equal(report.rows.find((row) => row.scenario === "mount-small")?.bars[0]?.samples, 1);
	assert.match(report.html, /median of 1–2 runs per case \(paste-small: 2\)/);
	assert.match(report.markdown, /median of 1–2 runs per case/);
	assert.match(report.csv, /"paste-small","[^"]+","peculiar-sheets","ms","2"/);
	assert.throws(
		() => renderReport({ ...mixed, results: mixed.results.slice(1) }),
		/Incomplete measurements/,
	);
});

test("invalid or unknown count overrides cannot bypass report completeness checks", () => {
	for (const count of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
		assert.throws(
			() => renderReport({ ...snapshot, scenarioIterations: { "paste-small": count } }),
			/Invalid sample count/,
		);
	}
	assert.throws(() => renderReport({ ...snapshot, iterations: 0 }), /Invalid default sample count/);
	const unknown = JSON.parse(
		JSON.stringify({ ...snapshot, scenarioIterations: { "unknown-case": 2 } }),
	);
	assert.throws(() => renderReport(unknown), /Unknown sampling scenario/);
});

test("reports label the competitor configuration and treat unmarked snapshots as full bundles", () => {
	const current = renderReport({ ...snapshot, competitorConfig: COMPETITOR_CONFIG });
	assert.equal(current.rows[0]?.competitorConfig, COMPETITOR_CONFIG);
	assert.match(current.csv, /,competitorConfig,samplingMode,stopReason\n/);
	assert.match(current.csv, /"scenario-modules-v1","fixed",""\n/);
	assert.match(current.markdown, /Competitor configuration: scenario-modules-v1/);
	assert.match(current.html, /Competitor configuration: scenario-modules-v1/);
	assert.match(
		renderOverview({ ...snapshot, competitorConfig: COMPETITOR_CONFIG }),
		/Competitor configuration: scenario-modules-v1/,
	);
	const legacy = renderReport(snapshot);
	assert.equal(legacy.rows[0]?.competitorConfig, "legacy-full-bundles");
	assert.match(legacy.markdown, /Competitor configuration: legacy-full-bundles/);
});

test("adaptive reports validate per-pair counts and note cases that reached the maximum", () => {
	const competitor = { ...sample, implementation: "revogrid" as const };
	const mount = { ...sample, scenario: "mount-small" as const, kind: "mount" as const };
	const adaptive: ReportSnapshot = {
		...snapshot,
		samplingMode: "adaptive",
		iterations: 12,
		skipped: [
			...(snapshot.skipped ?? []),
			{
				implementation: "ag-grid",
				scenario: "mount-small",
				category: "unsupported",
				reason: "Not part of this fixture",
			},
		],
		adaptiveSampling: {
			protocol: ADAPTIVE_SAMPLING_PROTOCOL,
			minIterations: 2,
			confidence: 0.95,
			threshold: 1.2,
			resamples: 2_000,
			seed: 1,
			cells: [
				{
					scenario: "paste-small",
					implementation: "peculiar-sheets",
					samples: 3,
					stopReason: "max-reached",
				},
				{
					scenario: "paste-small",
					implementation: "revogrid",
					samples: 3,
					stopReason: "max-reached",
				},
				{
					scenario: "mount-small",
					implementation: "peculiar-sheets",
					samples: 2,
					stopReason: "decided",
				},
				{ scenario: "mount-small", implementation: "revogrid", samples: 2, stopReason: "decided" },
			],
			headlines: [],
		},
		results: [
			sample,
			sample,
			sample,
			competitor,
			competitor,
			competitor,
			mount,
			mount,
			{ ...mount, implementation: "revogrid" },
			{ ...mount, implementation: "revogrid" },
		],
	};
	const report = renderReport(adaptive);
	const paste = report.rows.find((row) => row.scenario === "paste-small");
	assert.equal(paste?.samplingMode, "adaptive");
	assert.deepEqual(
		paste?.bars.map((bar) => [bar.implementation, bar.samples, bar.stopReason]),
		[
			["peculiar-sheets", 3, "max-reached"],
			["ag-grid", 0, undefined],
			["revogrid", 3, "max-reached"],
		],
	);
	assert.match(
		report.csv,
		/"paste-small","[^"]+","peculiar-sheets","ms","3",.*"adaptive","max-reached"\n/,
	);
	assert.match(report.markdown, /adaptive median of 2–3 runs per case/);
	assert.match(
		report.markdown,
		/Reached the maximum without deciding every headline .*: paste-small\./,
	);
	assert.match(report.html, /Reached the maximum without deciding every headline/);
	assert.match(renderOverview(adaptive), /Reached the adaptive sampling maximum .*: paste-small\./);
	assert.throws(
		() => renderReport({ ...adaptive, results: adaptive.results.slice(1) }),
		/Incomplete measurements/,
	);
	const settings = adaptive.adaptiveSampling;
	if (!settings) throw new Error("Expected adaptive settings");
	assert.throws(
		() =>
			renderReport({
				...adaptive,
				adaptiveSampling: { ...settings, cells: settings.cells.slice(1) },
			}),
		/Incomplete measurements: paste-small\/peculiar-sheets/,
	);
});
