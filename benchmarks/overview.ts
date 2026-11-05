import {
	competitorConfigLabel,
	usesApiCompletion,
	validateReplacementTiming,
} from "./measurement-protocol";
import type {
	BenchmarkResult,
	ImplementationName,
	ScenarioName,
} from "../apps/benchmarks/src/types";
import type { ReportSnapshot } from "./report";
import { describeSampling, validateSampling } from "./sampling";

type Status = "best" | "near" | "behind";
interface Category {
	id: string;
	label: string;
	note: string;
	unit: "ms" | "MB";
	scenarios: readonly ScenarioName[];
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
const median = (values: readonly number[]) => {
	const sorted = [...values].sort((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2
		? (sorted[middle] ?? 0)
		: ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
};
const escape = (value: string) =>
	value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;");

const MOUNTS = [
	"mount-small",
	"mount-large",
	"mount-tall",
	"mount-wide",
	"mount-mixed",
	"mount-sparse",
] as const;
const CATEGORIES: readonly Category[] = [
	{
		id: "opening",
		label: "Opening sheets",
		note: "Page → ready, including library loading. Mount-only timing is a separate measure.",
		unit: "ms",
		scenarios: MOUNTS,
		read: (sample) => sample.navigationToReadyMs,
	},
	{
		id: "editing",
		label: "Editing & clipboard",
		note: "Verified completion of edits, navigation, two paste sizes, and undo/redo.",
		unit: "ms",
		scenarios: [
			"edit-commit",
			"keyboard-navigation",
			"paste-small",
			"paste-large",
			"clear-undo-redo",
		],
		read: (sample) =>
			sample.kind === "interaction" && sample.interaction.verifiedResponseSamples > 0
				? sample.interaction.verifiedResponseP95Ms
				: undefined,
	},
	{
		id: "updates",
		label: "Updating cells",
		note: "API completion includes returned promises; live updates use frame smoothness.",
		unit: "ms",
		scenarios: ["visible-writes", "offscreen-writes", "batch-writes", "streaming-updates"],
		read: (sample) =>
			sample.kind === "writes"
				? (sample.writes.completionDurationMs ?? sample.writes.settledDurationMs)
				: sample.kind === "interaction"
					? sample.interaction.frameP95Ms
					: undefined,
	},
	{
		id: "replacement",
		label: "Replacing & changing rows",
		note: "Whole-operation time, including both steps of shrink/restore and insert/delete.",
		unit: "ms",
		scenarios: [
			"replace-large-disjoint",
			"replace-large-retained",
			"replace-small-disjoint",
			"replace-small-large",
			"replace-filter-roundtrip",
			"replace-few-cells",
			"replace-wide-retained",
			"replace-wide-grow",
			"row-reorder",
			"row-insert-delete",
		],
		read: (sample) =>
			sample.kind === "replace"
				? sample.replacement.steps.reduce((sum, step) => sum + step.settledMs, 0)
				: undefined,
	},
	{
		id: "scrolling",
		label: "Scrolling",
		note: "Frame delays during full-range scrolling, wheel input, diagonal movement, and jumps.",
		unit: "ms",
		scenarios: [
			"vertical-scroll",
			"horizontal-scroll",
			"scroll-wheel-slow",
			"scroll-wheel-bursts",
			"scroll-diagonal",
			"scroll-jump",
		],
		read: (sample) =>
			sample.kind === "scroll"
				? sample.scroll.p95FrameMs
				: sample.kind === "interaction"
					? sample.interaction.frameP95Ms
					: undefined,
	},
	{
		id: "memory",
		label: "Memory footprint",
		note: "Retained JavaScript heap after garbage collection. Smaller is better.",
		unit: "MB",
		scenarios: [...MOUNTS, "vertical-scroll", "horizontal-scroll"],
		read: (sample) => (sample.heapBytes === null ? undefined : sample.heapBytes / 1e6),
	},
];

export function summarizeOverview(snapshot: ReportSnapshot) {
	validateSampling(snapshot);
	validateReplacementTiming(snapshot);
	if (
		usesApiCompletion(snapshot.measurementProtocol) &&
		snapshot.results.some(
			(sample) =>
				sample.kind === "writes" &&
				(sample.writes.completionDurationMs === undefined ||
					!Number.isFinite(sample.writes.completionDurationMs) ||
					sample.writes.completionDurationMs <= 0),
		)
	)
		throw new Error("Protocol v2 requires complete API completion measurements");
	return CATEGORIES.map((category) => {
		const cases = category.scenarios.flatMap((scenario) => {
			const samples = snapshot.results.filter((sample) => sample.scenario === scenario);
			const implementations = [...new Set(samples.map((sample) => sample.implementation))];
			const values = implementations.flatMap((implementation) => {
				const measured = samples
					.filter((sample) => sample.implementation === implementation)
					.map((sample) =>
						category.id === "updates" && sample.kind === "writes"
							? usesApiCompletion(snapshot.measurementProtocol)
								? sample.writes.completionDurationMs
								: sample.writes.settledDurationMs
							: category.read(sample),
					)
					.filter((value): value is number => value !== undefined && Number.isFinite(value));
				return measured.length ? [{ implementation, value: median(measured) }] : [];
			});
			const own = values.find((value) => value.implementation === "peculiar-sheets");
			if (!own || values.length < 2) return [];
			const best = Math.min(...values.map((value) => value.value));
			const status: Status =
				Number(own.value.toFixed(1)) === Number(best.toFixed(1))
					? "best"
					: own.value <= best * 1.2
						? "near"
						: "behind";
			return [
				{
					scenario,
					own: own.value,
					best,
					status,
					winners: values
						.filter((value) => Number(value.value.toFixed(1)) === Number(best.toFixed(1)))
						.map((value) => LABELS[value.implementation]),
					competitors: values.length - 1,
				},
			];
		});
		return {
			id: category.id,
			label: category.label,
			note:
				category.id === "updates" && !usesApiCompletion(snapshot.measurementProtocol)
					? "Legacy settled writes include two animation-frame waits; not comparable to protocol v2 API completion."
					: category.id === "replacement"
						? `Timing: ${snapshot.measurementProtocol ?? "legacy unaligned"}. Protocol changes are measurement changes, not speedups. ${category.note}`
						: category.note,
			unit: category.unit,
			cases,
			best: cases.filter((item) => item.status === "best").length,
			near: cases.filter((item) => item.status === "near").length,
			behind: cases.filter((item) => item.status === "behind").length,
		};
	}).filter((category) => category.cases.length);
}

export function renderOverview(snapshot: ReportSnapshot): string {
	const categories = summarizeOverview(snapshot);
	const opening = categories.find((category) => category.id === "opening");
	const editing = categories.find((category) => category.id === "editing");
	const scrolling = categories.find((category) => category.id === "scrolling");
	const takeaway = !categories.length
		? "Include Peculiar Sheets and another library to see a comparison."
		: opening &&
				opening.best === opening.cases.length &&
				editing &&
				editing.best / editing.cases.length >= 0.75 &&
				scrolling &&
				scrolling.behind === scrolling.cases.length
			? "Quick to open, strong at editing and paste.<br>Scrolling is the clearest area to improve."
			: "Where Peculiar Sheets leads, stays close, and trails the best.";
	const libraryCount = new Set(snapshot.results.map((sample) => sample.implementation)).size;
	const groups = categories
		.map(
			(category) =>
				`<details><summary><span class="name">${escape(category.label)}</span><span class="count"><b>${category.best}</b> / ${category.cases.length} best</span><span class="strip" aria-label="${category.best} best, ${category.near} within 20% of best, ${category.behind} more than 20% behind">${category.cases.map((item) => `<i class="${item.status}" title="${escape(item.scenario)}: ${item.own.toFixed(1)} ${category.unit}; best ${item.best.toFixed(1)} ${category.unit}"></i>`).join("")}</span><span class="note">${escape(category.note)}</span><span class="toggle" aria-hidden="true">+</span></summary><div class="expanded"><p>${category.id === "replacement" ? "Roundtrip cases count once, using the total time of both steps. " : ""}${category.id === "editing" ? "Verified completion includes the driver's verification roundtrip. " : ""}Lower is better. Missing or disabled libraries are omitted.</p><table><thead><tr><th scope="col">Case</th><th scope="col">Ours</th><th scope="col">Best</th></tr></thead><tbody>${category.cases.map((item) => `<tr><th scope="row">${escape(item.scenario.replaceAll("-", " "))}<small>${item.competitors + 1} libraries compared</small></th><td>${item.own.toFixed(1)} ${category.unit}</td><td>${item.best.toFixed(1)} ${category.unit}<small>${escape(item.winners.join(", "))}</small></td></tr>`).join("")}</tbody></table></div></details>`,
		)
		.join("");
	return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Spreadsheet benchmark overview</title><style>
:root{font-family:var(--font-sans,system-ui,sans-serif);color:var(--foreground,CanvasText);color-scheme:light dark}*{box-sizing:border-box}body{margin:0}.takeaway{font-size:16px;line-height:1.5;margin:0 0 14px;font-weight:550}.legend{display:flex;flex-wrap:wrap;gap:6px 16px;font-size:11px;color:var(--muted-foreground,GrayText);margin:0 0 12px}.legend span{display:inline-flex;align-items:center;gap:6px}.legend i{width:10px;height:10px;display:inline-block;border-radius:2px}.best{background:var(--chart-1,Highlight)}.near{background:var(--chart-2,LinkText)}.behind{background:var(--chart-3,GrayText)}details{border-top:1px solid var(--border,GrayText)}summary{display:grid;grid-template-columns:minmax(0,1fr) 92px 140px 12px;align-items:center;gap:7px 12px;padding:14px 0;cursor:pointer;list-style:none}summary::-webkit-details-marker{display:none}.name{font-size:14px;font-weight:600}.count{font-size:12px;text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}.count b{font-size:17px}.strip{display:flex;height:12px;gap:3px}.strip i{display:block;flex:1;min-width:0;border-radius:2px}.note{grid-column:1/4;font-size:12px;line-height:1.5;color:var(--muted-foreground,GrayText)}.toggle{grid-column:4;grid-row:1/3;font-size:18px;color:var(--muted-foreground,GrayText);text-align:right}details[open] .toggle{font-size:0}details[open] .toggle:after{content:"−";font-size:18px}.expanded{padding:0 0 14px}.expanded p{font-size:11px;line-height:1.5;color:var(--muted-foreground,GrayText);margin:0 0 8px}table{width:100%;border-collapse:collapse;table-layout:fixed}th,td{padding:7px 8px 7px 0;text-align:left;vertical-align:top;font-size:11px;font-weight:400;border-top:1px solid var(--border,GrayText)}thead th{color:var(--muted-foreground,GrayText)}th:first-child{width:45%}td{font-variant-numeric:tabular-nums}small{display:block;font-size:10px;color:var(--muted-foreground,GrayText);line-height:1.5}footer{border-top:1px solid var(--border,GrayText);padding-top:10px;font-size:11px;line-height:1.55;color:var(--muted-foreground,GrayText)}footer p{margin:0 0 7px}summary:focus-visible{outline:2px solid var(--ring,Highlight);outline-offset:3px;border-radius:var(--radius,4px)}@media(max-width:520px){summary{grid-template-columns:minmax(0,1fr) 78px 84px 10px;gap:6px;padding:13px 0}.name{font-size:12px}.count{font-size:10px}.count b{font-size:15px}.strip{height:10px;gap:2px}.note{font-size:11px}.takeaway{font-size:14px}}
</style></head><body><p class="takeaway">${takeaway}</p><div class="legend"><span><i class="best"></i>Best</span><span><i class="near"></i>Within 20% of best</span><span><i class="behind"></i>More than 20% behind</span></div>${groups}<footer><p>Each block is one case. Tap a category for the numbers. One main measure per scenario; no overall score. “Within 20%” is a visual guide, not a statistical tie.</p><p>${snapshot.results.length} samples · ${escape(
		describeSampling(
			snapshot,
			snapshot.results.map((sample) => sample.scenario),
		),
	)} on this machine. ${libraryCount} libraries; unavailable or disabled cases omitted. Memory reuses mount/scroll samples and measures retained JavaScript heap. Best values tie at one-decimal precision. Competitor configuration: ${escape(competitorConfigLabel(snapshot))}; configuration changes are measurement changes, not speedups.</p></footer></body></html>`;
}
