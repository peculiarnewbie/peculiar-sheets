import {
	competitorConfigLabel,
	usesApiCompletion,
	validateReplacementTiming,
} from "./measurement-protocol";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Result, TaggedError } from "better-result";
import { SCENARIOS } from "../apps/benchmarks/src/scenarios";
import {
	type BenchmarkResult,
	type BenchmarkSkip,
	IMPLEMENTATIONS,
	type ImplementationName,
	type ScenarioName,
} from "../apps/benchmarks/src/types";
import { renderOverview } from "./overview";
import {
	describeSampling,
	expectedSamples,
	maxReachedScenarios,
	type SamplingMetadata,
	samplingMode,
	validateSampling,
} from "./sampling";

export interface ReportSnapshot extends SamplingMetadata {
	measurementProtocol?: string;
	competitorConfig?: string;
	cpuAffinity?: string;
	generatedAt: string;
	startedAt?: string;
	elapsedMs?: number;
	warmups: number;
	results: BenchmarkResult[];
	skipped?: BenchmarkSkip[];
}

interface Metric {
	scenario: ScenarioName;
	label: string;
	unit: "ms" | "MB";
	read: (sample: BenchmarkResult) => number | undefined;
}

const LABELS: Record<ImplementationName, string> = {
	"peculiar-sheets": "Peculiar Sheets",
	"ag-grid": "AG Grid",
	handsontable: "Handsontable",
	gridsheet: "GridSheet",
	revogrid: "RevoGrid",
	univer: "Univer",
};
const SHORT: Record<ImplementationName, string> = {
	"peculiar-sheets": "PS",
	"ag-grid": "AG",
	handsontable: "HOT",
	gridsheet: "GS",
	revogrid: "RV",
	univer: "U",
};
const escape = (value: string) =>
	value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;");
const median = (values: readonly number[]) => {
	const sorted = [...values].sort((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2
		? (sorted[middle] ?? 0)
		: ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
};

export function summarize(snapshot: ReportSnapshot) {
	validateSampling(snapshot);
	validateReplacementTiming(snapshot);
	const implementations = IMPLEMENTATIONS.filter(
		(implementation) =>
			snapshot.results.some((sample) => sample.implementation === implementation) ||
			snapshot.skipped?.some((skip) => skip.implementation === implementation),
	);
	const scenarios = [...new Set(snapshot.results.map((sample) => sample.scenario))];
	const metrics: Metric[] = [];
	for (const scenario of scenarios) {
		const config = SCENARIOS[scenario];
		const label = scenario.replaceAll("-", " ");
		if (config.kind === "mount") {
			metrics.push({
				scenario,
				label: `${label} · navigation to ready`,
				unit: "ms",
				read: (sample) => sample.navigationToReadyMs,
			});
			metrics.push({
				scenario,
				label: `${label} · mount`,
				unit: "ms",
				read: (sample) => sample.mountMs,
			});
			metrics.push({
				scenario,
				label: `${label} · retained heap`,
				unit: "MB",
				read: (sample) => (sample.heapBytes === null ? undefined : sample.heapBytes / 1e6),
			});
		} else if (config.kind === "scroll") {
			metrics.push({
				scenario,
				label: `${label} · frame p95`,
				unit: "ms",
				read: (sample) => (sample.kind === "scroll" ? sample.scroll.p95FrameMs : undefined),
			});
			metrics.push({
				scenario,
				label: `${label} · retained heap`,
				unit: "MB",
				read: (sample) => (sample.heapBytes === null ? undefined : sample.heapBytes / 1e6),
			});
		} else if (config.kind === "writes") {
			if (usesApiCompletion(snapshot.measurementProtocol))
				metrics.push({
					scenario,
					label: `${label} · API completion`,
					unit: "ms",
					read: (sample) =>
						sample.kind === "writes" ? sample.writes.completionDurationMs : undefined,
				});
			metrics.push({
				scenario,
				label: `${label} · synchronous`,
				unit: "ms",
				read: (sample) => (sample.kind === "writes" ? sample.writes.durationMs : undefined),
			});
			metrics.push({
				scenario,
				label: `${label} · settled`,
				unit: "ms",
				read: (sample) => (sample.kind === "writes" ? sample.writes.settledDurationMs : undefined),
			});
		} else if (config.kind === "replace") {
			metrics.push({
				scenario,
				label: `${label} · settled`,
				unit: "ms",
				read: (sample) =>
					sample.kind === "replace" ? sample.replacement.steps[0]?.settledMs : undefined,
			});
			if (config.replacement === "filter-roundtrip" || config.replacement === "insert-delete")
				metrics.push({
					scenario,
					label: `${label} · restore`,
					unit: "ms",
					read: (sample) =>
						sample.kind === "replace" ? sample.replacement.steps[1]?.settledMs : undefined,
				});
		} else {
			if (
				[
					"edit-commit",
					"keyboard-navigation",
					"paste-small",
					"paste-large",
					"clear-undo-redo",
				].includes(scenario)
			)
				metrics.push({
					scenario,
					label: `${label} · verified completion p95`,
					unit: "ms",
					read: (sample) =>
						sample.kind === "interaction" && sample.interaction.verifiedResponseSamples > 0
							? sample.interaction.verifiedResponseP95Ms
							: undefined,
				});
			metrics.push({
				scenario,
				label: `${label} · input response p95`,
				unit: "ms",
				read: (sample) =>
					sample.kind === "interaction" && sample.interaction.responseSamples > 0
						? sample.interaction.responseP95Ms
						: undefined,
			});
			metrics.push({
				scenario,
				label: `${label} · frame p95`,
				unit: "ms",
				read: (sample) =>
					sample.kind === "interaction" ? sample.interaction.frameP95Ms : undefined,
			});
			if (scenario === "streaming-updates")
				metrics.push({
					scenario,
					label: `${label} · batch p95`,
					unit: "ms",
					read: (sample) =>
						sample.kind === "interaction" ? sample.interaction.streamBatchP95Ms : undefined,
				});
		}
	}
	const rows = metrics.map((metric) => ({
		measurementProtocol: snapshot.measurementProtocol ?? "legacy-frame-settled",
		competitorConfig: competitorConfigLabel(snapshot),
		samplingMode: samplingMode(snapshot),
		scenario: metric.scenario,
		label: metric.label,
		unit: metric.unit,
		bars: implementations.map((implementation) => {
			const samples = snapshot.results.filter(
				(sample) => sample.scenario === metric.scenario && sample.implementation === implementation,
			);
			const values = samples
				.map(metric.read)
				.filter((value): value is number => value !== undefined && Number.isFinite(value));
			const skip = snapshot.skipped?.find(
				(skip) => skip.scenario === metric.scenario && skip.implementation === implementation,
			);
			if (!samples.length && !skip)
				throw new Error(
					`Missing measurements without a skip reason: ${metric.scenario}/${implementation}`,
				);
			if (
				samples.length &&
				samples.length !== expectedSamples(snapshot, metric.scenario, implementation)
			)
				throw new Error(`Incomplete measurements: ${metric.scenario}/${implementation}`);
			const stopReason = snapshot.adaptiveSampling?.cells.find(
				(cell) => cell.scenario === metric.scenario && cell.implementation === implementation,
			)?.stopReason;
			return {
				implementation,
				label: LABELS[implementation],
				samples: values.length,
				value: values.length ? median(values) : null,
				min: values.length ? Math.min(...values) : null,
				max: values.length ? Math.max(...values) : null,
				reason: skip?.reason ?? (values.length ? null : "Metric unavailable"),
				...(stopReason ? { stopReason } : {}),
			};
		}),
	}));
	return { implementations, scenarios, rows };
}

export function renderReport(snapshot: ReportSnapshot) {
	const { implementations, scenarios, rows } = summarize(snapshot);
	const tableRows = rows
		.map((row) => {
			const valid = row.bars.flatMap((bar) => (bar.value === null ? [] : [bar.value]));
			const max = Math.max(0.1, ...valid);
			const best = Math.min(...valid.map((value) => Number(value.toFixed(1))));
			const config = SCENARIOS[row.scenario];
			const dimensions = `${config.rows.toLocaleString("en-US")} × ${config.columns}${config.kind === "replace" ? ` → ${config.replacementRows.toLocaleString("en-US")} × ${config.columns}` : ""}`;
			return `<tr><th scope="row">${escape(row.label)}<span class="dimensions">${dimensions}</span></th><td>${row.bars
				.map((bar) => {
					const index = IMPLEMENTATIONS.indexOf(bar.implementation);
					const title =
						bar.value === null
							? (bar.reason ?? "Unavailable")
							: `${bar.samples} samples; range ${bar.min?.toFixed(1)}–${bar.max?.toFixed(1)} ${row.unit}`;
					return `<div class="line" title="${escape(title)}"><span class="name"><span class="full">${escape(bar.label)}</span><span class="short">${SHORT[bar.implementation]}</span></span>${bar.value === null ? `<span class="excluded">${escape(bar.reason ?? "Unavailable")}</span>` : `<span class="track"><span class="bar color-${index}" style="width:${Math.max(0.25, (bar.value / max) * 100).toFixed(3)}%"></span></span><span class="value${Number(bar.value.toFixed(1)) === best ? " best" : ""}">${bar.value.toFixed(1)} <span class="unit">${row.unit}</span></span>`}</div>`;
				})
				.join("")}</td></tr>`;
		})
		.join("\n");
	const colors = IMPLEMENTATIONS.map(
		(_, index) =>
			`.color-${index}{background:var(--chart-${index + 1},${["Highlight", "LinkText", "VisitedText", "ActiveText", "AccentColor", "GrayText"][index]})}`,
	).join("");
	const streaming = implementations.flatMap((implementation) => {
		const samples = snapshot.results.filter(
			(sample): sample is Extract<BenchmarkResult, { kind: "interaction" }> =>
				sample.kind === "interaction" &&
				sample.scenario === "streaming-updates" &&
				sample.implementation === implementation,
		);
		return samples.length
			? [
					`${SHORT[implementation]}: ${median(samples.map((sample) => sample.interaction.streamBatches)).toFixed(0)} batches / ${median(samples.map((sample) => sample.interaction.streamWrites)).toFixed(0)} writes`,
				]
			: [];
	});
	const streamingNote = streaming.length
		? `Streaming completed (median): ${streaming.join("; ")}.`
		: "";

	const maxReached = maxReachedScenarios(snapshot);
	const samplingNote = snapshot.adaptiveSampling
		? `Adaptive sampling (${snapshot.adaptiveSampling.protocol}): every case took at least ${snapshot.adaptiveSampling.minIterations} interleaved runs per library and stopped once each headline's Peculiar Sheets ÷ best ratio had a ${Math.round(snapshot.adaptiveSampling.confidence * 100)}% bootstrap interval entirely at or below, or above, ${snapshot.adaptiveSampling.threshold}x. ${maxReached.length ? `Reached the maximum without deciding every headline (informational, not a verdict; undecided headlines count as a pass: best or within ${snapshot.adaptiveSampling.threshold}x): ${maxReached.join(", ")}.` : "Every case decided before its maximum."}`
		: "";
	const runtime =
		snapshot.elapsedMs === undefined
			? ""
			: ` · ${(snapshot.elapsedMs / 60_000).toFixed(1)} minutes total`;
	const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Spreadsheet core benchmarks</title><style>
:root{font-family:var(--font-sans,system-ui,sans-serif);color:var(--foreground,CanvasText);color-scheme:light dark}*{box-sizing:border-box}body{margin:0}.meta,footer{font-size:11px;line-height:1.5;color:var(--muted-foreground,GrayText)}.meta{margin:0 0 12px}.legend{display:flex;flex-wrap:wrap;gap:6px 14px;font-size:11px;margin-bottom:12px}.legend span{display:inline-flex;align-items:center;gap:5px}.swatch{width:8px;height:8px;border-radius:2px}${colors}table{width:100%;table-layout:fixed;border-collapse:collapse}col.metric{width:33%}th{text-align:left}thead th{font-size:11px;font-weight:500;color:var(--muted-foreground,GrayText);padding-bottom:8px}tbody tr{border-top:1px solid var(--border,GrayText)}tbody th{font-size:12px;font-weight:500;line-height:1.5;padding:8px 12px 8px 0;overflow-wrap:anywhere}.dimensions{display:block;font-size:10px;color:var(--muted-foreground,GrayText);font-weight:400}td{padding:8px 0}.line{display:grid;grid-template-columns:96px minmax(0,1fr) 76px;gap:7px;align-items:center;height:24px;font-size:11px}.name{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--muted-foreground,GrayText)}.track{height:7px;background:var(--secondary,ButtonFace);overflow:hidden;border-radius:2px}.bar{height:7px;display:block;min-width:1px}.value{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}.unit{font-size:10px;color:var(--muted-foreground,GrayText)}.best{font-weight:750}.excluded{grid-column:2/4;color:var(--muted-foreground,GrayText);font-size:10px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}.short{display:none}footer{margin-top:12px}footer p{margin:7px 0}@media(max-width:520px){.line{grid-template-columns:26px minmax(0,1fr) 68px;gap:4px}.full{display:none}.short{display:inline}tbody th{font-size:11px;padding-right:8px}.unit{font-size:9px}}
</style></head><body><p class="meta">${scenarios.length} scenarios · ${snapshot.results.length} measured samples · ${escape(describeSampling(snapshot, scenarios))}; fresh browser per sample${runtime}.<br>Lower is better. Independent bar scales per row; bold values are lowest at displayed precision. Hover for sample ranges or omission reasons.</p><div class="legend">${implementations.map((implementation) => `<span><i class="swatch color-${IMPLEMENTATIONS.indexOf(implementation)}"></i>${SHORT[implementation]} · ${LABELS[implementation]}</span>`).join("")}</div><table><colgroup><col class="metric"><col></colgroup><thead><tr><th scope="col">Measurement</th><th scope="col">${implementations.length} libraries · same order throughout</th></tr></thead><tbody>${tableRows}</tbody></table><footer><p>${escape(streamingNote)}</p><p>Trusted browser input drives editing, navigation, native clipboard paste, and wheel scrolling. Input response is measured from the browser's event handler entry through two animation frames. It is a rendering-response proxy, not INP or proof of final paint. Values and focus are verified separately. Verified completion includes the driver verification roundtrip and excludes cell-scan cost. Scripted total duration includes driver overhead and pacing and is omitted from rankings.</p><p>Mount includes initialization and two frames; navigation to ready also includes adapter loading. Write diagnostics separate synchronous submission, awaited API completion (protocol v2), and frame settling. Historical protocols retain their original scoring. Replacement timings exclude data-integrity scans. Retained heap is JavaScript memory after explicit GC, in decimal MB. The sparse workload uses a dense matrix with 95% blank cells.</p><p>Unsupported Community-edition features and disabled cases appear with omission reasons. GridSheet and Univer remain opt-in; their new browser interaction adapters are not implemented. Long-session and formula workloads are excluded. Measurements: ${escape(snapshot.generatedAt)}. Protocol: ${escape(snapshot.measurementProtocol ?? "legacy-frame-settled")}. Competitor configuration: ${escape(competitorConfigLabel(snapshot))}. CPU affinity: ${escape(snapshot.cpuAffinity ?? "unrecorded")}.</p>${samplingNote ? `<p>${escape(samplingNote)}</p>` : ""}</footer></body></html>`;
	const csv =
		[
			"scenario,metric,implementation,unit,samples,median,min,max,omission,measurementProtocol,competitorConfig,samplingMode,stopReason",
			...rows.flatMap((row) =>
				row.bars.map((bar) =>
					[
						row.scenario,
						row.label,
						bar.implementation,
						row.unit,
						bar.samples,
						bar.value ?? "",
						bar.min ?? "",
						bar.max ?? "",
						bar.reason ?? "",
						snapshot.measurementProtocol ?? "legacy-frame-settled",
						competitorConfigLabel(snapshot),
						samplingMode(snapshot),
						bar.stopReason ?? "",
					]
						.map((value) => `"${String(value).replaceAll('"', '""')}"`)
						.join(","),
				),
			),
		].join("\n") + "\n";
	const markdown = [
		"# Spreadsheet core benchmark results",
		`Measurement protocol: ${snapshot.measurementProtocol ?? "legacy-frame-settled"}. Competitor configuration: ${competitorConfigLabel(snapshot)}. Different protocols or configurations must not be compared as speedups.`,
		`Measured ${snapshot.generatedAt}; ${snapshot.results.length} samples across ${scenarios.length} scenarios, ${describeSampling(snapshot, scenarios)}, ${snapshot.warmups} warmups${runtime}.`,
		...(samplingNote ? [samplingNote] : []),
		"Input response measures trusted event-handler entry through two animation frames. It is a rendering-response proxy, not INP. Scripted duration includes driver overhead; correctness checks run separately. Memory is decimal MB after explicit GC. See comparison-table.html for the complete table and summary.csv for raw median/range exports.",
		[
			"| Measurement | " +
				implementations.map((implementation) => LABELS[implementation]).join(" | ") +
				" |",
			"| --- | " + implementations.map(() => "---").join(" | ") + " |",
			...rows.map(
				(row) =>
					`| ${row.label} (${row.unit}) | ${row.bars.map((bar) => (bar.value === null ? bar.reason : bar.value.toFixed(1))).join(" | ")} |`,
			),
		].join("\n"),
		"",
		streamingNote,
		"Long sessions and formulas are excluded. Sparse data is stored as a dense matrix with 95% blanks. Retained-ID semantics vary by library; replacement scenarios use public bulk replacement APIs.",
		"",
	].join("\n\n");
	return { html, csv, markdown, rows };
}

class BenchmarkReportError extends TaggedError("BenchmarkReportError")<{
	message: string;
	cause: unknown;
}> {}

export function writeBenchmarkReport(snapshot: ReportSnapshot, directory: string) {
	return Result.tryPromise({
		try: async () => {
			const report = renderReport(snapshot);
			await mkdir(directory, { recursive: true });
			await Promise.all([
				writeFile(path.join(directory, "overview.html"), renderOverview(snapshot)),
				writeFile(path.join(directory, "comparison-table.html"), report.html),
				writeFile(path.join(directory, "comparison.html"), report.html),
				writeFile(path.join(directory, "summary.csv"), report.csv),
				writeFile(
					path.join(directory, "summary.json"),
					JSON.stringify(report.rows, null, 2) + "\n",
				),
				writeFile(path.join(directory, "report.md"), report.markdown),
			]);
			return { rows: report.rows.length, samples: snapshot.results.length };
		},
		catch: (cause) =>
			new BenchmarkReportError({ message: "Could not generate benchmark report", cause }),
	}).then((result) =>
		result.tapError((error) =>
			console.debug("benchmark.report.failed", { directory, cause: error.cause }),
		),
	);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const directory = path.resolve(process.cwd(), process.env.BENCHMARK_OUTPUT_DIR ?? ".benchmark");
	const loaded = await Result.tryPromise({
		try: async () =>
			JSON.parse(await readFile(path.join(directory, "latest.json"), "utf8")) as ReportSnapshot,
		catch: (cause) =>
			new BenchmarkReportError({ message: "Could not read benchmark results", cause }),
	});
	if (loaded.isErr()) throw loaded.error;
	const written = await writeBenchmarkReport(loaded.value, directory);
	if (written.isErr()) throw written.error;
	console.log(
		`Generated ${written.value.rows} comparison rows from ${written.value.samples} samples in ${directory}`,
	);
}
