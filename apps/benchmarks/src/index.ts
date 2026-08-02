import type {
	BenchmarkAdapter,
	BenchmarkController,
	BenchmarkDataset,
	BenchmarkResult,
	BenchmarkScenario,
	ImplementationName,
	ScrollMetrics,
	WriteMetrics,
	ReplacementMetrics,
} from "./types";
import { IMPLEMENTATIONS, SCENARIO_NAMES } from "./types";
import "./styles.css";

const SCENARIOS: Record<(typeof SCENARIO_NAMES)[number], BenchmarkScenario> = {
	"mount-small": { name: "mount-small", kind: "mount", rows: 1_000, columns: 20 },
	"mount-large": { name: "mount-large", kind: "mount", rows: 10_000, columns: 20 },
	"vertical-scroll": { name: "vertical-scroll", kind: "scroll", rows: 10_000, columns: 20, axis: "vertical", durationMs: 2_000 },
	"horizontal-scroll": { name: "horizontal-scroll", kind: "scroll", rows: 1_000, columns: 200, axis: "horizontal", durationMs: 2_000 },
	"visible-writes": { name: "visible-writes", kind: "writes", rows: 10_000, columns: 20, distribution: "visible", mode: "independent", count: 250 },
	"offscreen-writes": { name: "offscreen-writes", kind: "writes", rows: 10_000, columns: 20, distribution: "offscreen", mode: "independent", count: 250 },
	"batch-writes": { name: "batch-writes", kind: "writes", rows: 10_000, columns: 20, distribution: "offscreen", mode: "batch", count: 250 },
	"replace-large-disjoint": { name: "replace-large-disjoint", kind: "replace", rows: 10_000, replacementRows: 10, columns: 1, replacement: "disjoint" },
	"replace-large-retained": { name: "replace-large-retained", kind: "replace", rows: 10_000, replacementRows: 10, columns: 1, replacement: "retained" },
	"replace-small-disjoint": { name: "replace-small-disjoint", kind: "replace", rows: 10, replacementRows: 10, columns: 1, replacement: "disjoint" },
	"replace-small-large": { name: "replace-small-large", kind: "replace", rows: 10, replacementRows: 10_000, columns: 1, replacement: "disjoint" },
	"replace-filter-roundtrip": { name: "replace-filter-roundtrip", kind: "replace", rows: 10_000, replacementRows: 10, columns: 1, replacement: "filter-roundtrip" },
	"replace-few-cells": { name: "replace-few-cells", kind: "replace", rows: 10_000, replacementRows: 10_000, columns: 1, replacement: "few-cells" },
};

function parseQuery(): { implementation: ImplementationName; scenario: BenchmarkScenario } {
	const query = new URLSearchParams(location.search);
	const requestedImplementation = query.get("implementation");
	const requestedScenario = query.get("scenario");
	if (!IMPLEMENTATIONS.some((name) => name === requestedImplementation)) {
		throw new Error(`Unknown implementation ${JSON.stringify(requestedImplementation)}. Expected ${IMPLEMENTATIONS.join(", ")}`);
	}
	if (!SCENARIO_NAMES.some((name) => name === requestedScenario)) {
		throw new Error(`Unknown scenario ${JSON.stringify(requestedScenario)}. Expected ${SCENARIO_NAMES.join(", ")}`);
	}
	const baseScenario = SCENARIOS[requestedScenario as keyof typeof SCENARIOS];
	const rows = parsePositiveInteger(query.get("rows"), "rows") ?? baseScenario.rows;
	const columns = parsePositiveInteger(query.get("columns"), "columns") ?? baseScenario.columns;
	const durationMs = parsePositiveInteger(query.get("durationMs"), "durationMs");
	const scenario = baseScenario.kind === "scroll" && durationMs !== undefined
		? { ...baseScenario, rows, columns, durationMs }
		: { ...baseScenario, rows, columns };
	return {
		implementation: requestedImplementation as ImplementationName,
		scenario,
	};
}

function parsePositiveInteger(value: string | null, name: string): number | undefined {
	if (value === null) return undefined;
	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed < 1) {
		throw new Error(`${name} must be a positive integer, received ${JSON.stringify(value)}`);
	}
	return parsed;
}

async function loadAdapter(implementation: ImplementationName): Promise<BenchmarkAdapter> {
	switch (implementation) {
		case "peculiar-sheets": return (await import("./adapters/peculiar-sheets")).adapter;
		case "ag-grid": return (await import("./adapters/ag-grid")).adapter;
		case "handsontable": return (await import("./adapters/handsontable")).adapter;
	}
}

function createDataset({ rows, columns }: Pick<BenchmarkScenario, "rows" | "columns">): BenchmarkDataset {
	return {
		rows,
		columns,
		rowIds: Array.from({ length: rows }, (_, row) => `initial-${row}`),
		values: Array.from({ length: rows }, (_, row) =>
			Array.from({ length: columns }, (_, column) => row * columns + column),
		),
	};
}

function createReplacementDataset(
	scenario: Extract<BenchmarkScenario, { kind: "replace" }>,
	initial: BenchmarkDataset,
): BenchmarkDataset {
	if (scenario.replacement === "retained" || scenario.replacement === "filter-roundtrip") {
		const start = Math.max(0, initial.rows - scenario.replacementRows);
		return {
			rows: scenario.replacementRows,
			columns: scenario.columns,
			rowIds: initial.rowIds.slice(start),
			values: initial.values.slice(start).map((row) => [...row]),
		};
	}
	if (scenario.replacement === "few-cells") {
		const values = initial.values.map((row) => [...row]);
		for (const row of [0, Math.floor(initial.rows / 2), initial.rows - 1]) {
			if (values[row]) values[row][0] = `changed-${row}`;
		}
		return { ...initial, values };
	}
	return {
		rows: scenario.replacementRows,
		columns: scenario.columns,
		rowIds: Array.from({ length: scenario.replacementRows }, (_, row) => `replacement-${row}`),
		values: Array.from({ length: scenario.replacementRows }, (_, row) =>
			Array.from({ length: scenario.columns }, (_, column) => 1_000_000 + row * scenario.columns + column),
		),
	};
}

function nextFrame(): Promise<void> {
	return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function percentile(sorted: readonly number[], ratio: number): number {
	if (sorted.length === 0) return 0;
	return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))] ?? 0;
}

async function measureScroll(controller: BenchmarkController, scenario: Extract<BenchmarkScenario, { kind: "scroll" }>): Promise<ScrollMetrics> {
	const viewport = controller.getScrollElement();
	controller.scrollToRow(0);
	viewport.scrollLeft = 0;
	await nextFrame();
	const frameTimes: number[] = [];
	const longTasks: number[] = [];
	const observer = typeof PerformanceObserver !== "undefined"
		? new PerformanceObserver((list) => {
			for (const entry of list.getEntries()) longTasks.push(entry.duration);
		})
		: null;
	try {
		observer?.observe({ type: "longtask", buffered: false });
	} catch {
		// Some browsers do not expose the Long Tasks API.
	}

	const start = performance.now();
	let previous = start;
	await new Promise<void>((resolve) => {
		function step(now: number) {
			frameTimes.push(now - previous);
			previous = now;
			const progress = Math.min(1, (now - start) / scenario.durationMs);
			const triangle = progress <= 0.5 ? progress * 2 : (1 - progress) * 2;
			if (scenario.axis === "vertical") {
				viewport.scrollTop = triangle * Math.max(0, viewport.scrollHeight - viewport.clientHeight);
			} else {
				viewport.scrollLeft = triangle * Math.max(0, viewport.scrollWidth - viewport.clientWidth);
			}
			if (progress < 1) requestAnimationFrame(step);
			else resolve();
		}
		requestAnimationFrame(step);
	});
	observer?.disconnect();
	const durationMs = performance.now() - start;
	const sorted = frameTimes.slice(1).sort((a, b) => a - b);
	return {
		axis: scenario.axis,
		durationMs,
		frames: sorted.length,
		medianFrameMs: percentile(sorted, 0.5),
		p95FrameMs: percentile(sorted, 0.95),
		maxFrameMs: sorted.at(-1) ?? 0,
		longTaskCount: longTasks.length,
		longTaskTotalMs: longTasks.reduce((sum, duration) => sum + duration, 0),
	};
}

function writeTarget(index: number, scenario: Extract<BenchmarkScenario, { kind: "writes" }>): { row: number; column: number } {
	if (scenario.distribution === "visible") {
		return { row: index % 20, column: Math.floor(index / 20) % scenario.columns };
	}
	return { row: (index * 97) % scenario.rows, column: index % scenario.columns };
}

async function measureWrites(controller: BenchmarkController, scenario: Extract<BenchmarkScenario, { kind: "writes" }>): Promise<WriteMetrics> {
	controller.scrollToRow(0);
	await nextFrame();
	const writes = Array.from({ length: scenario.count }, (_, index) => {
		const target = writeTarget(index, scenario);
		return { ...target, value: `value-${index}` };
	});
	const start = performance.now();
	if (scenario.mode === "batch") {
		controller.writeCells(writes);
	} else {
		for (const write of writes) {
			controller.writeCell(write.row, write.column, write.value);
		}
	}
	const durationMs = performance.now() - start;
	await nextFrame();
	await nextFrame();
	const settledDurationMs = performance.now() - start;
	const lastTarget = writeTarget(scenario.count - 1, scenario);
	const expected = `value-${scenario.count - 1}`;
	const actual = controller.readCell(lastTarget.row, lastTarget.column);
	if (actual !== expected) {
		throw new Error(`Write workload failed its data-integrity check: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
	}
	return {
		distribution: scenario.distribution,
		mode: scenario.mode,
		count: scenario.count,
		durationMs,
		settledDurationMs,
		operationsPerSecond: scenario.count / durationMs * 1_000,
	};
}

async function measureReplacement(
	controller: BenchmarkController,
	scenario: Extract<BenchmarkScenario, { kind: "replace" }>,
	initial: BenchmarkDataset,
): Promise<ReplacementMetrics> {
	if (!controller.replaceDataset) {
		throw new Error("Selected implementation does not support controlled replacement benchmarks");
	}
	window.__PECULIAR_SHEETS_RECONCILIATION__ = { counts: {}, durations: {} };
	const replacement = createReplacementDataset(scenario, initial);
	const steps = [];
	const measureStep = async (name: string, from: BenchmarkDataset, to: BenchmarkDataset) => {
		const start = performance.now();
		controller.replaceDataset?.(to);
		const synchronousMs = performance.now() - start;
		await nextFrame();
		const firstFrameMs = performance.now() - start;
		await nextFrame();
		const settledMs = performance.now() - start;
		const diagnostics = window.__PECULIAR_SHEETS_RECONCILIATION__;
		if (diagnostics) {
			diagnostics.durations["virtualizer.firstFrame"] =
				(diagnostics.durations["virtualizer.firstFrame"] ?? 0) + firstFrameMs - synchronousMs;
			diagnostics.durations["virtualizer.secondFrame"] =
				(diagnostics.durations["virtualizer.secondFrame"] ?? 0) + settledMs - firstFrameMs;
		}
		if (to.rows > 0) {
			const expected = to.values[0]?.[0] ?? null;
			const actual = controller.readCell(0, 0);
			if (actual !== expected) {
				throw new Error(`Replacement integrity check failed: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
			}
		}
		steps.push({ name, fromRows: from.rows, toRows: to.rows, synchronousMs, settledMs });
	};
	await measureStep("replace", initial, replacement);
	if (scenario.replacement === "filter-roundtrip") {
		await measureStep("restore", replacement, initial);
	}
	const profile = window.__PECULIAR_SHEETS_RECONCILIATION__;
	delete window.__PECULIAR_SHEETS_RECONCILIATION__;
	return profile
		? { mode: scenario.replacement, steps, profile }
		: { mode: scenario.replacement, steps };
}

async function main(): Promise<void> {
	const { implementation, scenario } = parseQuery();
	const root = document.querySelector<HTMLElement>("#benchmark-root");
	if (!root) throw new Error("Benchmark root is missing");
	root.dataset.implementation = implementation;
	root.dataset.scenario = scenario.name;
	const dataset = createDataset(scenario);
	const adapter = await loadAdapter(implementation);
	const mountStart = performance.now();
	const controller = await adapter.mount(root, dataset);
	await nextFrame();
	await nextFrame();
	const mountMs = performance.now() - mountStart;
	const navigationToReadyMs = performance.now() - (window.__BENCH_NAVIGATION_STARTED__ ?? 0);

	window.__BENCHMARK__ = {
		implementation,
		scenario: scenario.name,
		ready: true,
		runScrollCycle() {
			if (scenario.kind !== "scroll") {
				throw new Error(`Scenario ${scenario.name} is not a scroll scenario`);
			}
			return measureScroll(controller, scenario);
		},
		getDiagnosticSnapshot() {
			const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
			return {
				domNodes: document.getElementsByTagName("*").length,
				heapBytesBeforeGc: memory?.usedJSHeapSize ?? null,
				lifecycle: window.__PECULIAR_SHEETS_LIFECYCLE__
					? { ...window.__PECULIAR_SHEETS_LIFECYCLE__ }
					: null,
			};
		},
		async run(): Promise<BenchmarkResult> {
			const snapshot = () => {
				const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
				const heapBytesBeforeGc = memory?.usedJSHeapSize ?? null;
				return {
					implementation,
					scenario: scenario.name,
					rows: scenario.rows,
					columns: scenario.columns,
					navigationToReadyMs,
					mountMs,
					domNodes: document.getElementsByTagName("*").length,
					heapBytesBeforeGc,
					heapBytes: memory?.usedJSHeapSize ?? null,
				};
			};
			switch (scenario.kind) {
				case "mount": return { ...snapshot(), kind: "mount" };
				case "scroll": {
					const scroll = await measureScroll(controller, scenario);
					return { ...snapshot(), kind: "scroll", scroll };
				}
				case "writes": {
					const writes = await measureWrites(controller, scenario);
					return { ...snapshot(), kind: "writes", writes };
				}
				case "replace": {
					const replacement = await measureReplacement(controller, scenario, dataset);
					return { ...snapshot(), kind: "replace", replacement };
				}
			}
		},
	};

	window.addEventListener("pagehide", () => controller.destroy(), { once: true });
}

void main().catch((error: unknown) => {
	window.__BENCH_ERROR__ = error instanceof Error ? `${error.name}: ${error.message}\n${error.stack ?? ""}` : String(error);
	console.error(error);
});
