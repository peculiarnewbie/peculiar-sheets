import { type ChildProcess, spawn } from "node:child_process";
import { buildCommandOptions } from "./command";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { parseArgs } from "node:util";
import { browserProfileCleanupSummary, withBrowserProfile } from "./browser-profile";
import { Stagehand } from "@browserbasehq/stagehand";
import { Result, TaggedError } from "better-result";
import { SCENARIOS as SCENARIO_CONFIG, scenarioSkip } from "../apps/benchmarks/src/scenarios";
import {
	IMPLEMENTATIONS as ALL_IMPLEMENTATIONS,
	SCENARIO_NAMES as ALL_SCENARIOS,
	type BenchmarkResult,
	type BenchmarkSkip,
	type GridLifecycleCounts,
	type ImplementationName,
	MEASUREMENT_PROTOCOL,
	type ScenarioName,
	type ScrollMetrics,
} from "../apps/benchmarks/src/types";
import type { PageLike } from "./browser-types";
import { runBrowserWorkload } from "./browser-workloads";
import { timerMetadata } from "./timer-metadata";
import { appendSampleCheckpoint } from "./checkpoint";
import { writeBenchmarkReport } from "./report";
import {
	defaultScenarioIterations,
	describeSampling,
	iterationsForScenario,
	type SamplingMetadata,
	sameSamplingCounts,
	sampleOrder,
	validateSampling,
} from "./sampling";

const PORT = 4178;
const BASE_URL = `http://localhost:${PORT}`;
const WARMUPS = Number(process.env.BENCHMARK_WARMUPS ?? 0);
const ITERATIONS = Number(process.env.BENCHMARK_ITERATIONS ?? 12);
const RETRIES = Number(process.env.BENCHMARK_RETRIES ?? 0);
const OVERRIDE_ROWS = process.env.BENCHMARK_ROWS;
const OVERRIDE_COLUMNS = process.env.BENCHMARK_COLUMNS;
const UPDATE_BASELINE = process.env.BENCHMARK_UPDATE_BASELINE === "1";
const OUTPUT_DIRECTORY = path.resolve(
	process.cwd(),
	process.env.BENCHMARK_OUTPUT_DIR ?? ".benchmark",
);
const RUN_STARTED_AT = new Date();
const SAMPLE_JOURNAL_PATH = path.join(
	OUTPUT_DIRECTORY,
	`samples-${RUN_STARTED_AT.toISOString().replaceAll(":", "-")}.ndjson`,
);
const BASELINE_PATH = path.join(OUTPUT_DIRECTORY, "baseline.json");
const LATEST_PATH = path.join(OUTPUT_DIRECTORY, "latest.json");
const MEMORY_DIAGNOSTIC = process.env.BENCHMARK_MEMORY_DIAGNOSTIC === "1";
const CHROME_PATH = process.env.BENCHMARK_CHROME_PATH;
const BROWSER_ARGS = [
	"--enable-precise-memory-info",
	...(process.env.BENCHMARK_NO_SANDBOX === "1" ? ["--no-sandbox"] : []),
];
const MEMORY_DIAGNOSTIC_PATH = path.join(OUTPUT_DIRECTORY, "vertical-memory-latest.json");

interface BenchmarkSnapshot extends SamplingMetadata {
	timerProtocol?: string;
	measurementProtocol?: string;
	cpuAffinity?: string;
	startedAt?: string;
	elapsedMs?: number;
	skipped?: BenchmarkSkip[];
	generatedAt: string;
	warmups: number;
	results: BenchmarkResult[];
}

interface MemoryCheckpoint {
	kind: "cycle" | "idle";
	completedCycles: number;
	idleMs: number;
	capturedAt: string;
	heapBytesBeforeGc: number | null;
	heapBytes: number | null;
	domNodes: number;
	lifecycle: GridLifecycleCounts | null;
}

interface MemoryDiagnosticSample {
	timingEnvironment: ReturnType<typeof timerMetadata>;
	implementation: ImplementationName;
	rows: number;
	columns: number;
	durationMs: number;
	viewport: { width: number; height: number };
	browser: { product: string; revision: string; userAgent: string; jsVersion: string };
	startedAt: string;
	cycles: Array<ScrollMetrics & { cycle: number }>;
	checkpoints: MemoryCheckpoint[];
	heapSnapshots: Array<{ completedCycles: number; path: string }>;
}

interface MemoryDiagnosticSnapshot {
	generatedAt: string;
	iterations: number;
	cycleCheckpoints: number[];
	idleCheckpointsMs: number[];
	samples: MemoryDiagnosticSample[];
}

function parseIntegerList(options: {
	environmentName: string;
	defaultValue: readonly number[];
	minimum: number;
}): number[] {
	const raw = process.env[options.environmentName];
	const values =
		raw === undefined
			? [...options.defaultValue]
			: raw.trim() === ""
				? []
				: raw.split(",").map((value) => Number(value.trim()));
	if (values.some((value) => !Number.isInteger(value) || value < options.minimum)) {
		throw new Error(
			`${options.environmentName} must be a comma-separated list of integers >= ${options.minimum}`,
		);
	}
	return [...new Set(values)].sort((left, right) => left - right);
}

const DIAGNOSTIC_CYCLES = parseIntegerList({
	environmentName: "BENCHMARK_DIAGNOSTIC_CYCLES",
	defaultValue: [0, 1, 2, 5, 10, 20],
	minimum: 0,
});
const DIAGNOSTIC_ROWS = parseIntegerList({
	environmentName: "BENCHMARK_DIAGNOSTIC_ROWS",
	defaultValue: [10_000],
	minimum: 1,
});
const DIAGNOSTIC_IDLE_MS = parseIntegerList({
	environmentName: "BENCHMARK_DIAGNOSTIC_IDLE_MS",
	defaultValue: [],
	minimum: 0,
});
const DIAGNOSTIC_HEAP_SNAPSHOT_CYCLES = parseIntegerList({
	environmentName: "BENCHMARK_HEAP_SNAPSHOT_CYCLES",
	defaultValue: [],
	minimum: 0,
});
const DIAGNOSTIC_COLUMNS = Number(process.env.BENCHMARK_DIAGNOSTIC_COLUMNS ?? 20);
const DIAGNOSTIC_DURATION_MS = Number(process.env.BENCHMARK_DIAGNOSTIC_DURATION_MS ?? 2_000);

function parseSelection<T extends string>(options: {
	environmentName: string;
	available: readonly T[];
}): T[] {
	const requested = process.env[options.environmentName]
		?.split(",")
		.map((value) => value.trim())
		.filter(Boolean);
	return (
		requested?.map((value) => {
			if (!options.available.includes(value as T)) {
				throw new Error(`Unknown ${options.environmentName} entry: ${value}`);
			}
			return value as T;
		}) ?? [...options.available]
	);
}

const configuredImplementations = parseSelection<ImplementationName>({
	environmentName: "BENCHMARK_IMPLEMENTATIONS",
	available: ALL_IMPLEMENTATIONS,
});
const SCENARIOS = parseSelection<ScenarioName>({
	environmentName: "BENCHMARK_SCENARIOS",
	available: ALL_SCENARIOS,
});
const scenarioIterations = defaultScenarioIterations(
	SCENARIOS,
	process.env.BENCHMARK_ITERATIONS !== undefined,
);
const SAMPLING: SamplingMetadata = {
	iterations: ITERATIONS,
	...(Object.keys(scenarioIterations).length ? { scenarioIterations } : {}),
};
validateSampling(SAMPLING);

const { values: options } = parseArgs({
	options: {
		include: { type: "string" },
		"include-handsontable-writes": { type: "boolean", default: false },
		list: { type: "boolean", default: false },
	},
});
const OPTIONAL_IMPLEMENTATIONS: readonly ImplementationName[] = ["gridsheet", "univer"];
const includedImplementations = options.include?.split(",").map((name) => name.trim()) ?? [];
for (const name of includedImplementations) {
	if (!ALL_IMPLEMENTATIONS.includes(name as ImplementationName)) {
		throw new Error(`Unknown --include entry: ${name}`);
	}
}
const IMPLEMENTATIONS = [
	...new Set([
		...configuredImplementations.filter(
			(name) =>
				process.env.BENCHMARK_IMPLEMENTATIONS !== undefined ||
				!OPTIONAL_IMPLEMENTATIONS.includes(name),
		),
		...(includedImplementations as ImplementationName[]),
	]),
];

function skipForScenario(
	implementation: ImplementationName,
	scenario: ScenarioName,
): BenchmarkSkip | undefined {
	if (
		implementation === "handsontable" &&
		SCENARIO_CONFIG[scenario].kind === "writes" &&
		!options["include-handsontable-writes"]
	) {
		return {
			implementation,
			scenario,
			category: "disabled",
			reason: "Enable with --include-handsontable-writes",
		};
	}
	return scenarioSkip(implementation, scenario);
}

function implementationsForScenario(scenario: ScenarioName): ImplementationName[] {
	return IMPLEMENTATIONS.filter((implementation) => !skipForScenario(implementation, scenario));
}
const SKIPPED = SCENARIOS.flatMap((scenario) =>
	IMPLEMENTATIONS.flatMap((implementation) => {
		const skip = skipForScenario(implementation, scenario);
		return skip ? [skip] : [];
	}),
);

if (options.list) {
	console.log(
		JSON.stringify(
			SCENARIOS.flatMap((scenario) =>
				implementationsForScenario(scenario).map((implementation) => ({
					scenario,
					implementation,
					iterations: iterationsForScenario(SAMPLING, scenario),
				})),
			),
			null,
			2,
		),
	);
	process.exit(0);
}

function command(commandName: string, args: string[]): Promise<void> {
	const child = spawn(commandName, args, {
		cwd: process.cwd(),
		stdio: "inherit",
		...buildCommandOptions(),
	});
	return new Promise((resolve, reject) => {
		child.on("error", reject);
		child.on("close", (code) =>
			code === 0 ? resolve() : reject(new Error(`${commandName} failed with exit code ${code}`)),
		);
	});
}

async function waitForServer(): Promise<void> {
	const start = Date.now();
	while (Date.now() - start < 30_000) {
		try {
			if ((await fetch(BASE_URL)).ok) return;
		} catch {}
		await delay(200);
	}
	throw new Error(`Benchmark preview did not start at ${BASE_URL}`);
}

async function waitForReady(page: PageLike): Promise<void> {
	const start = Date.now();
	while (Date.now() - start < 30_000) {
		const state = await page.evaluate(() => ({
			ready: window.__BENCHMARK__?.ready === true,
			error: window.__BENCH_ERROR__,
		}));
		if (state.error) throw new Error(state.error);
		if (state.ready) return;
		await page.waitForTimeout(50);
	}
	throw new Error("Benchmark page did not become ready");
}

function median(values: readonly number[]): number {
	const sorted = [...values].sort((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 0
		? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
		: (sorted[middle] ?? 0);
}

function metric<T>(samples: readonly T[], read: (sample: T) => number): number {
	return median(samples.map(read));
}

function memoryMetric(
	samples: readonly BenchmarkResult[],
	key: "heapBytesBeforeGc" | "heapBytes",
): string {
	return samples.every((sample) => sample[key] === null)
		? "n/a"
		: (metric(samples, (sample) => sample[key] ?? 0) / 1e6).toFixed(1);
}

function printSummary(results: readonly BenchmarkResult[]): void {
	console.log("\nMedian of measured iterations (lower is better except writes/s):");
	for (const scenario of SCENARIOS) {
		const scenarioResults = results.filter((result) => result.scenario === scenario);
		const first = scenarioResults[0];
		if (!first) continue;
		console.log(
			`\n${scenario} (${first.rows.toLocaleString()} x ${first.columns.toLocaleString()})`,
		);
		switch (first.kind) {
			case "interaction": {
				console.log("implementation       response p95  frame p95  verified cells  total ms");
				for (const implementation of implementationsForScenario(scenario)) {
					const samples = scenarioResults.filter(
						(result): result is Extract<BenchmarkResult, { kind: "interaction" }> =>
							result.kind === "interaction" && result.implementation === implementation,
					);
					console.log(
						`${implementation.padEnd(20)} ${metric(
							samples,
							(sample) => sample.interaction.responseP95Ms,
						)
							.toFixed(1)
							.padStart(12)} ${metric(samples, (sample) => sample.interaction.frameP95Ms)
							.toFixed(1)
							.padStart(10)} ${metric(samples, (sample) => sample.interaction.verifiedCells)
							.toFixed(0)
							.padStart(15)} ${metric(samples, (sample) => sample.interaction.durationMs)
							.toFixed(1)
							.padStart(9)}`,
					);
				}
				break;
			}
			case "mount": {
				console.log("implementation       ready ms  mount ms  DOM nodes  raw MB  retained MB");
				for (const implementation of implementationsForScenario(scenario)) {
					const samples = scenarioResults.filter(
						(result): result is Extract<BenchmarkResult, { kind: "mount" }> =>
							result.kind === "mount" && result.implementation === implementation,
					);
					console.log(
						[
							implementation.padEnd(20),
							metric(samples, (sample) => sample.navigationToReadyMs)
								.toFixed(1)
								.padStart(8),
							metric(samples, (sample) => sample.mountMs)
								.toFixed(1)
								.padStart(9),
							metric(samples, (sample) => sample.domNodes)
								.toFixed(0)
								.padStart(10),
							memoryMetric(samples, "heapBytesBeforeGc").padStart(7),
							memoryMetric(samples, "heapBytes").padStart(12),
						].join(" "),
					);
				}
				break;
			}
			case "scroll": {
				console.log(
					"implementation       mount ms  frame p50  frame p95  max frame  long tasks  DOM nodes  raw MB  retained MB",
				);
				for (const implementation of implementationsForScenario(scenario)) {
					const samples = scenarioResults.filter(
						(result): result is Extract<BenchmarkResult, { kind: "scroll" }> =>
							result.kind === "scroll" && result.implementation === implementation,
					);
					console.log(
						[
							implementation.padEnd(20),
							metric(samples, (sample) => sample.mountMs)
								.toFixed(1)
								.padStart(9),
							metric(samples, (sample) => sample.scroll.medianFrameMs)
								.toFixed(1)
								.padStart(10),
							metric(samples, (sample) => sample.scroll.p95FrameMs)
								.toFixed(1)
								.padStart(10),
							metric(samples, (sample) => sample.scroll.maxFrameMs)
								.toFixed(1)
								.padStart(10),
							metric(samples, (sample) => sample.scroll.longTaskCount)
								.toFixed(0)
								.padStart(11),
							metric(samples, (sample) => sample.domNodes)
								.toFixed(0)
								.padStart(10),
							memoryMetric(samples, "heapBytesBeforeGc").padStart(7),
							memoryMetric(samples, "heapBytes").padStart(12),
						].join(" "),
					);
				}
				break;
			}
			case "writes": {
				console.log(
					"implementation       mount ms  mutate ms  settle ms   writes/s  DOM nodes  raw MB  retained MB",
				);
				for (const implementation of implementationsForScenario(scenario)) {
					const samples = scenarioResults.filter(
						(result): result is Extract<BenchmarkResult, { kind: "writes" }> =>
							result.kind === "writes" && result.implementation === implementation,
					);
					console.log(
						[
							implementation.padEnd(20),
							metric(samples, (sample) => sample.mountMs)
								.toFixed(1)
								.padStart(9),
							metric(samples, (sample) => sample.writes.durationMs)
								.toFixed(1)
								.padStart(10),
							metric(samples, (sample) => sample.writes.settledDurationMs)
								.toFixed(1)
								.padStart(10),
							metric(samples, (sample) => sample.writes.operationsPerSecond)
								.toFixed(0)
								.padStart(10),
							metric(samples, (sample) => sample.domNodes)
								.toFixed(0)
								.padStart(10),
							memoryMetric(samples, "heapBytesBeforeGc").padStart(7),
							memoryMetric(samples, "heapBytes").padStart(12),
						].join(" "),
					);
				}
				break;
			}
			case "replace": {
				console.log(
					"implementation       mount ms  sync ms  settled ms  steps  DOM nodes  raw MB  retained MB",
				);
				for (const implementation of implementationsForScenario(scenario)) {
					const samples = scenarioResults.filter(
						(result): result is Extract<BenchmarkResult, { kind: "replace" }> =>
							result.kind === "replace" && result.implementation === implementation,
					);
					const firstStep = samples[0]?.replacement.steps[0];
					if (!firstStep) continue;
					console.log(
						[
							implementation.padEnd(20),
							metric(samples, (sample) => sample.mountMs)
								.toFixed(1)
								.padStart(9),
							metric(samples, (sample) => sample.replacement.steps[0]?.synchronousMs ?? 0)
								.toFixed(1)
								.padStart(8),
							metric(samples, (sample) => sample.replacement.steps[0]?.settledMs ?? 0)
								.toFixed(1)
								.padStart(11),
							String(firstStep.name).padStart(6),
							metric(samples, (sample) => sample.domNodes)
								.toFixed(0)
								.padStart(10),
							memoryMetric(samples, "heapBytesBeforeGc").padStart(7),
							memoryMetric(samples, "heapBytes").padStart(12),
						].join(" "),
					);
					if (firstStep && samples[0]?.replacement.steps.length === 2) {
						console.log(
							`  restore: sync ${metric(samples, (sample) => sample.replacement.steps[1]?.synchronousMs ?? 0).toFixed(1)}ms, settled ${metric(samples, (sample) => sample.replacement.steps[1]?.settledMs ?? 0).toFixed(1)}ms`,
						);
					}
				}
				break;
			}
		}
	}
}

function primaryMetric(result: BenchmarkResult): number {
	switch (result.kind) {
		case "interaction":
			return result.scenario === "streaming-updates" || result.scenario.startsWith("scroll-")
				? result.interaction.frameP95Ms
				: result.interaction.verifiedResponseSamples > 0
					? result.interaction.verifiedResponseP95Ms
					: result.interaction.responseP95Ms;
		case "mount":
			return result.navigationToReadyMs;
		case "scroll":
			return result.scroll.p95FrameMs;
		case "writes":
			return result.writes.completionDurationMs ?? result.writes.settledDurationMs;
		case "replace":
			return result.replacement.steps.reduce((sum, step) => sum + step.settledMs, 0);
	}
}

function printBaselineComparison(
	results: readonly BenchmarkResult[],
	baseline: BenchmarkSnapshot,
): void {
	if (
		baseline.measurementProtocol !== MEASUREMENT_PROTOCOL ||
		baseline.timerProtocol !== "cross-origin-isolated-v1" ||
		baseline.cpuAffinity !== (process.env.BENCHMARK_EFFECTIVE_CPUSET ?? "uncontrolled") ||
		!sameSamplingCounts(baseline, SAMPLING, SCENARIOS)
	) {
		console.log(
			"Measurement protocol, CPU placement, or sample counts changed; historical timings are not a speed comparison. Establish a fresh baseline.",
		);
		return;
	}
	console.log(`\nChange from ${path.relative(process.cwd(), BASELINE_PATH)} (negative is faster):`);
	for (const scenario of SCENARIOS) {
		for (const implementation of implementationsForScenario(scenario)) {
			const currentSamples = results.filter(
				(result) => result.scenario === scenario && result.implementation === implementation,
			);
			const baselineSamples = baseline.results.filter(
				(result) => result.scenario === scenario && result.implementation === implementation,
			);
			if (currentSamples.length === 0 || baselineSamples.length === 0) continue;
			const current = median(currentSamples.map(primaryMetric));
			const previous = median(baselineSamples.map(primaryMetric));
			const change = previous === 0 ? 0 : ((current - previous) / previous) * 100;
			console.log(
				`${scenario.padEnd(20)} ${implementation.padEnd(20)} ${change >= 0 ? "+" : ""}${change.toFixed(1)}%`,
			);
		}
	}
}

async function readBaseline(): Promise<BenchmarkSnapshot | null> {
	try {
		return JSON.parse(await readFile(BASELINE_PATH, "utf8")) as BenchmarkSnapshot;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw error;
	}
}

async function saveResults(results: readonly BenchmarkResult[]): Promise<void> {
	const snapshot: BenchmarkSnapshot = {
		startedAt: RUN_STARTED_AT.toISOString(),
		elapsedMs: Date.now() - RUN_STARTED_AT.getTime(),
		skipped: SKIPPED,
		measurementProtocol: MEASUREMENT_PROTOCOL,
		timerProtocol: "cross-origin-isolated-v1",
		cpuAffinity: process.env.BENCHMARK_EFFECTIVE_CPUSET ?? "uncontrolled",
		generatedAt: new Date().toISOString(),
		...SAMPLING,
		warmups: WARMUPS,
		results: [...results],
	};
	await mkdir(OUTPUT_DIRECTORY, { recursive: true });
	const baseline = await readBaseline();
	const serialized = `${JSON.stringify(snapshot, null, 2)}\n`;
	await writeFile(LATEST_PATH, serialized, "utf8");
	await writeFile(
		path.join(OUTPUT_DIRECTORY, `results-${snapshot.generatedAt.replaceAll(":", "-")}.json`),
		serialized,
		"utf8",
	);
	const report = await writeBenchmarkReport(snapshot, OUTPUT_DIRECTORY);
	if (report.isErr()) throw report.error;
	if (!baseline || UPDATE_BASELINE) {
		await writeFile(BASELINE_PATH, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
		console.log(`\nSaved ${baseline ? "updated" : "initial"} baseline to ${BASELINE_PATH}`);
		return;
	}
	printBaselineComparison(results, baseline);
	console.log(`\nSaved latest results to ${LATEST_PATH}`);
}

async function collectMemoryCheckpoint(options: {
	page: PageLike;
	kind: MemoryCheckpoint["kind"];
	completedCycles: number;
	idleMs: number;
}): Promise<MemoryCheckpoint> {
	if (options.idleMs > 0) await options.page.waitForTimeout(options.idleMs);
	const before = await options.page.evaluate(() => {
		if (!window.__BENCHMARK__) throw new Error("Benchmark API is missing");
		return window.__BENCHMARK__.getDiagnosticSnapshot();
	});
	await options.page.sendCDP("HeapProfiler.collectGarbage");
	const after = await options.page.evaluate(() => {
		if (!window.__BENCHMARK__) throw new Error("Benchmark API is missing");
		return window.__BENCHMARK__.getDiagnosticSnapshot();
	});
	return {
		kind: options.kind,
		completedCycles: options.completedCycles,
		idleMs: options.idleMs,
		capturedAt: new Date().toISOString(),
		heapBytesBeforeGc: before.heapBytesBeforeGc,
		heapBytes: after.heapBytesBeforeGc,
		domNodes: after.domNodes,
		lifecycle: after.lifecycle,
	};
}

async function captureHeapSnapshot(options: {
	page: PageLike;
	implementation: ImplementationName;
	rows: number;
	completedCycles: number;
}): Promise<string> {
	const session = options.page.getSessionForFrame(options.page.mainFrameId());
	const chunks: string[] = [];
	const handleChunk = ({ chunk }: { chunk: string }) => chunks.push(chunk);
	session.on("HeapProfiler.addHeapSnapshotChunk", handleChunk);
	try {
		await session.send("HeapProfiler.enable");
		await session.send("HeapProfiler.collectGarbage");
		await session.send("HeapProfiler.takeHeapSnapshot", {
			reportProgress: false,
			captureNumericValue: true,
		});
	} finally {
		session.off("HeapProfiler.addHeapSnapshotChunk", handleChunk);
	}
	const filename =
		[
			"heap",
			options.implementation,
			`${options.rows}x${DIAGNOSTIC_COLUMNS}`,
			`cycle-${options.completedCycles}`,
			new Date().toISOString().replaceAll(":", "-"),
		].join("-") + ".heapsnapshot";
	const snapshotPath = path.join(OUTPUT_DIRECTORY, filename);
	await writeFile(snapshotPath, chunks.join(""), "utf8");
	return path.relative(process.cwd(), snapshotPath);
}

async function runMemoryDiagnosticSample(options: {
	implementation: ImplementationName;
	rows: number;
}): Promise<MemoryDiagnosticSample> {
	const measured = await withBrowserProfile({
		create: (userDataDir) =>
			new Stagehand({
				env: "LOCAL",
				localBrowserLaunchOptions: {
					userDataDir,
					headless: true,
					args: BROWSER_ARGS,
					...(CHROME_PATH ? { executablePath: CHROME_PATH } : {}),
				},
			}),
		run: async (browser) => {
			await browser.init();
			const page = (await browser.context.newPage()) as PageLike;
			const query = new URLSearchParams({
				implementation: options.implementation,
				scenario: "vertical-scroll",
				lifecycle: "1",
				rows: String(options.rows),
				columns: String(DIAGNOSTIC_COLUMNS),
				durationMs: String(DIAGNOSTIC_DURATION_MS),
			});
			await page.goto(`${BASE_URL}?${query}`);
			await waitForReady(page);
			const timingEnvironment = await page.evaluate(timerMetadata);
			if (!timingEnvironment.crossOriginIsolated)
				throw new Error(
					"Benchmark preview must be cross-origin isolated for high-resolution timing",
				);
			const browserVersion = await page.sendCDP<{
				product: string;
				revision: string;
				userAgent: string;
				jsVersion: string;
			}>("Browser.getVersion");
			const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
			const startedAt = new Date().toISOString();
			const checkpoints: MemoryCheckpoint[] = [];
			const cycles: Array<ScrollMetrics & { cycle: number }> = [];
			const heapSnapshots: Array<{ completedCycles: number; path: string }> = [];
			const requestedCheckpoints = new Set([0, ...DIAGNOSTIC_CYCLES]);
			checkpoints.push(
				await collectMemoryCheckpoint({
					page,
					kind: "cycle",
					completedCycles: 0,
					idleMs: 0,
				}),
			);
			if (DIAGNOSTIC_HEAP_SNAPSHOT_CYCLES.includes(0)) {
				heapSnapshots.push({
					completedCycles: 0,
					path: await captureHeapSnapshot({
						page,
						implementation: options.implementation,
						rows: options.rows,
						completedCycles: 0,
					}),
				});
			}
			const maximumCycles = Math.max(...requestedCheckpoints, ...DIAGNOSTIC_HEAP_SNAPSHOT_CYCLES);
			for (let cycle = 1; cycle <= maximumCycles; cycle++) {
				const metrics = await page.evaluate(async () => {
					if (!window.__BENCHMARK__) throw new Error("Benchmark API is missing");
					return window.__BENCHMARK__.runScrollCycle();
				});
				cycles.push({ cycle, ...metrics });
				if (requestedCheckpoints.has(cycle)) {
					checkpoints.push(
						await collectMemoryCheckpoint({
							page,
							kind: "cycle",
							completedCycles: cycle,
							idleMs: 0,
						}),
					);
				}
				if (DIAGNOSTIC_HEAP_SNAPSHOT_CYCLES.includes(cycle)) {
					heapSnapshots.push({
						completedCycles: cycle,
						path: await captureHeapSnapshot({
							page,
							implementation: options.implementation,
							rows: options.rows,
							completedCycles: cycle,
						}),
					});
				}
			}
			for (const idleMs of DIAGNOSTIC_IDLE_MS) {
				checkpoints.push(
					await collectMemoryCheckpoint({
						page,
						kind: "idle",
						completedCycles: maximumCycles,
						idleMs,
					}),
				);
			}
			return {
				implementation: options.implementation,
				rows: options.rows,
				columns: DIAGNOSTIC_COLUMNS,
				durationMs: DIAGNOSTIC_DURATION_MS,
				viewport,
				browser: browserVersion,
				timingEnvironment,
				startedAt,
				cycles,
				checkpoints,
				heapSnapshots,
			};
		},
	});
	if (measured.isErr()) throw measured.error;
	return measured.value;
}

function printMemoryDiagnostic(samples: readonly MemoryDiagnosticSample[]): void {
	console.log("\nVertical memory diagnostic (MB after explicit GC):");
	console.log(
		"implementation         rows cycles  raw MB retained MB DOM nodes row live cell live",
	);
	for (const sample of samples) {
		for (const checkpoint of sample.checkpoints) {
			const label =
				checkpoint.kind === "cycle"
					? String(checkpoint.completedCycles)
					: `${checkpoint.completedCycles}+${checkpoint.idleMs}ms`;
			console.log(
				[
					sample.implementation.padEnd(20),
					String(sample.rows).padStart(8),
					label.padStart(6),
					(checkpoint.heapBytesBeforeGc === null
						? "n/a"
						: (checkpoint.heapBytesBeforeGc / 1e6).toFixed(1)
					).padStart(7),
					(checkpoint.heapBytes === null
						? "n/a"
						: (checkpoint.heapBytes / 1e6).toFixed(1)
					).padStart(11),
					String(checkpoint.domNodes).padStart(9),
					String(checkpoint.lifecycle?.rowLive ?? "n/a").padStart(8),
					String(checkpoint.lifecycle?.cellLive ?? "n/a").padStart(9),
				].join(" "),
			);
		}
	}
}

async function runMemoryDiagnostic(): Promise<void> {
	const samples: MemoryDiagnosticSample[] = [];
	for (let iteration = 0; iteration < ITERATIONS; iteration++) {
		for (const rows of DIAGNOSTIC_ROWS) {
			for (const implementation of IMPLEMENTATIONS) {
				console.log(
					`[${iteration + 1}/${ITERATIONS}] memory diagnostic ${implementation}, ${rows.toLocaleString()} rows…`,
				);
				samples.push(await runMemoryDiagnosticSample({ implementation, rows }));
			}
		}
	}
	const snapshot: MemoryDiagnosticSnapshot = {
		generatedAt: new Date().toISOString(),
		iterations: ITERATIONS,
		cycleCheckpoints: [0, ...DIAGNOSTIC_CYCLES]
			.filter((value, index, all) => all.indexOf(value) === index)
			.sort((a, b) => a - b),
		idleCheckpointsMs: DIAGNOSTIC_IDLE_MS,
		samples,
	};
	await mkdir(OUTPUT_DIRECTORY, { recursive: true });
	const serialized = `${JSON.stringify(snapshot, null, 2)}\n`;
	const timestampedPath = path.join(
		OUTPUT_DIRECTORY,
		`vertical-memory-${snapshot.generatedAt.replaceAll(":", "-")}.json`,
	);
	await writeFile(timestampedPath, serialized, "utf8");
	await writeFile(MEMORY_DIAGNOSTIC_PATH, serialized, "utf8");
	printMemoryDiagnostic(samples);
	console.log(`\nSaved diagnostic samples to ${timestampedPath}`);
	console.log(`Updated latest diagnostic at ${MEMORY_DIAGNOSTIC_PATH}`);
}

async function runSample(options: {
	implementation: ImplementationName;
	scenario: ScenarioName;
}): Promise<BenchmarkResult> {
	const measured = await withBrowserProfile({
		create: (userDataDir) =>
			new Stagehand({
				env: "LOCAL",
				localBrowserLaunchOptions: {
					userDataDir,
					headless: true,
					args: BROWSER_ARGS,
					...(CHROME_PATH ? { executablePath: CHROME_PATH } : {}),
				},
			}),
		run: async (browser) => {
			await browser.init();
			const page = (await browser.context.newPage()) as PageLike;
			const query = new URLSearchParams({
				implementation: options.implementation,
				scenario: options.scenario,
				...(OVERRIDE_ROWS ? { rows: OVERRIDE_ROWS } : {}),
				...(OVERRIDE_COLUMNS ? { columns: OVERRIDE_COLUMNS } : {}),
			});
			await page.goto(`${BASE_URL}?${query}`);
			await waitForReady(page);
			const timingEnvironment = await page.evaluate(timerMetadata);
			if (!timingEnvironment.crossOriginIsolated)
				throw new Error(
					"Benchmark preview must be cross-origin isolated for high-resolution timing",
				);
			if (SCENARIO_CONFIG[options.scenario].kind === "interaction") {
				const interaction = await runBrowserWorkload(page, options.scenario);
				if (interaction.isErr()) throw interaction.error;
			}
			const result = await page.evaluate(async () => {
				if (!window.__BENCHMARK__) throw new Error("Benchmark API is missing");
				return window.__BENCHMARK__.run();
			});
			await page.sendCDP("HeapProfiler.collectGarbage");
			const heapBytes = await page.evaluate(() => {
				const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } })
					.memory;
				return memory?.usedJSHeapSize ?? null;
			});
			return { ...result, heapBytes, timingEnvironment };
		},
	});
	if (measured.isErr()) throw measured.error;
	return measured.value;
}

async function runSampleWithRetry(options: {
	implementation: ImplementationName;
	scenario: ScenarioName;
}): Promise<BenchmarkResult> {
	let lastError: unknown;
	for (let attempt = 0; attempt <= RETRIES; attempt++) {
		try {
			return await runSample(options);
		} catch (error) {
			lastError = error;
			if (attempt < RETRIES) {
				console.warn(`Retrying ${options.scenario} / ${options.implementation} after:`, error);
			}
		}
	}
	throw lastError;
}

function formatResult(result: BenchmarkResult): string {
	switch (result.kind) {
		case "interaction":
			return `response p95 ${result.interaction.responseP95Ms.toFixed(1)}ms, frame p95 ${result.interaction.frameP95Ms.toFixed(1)}ms, ${result.interaction.verifiedCells} cells verified`;
		case "mount":
			return `mount ${result.mountMs.toFixed(1)}ms`;
		case "scroll":
			return `mount ${result.mountMs.toFixed(1)}ms, ${result.scroll.axis} p95 ${result.scroll.p95FrameMs.toFixed(1)}ms`;
		case "writes":
			return `mount ${result.mountMs.toFixed(1)}ms, ${result.writes.mode} ${result.writes.distribution} writes ${result.writes.operationsPerSecond.toFixed(0)}/s`;
		case "replace":
			return `mount ${result.mountMs.toFixed(1)}ms, replace sync ${result.replacement.steps[0]?.synchronousMs.toFixed(1) ?? "n/a"}ms, settled ${result.replacement.steps[0]?.settledMs.toFixed(1) ?? "n/a"}ms`;
	}
}

class BenchmarkCheckpointError extends TaggedError("BenchmarkCheckpointError")<{
	message: string;
	cause: unknown;
}> {}

const measuredResults: BenchmarkResult[] = [];
let preview: ChildProcess | null = null;
try {
	if (
		!Number.isInteger(WARMUPS) ||
		WARMUPS < 0 ||
		!Number.isInteger(ITERATIONS) ||
		ITERATIONS < 1 ||
		!Number.isInteger(RETRIES) ||
		RETRIES < 0
	) {
		throw new Error(
			"BENCHMARK_WARMUPS and BENCHMARK_RETRIES must be >= 0; BENCHMARK_ITERATIONS must be >= 1",
		);
	}
	if (
		!Number.isInteger(DIAGNOSTIC_COLUMNS) ||
		DIAGNOSTIC_COLUMNS < 1 ||
		!Number.isInteger(DIAGNOSTIC_DURATION_MS) ||
		DIAGNOSTIC_DURATION_MS < 1
	) {
		throw new Error(
			"BENCHMARK_DIAGNOSTIC_COLUMNS and BENCHMARK_DIAGNOSTIC_DURATION_MS must be positive integers",
		);
	}
	await command("pnpm", ["build:lib"]);
	await command("pnpm", ["--filter", "@peculiarnewbie/benchmarks", "build"]);
	preview = spawn(
		"node",
		[
			"apps/benchmarks/node_modules/vite/bin/vite.js",
			"preview",
			"apps/benchmarks",
			"--port",
			String(PORT),
		],
		{
			cwd: process.cwd(),
			stdio: ["ignore", "ignore", "inherit"],
		},
	);
	await waitForServer();
	if (MEMORY_DIAGNOSTIC) {
		await runMemoryDiagnostic();
	} else {
		const results = measuredResults;
		console.log(`Benchmark sampling: ${describeSampling(SAMPLING, SCENARIOS)} per library.`);
		for (const scenario of SCENARIOS) {
			const iterations = iterationsForScenario(SAMPLING, scenario);
			for (const skipped of SKIPPED.filter((skip) => skip.scenario === scenario))
				console.log(
					`[skip] ${scenario} / ${skipped.implementation} (${skipped.category}: ${skipped.reason})`,
				);
			for (let iteration = -WARMUPS; iteration < iterations; iteration++) {
				for (const implementation of sampleOrder(implementationsForScenario(scenario), iteration)) {
					const prefix = iteration < 0 ? "[warmup]" : `[${iteration + 1}/${iterations}]`;
					console.log(`${prefix} starting ${scenario} / ${implementation}…`);
					const result = await runSampleWithRetry({ implementation, scenario });
					if (iteration >= 0) {
						results.push(result);
						const checkpoint = await appendSampleCheckpoint(SAMPLE_JOURNAL_PATH, {
							measurementProtocol: MEASUREMENT_PROTOCOL,
							timerProtocol: "cross-origin-isolated-v1",
							cpuAffinity: process.env.BENCHMARK_EFFECTIVE_CPUSET ?? "uncontrolled",
							startedAt: RUN_STARTED_AT.toISOString(),
							iteration,
							iterations,
							result,
						});
						if (Result.isError(checkpoint)) throw checkpoint.error;
						console.log(`${prefix} ${scenario} / ${implementation}: ${formatResult(result)}`);
					}
				}
			}
		}
		printSummary(results);
		await saveResults(results);
	}
} catch (error) {
	console.error("Benchmark failed:", error);
	if (measuredResults.length) {
		const checkpoint = await Result.tryPromise({
			try: async () => {
				await mkdir(OUTPUT_DIRECTORY, { recursive: true });
				const checkpointPath = path.join(
					OUTPUT_DIRECTORY,
					`partial-${new Date().toISOString().replaceAll(":", "-")}.json`,
				);
				await writeFile(
					checkpointPath,
					JSON.stringify(
						{
							generatedAt: new Date().toISOString(),
							startedAt: RUN_STARTED_AT.toISOString(),
							elapsedMs: Date.now() - RUN_STARTED_AT.getTime(),
							measurementProtocol: MEASUREMENT_PROTOCOL,
							timerProtocol: "cross-origin-isolated-v1",
							cpuAffinity: process.env.BENCHMARK_EFFECTIVE_CPUSET ?? "uncontrolled",
							...SAMPLING,
							warmups: WARMUPS,
							skipped: SKIPPED,
							incomplete: true,
							failure: error instanceof Error ? error.message : String(error),
							results: measuredResults,
						},
						null,
						2,
					) + "\n",
				);
				return checkpointPath;
			},
			catch: (cause) =>
				new BenchmarkCheckpointError({
					message: "Could not save partial benchmark results",
					cause,
				}),
		});
		checkpoint
			.tap((file) => console.log(`Saved ${measuredResults.length} completed samples to ${file}`))
			.tapError((failure) =>
				console.error("benchmark.checkpoint.failed", { cause: failure.cause }),
			);
	}
	process.exitCode = 1;
} finally {
	preview?.kill("SIGTERM");
	const profiles = browserProfileCleanupSummary();
	if (profiles.leakedDirectories.length) {
		console.error("benchmark.browser.profiles.leaked", profiles);
		process.exitCode = 1;
	} else {
		console.log("Browser profile cleanup:", JSON.stringify(profiles));
	}
}
