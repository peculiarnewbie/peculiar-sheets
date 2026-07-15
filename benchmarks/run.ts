import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { Stagehand } from "@browserbasehq/stagehand";
import {
	IMPLEMENTATIONS as ALL_IMPLEMENTATIONS,
	SCENARIO_NAMES as ALL_SCENARIOS,
	type BenchmarkResult,
	type GridLifecycleCounts,
	type ImplementationName,
	type ScenarioName,
	type ScrollMetrics,
} from "../apps/benchmarks/src/types";

const PORT = 4178;
const BASE_URL = `http://localhost:${PORT}`;
const WARMUPS = Number(process.env.BENCHMARK_WARMUPS ?? 0);
const ITERATIONS = Number(process.env.BENCHMARK_ITERATIONS ?? 3);
const RETRIES = Number(process.env.BENCHMARK_RETRIES ?? 1);
const UPDATE_BASELINE = process.env.BENCHMARK_UPDATE_BASELINE === "1";
const OUTPUT_DIRECTORY = path.resolve(process.cwd(), ".benchmark");
const BASELINE_PATH = path.join(OUTPUT_DIRECTORY, "baseline.json");
const LATEST_PATH = path.join(OUTPUT_DIRECTORY, "latest.json");
const MEMORY_DIAGNOSTIC = process.env.BENCHMARK_MEMORY_DIAGNOSTIC === "1";
const MEMORY_DIAGNOSTIC_PATH = path.join(OUTPUT_DIRECTORY, "vertical-memory-latest.json");

interface BenchmarkSnapshot {
	generatedAt: string;
	iterations: number;
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
	const values = raw === undefined
		? [...options.defaultValue]
		: raw.trim() === ""
			? []
			: raw.split(",").map((value) => Number(value.trim()));
	if (values.some((value) => !Number.isInteger(value) || value < options.minimum)) {
		throw new Error(`${options.environmentName} must be a comma-separated list of integers >= ${options.minimum}`);
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
	const requested = process.env[options.environmentName]?.split(",").map((value) => value.trim()).filter(Boolean);
	return requested?.map((value) => {
		if (!options.available.includes(value as T)) {
			throw new Error(`Unknown ${options.environmentName} entry: ${value}`);
		}
		return value as T;
	}) ?? [...options.available];
}

const IMPLEMENTATIONS = parseSelection<ImplementationName>({
	environmentName: "BENCHMARK_IMPLEMENTATIONS",
	available: ALL_IMPLEMENTATIONS,
});
const SCENARIOS = parseSelection<ScenarioName>({
	environmentName: "BENCHMARK_SCENARIOS",
	available: ALL_SCENARIOS,
});

interface PageLike {
	goto(url: string): Promise<void>;
	evaluate<T>(fn: () => T | Promise<T>): Promise<T>;
	sendCDP<T = unknown>(method: string, params?: object): Promise<T>;
	waitForTimeout(ms: number): Promise<void>;
	mainFrameId(): string;
	getSessionForFrame(frameId: string): {
		send<T = unknown>(method: string, params?: object): Promise<T>;
		on<T = unknown>(event: string, handler: (params: T) => void): void;
		off<T = unknown>(event: string, handler: (params: T) => void): void;
	};
}

function command(commandName: string, args: string[]): Promise<void> {
	const child = spawn(commandName, args, { cwd: process.cwd(), stdio: "inherit" });
	return new Promise((resolve, reject) => {
		child.on("error", reject);
		child.on("close", (code) => code === 0 ? resolve() : reject(new Error(`${commandName} failed with exit code ${code}`)));
	});
}

async function waitForServer(): Promise<void> {
	const start = Date.now();
	while (Date.now() - start < 30_000) {
		try {
			if ((await fetch(BASE_URL)).ok) return;
		} catch {}
		await Bun.sleep(200);
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
		: sorted[middle] ?? 0;
}

function metric<T>(samples: readonly T[], read: (sample: T) => number): number {
	return median(samples.map(read));
}

function memoryMetric(samples: readonly BenchmarkResult[], key: "heapBytesBeforeGc" | "heapBytes"): string {
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
		console.log(`\n${scenario} (${first.rows.toLocaleString()} x ${first.columns.toLocaleString()})`);
		switch (first.kind) {
			case "mount": {
				console.log("implementation       ready ms  mount ms  DOM nodes  raw MB  retained MB");
				for (const implementation of IMPLEMENTATIONS) {
					const samples = scenarioResults.filter((result) => result.kind === "mount" && result.implementation === implementation);
					console.log([
						implementation.padEnd(20),
						metric(samples, (sample) => sample.navigationToReadyMs).toFixed(1).padStart(8),
						metric(samples, (sample) => sample.mountMs).toFixed(1).padStart(9),
						metric(samples, (sample) => sample.domNodes).toFixed(0).padStart(10),
						memoryMetric(samples, "heapBytesBeforeGc").padStart(7),
						memoryMetric(samples, "heapBytes").padStart(12),
					].join(" "));
				}
				break;
			}
			case "scroll": {
				console.log("implementation       mount ms  frame p50  frame p95  max frame  long tasks  DOM nodes  raw MB  retained MB");
				for (const implementation of IMPLEMENTATIONS) {
					const samples = scenarioResults.filter((result) => result.kind === "scroll" && result.implementation === implementation);
					console.log([
						implementation.padEnd(20),
						metric(samples, (sample) => sample.mountMs).toFixed(1).padStart(9),
						metric(samples, (sample) => sample.scroll.medianFrameMs).toFixed(1).padStart(10),
						metric(samples, (sample) => sample.scroll.p95FrameMs).toFixed(1).padStart(10),
						metric(samples, (sample) => sample.scroll.maxFrameMs).toFixed(1).padStart(10),
						metric(samples, (sample) => sample.scroll.longTaskCount).toFixed(0).padStart(11),
						metric(samples, (sample) => sample.domNodes).toFixed(0).padStart(10),
						memoryMetric(samples, "heapBytesBeforeGc").padStart(7),
						memoryMetric(samples, "heapBytes").padStart(12),
					].join(" "));
				}
				break;
			}
			case "writes": {
				console.log("implementation       mount ms  mutate ms  settle ms   writes/s  DOM nodes  raw MB  retained MB");
				for (const implementation of IMPLEMENTATIONS) {
					const samples = scenarioResults.filter((result) => result.kind === "writes" && result.implementation === implementation);
					console.log([
						implementation.padEnd(20),
						metric(samples, (sample) => sample.mountMs).toFixed(1).padStart(9),
						metric(samples, (sample) => sample.writes.durationMs).toFixed(1).padStart(10),
						metric(samples, (sample) => sample.writes.settledDurationMs).toFixed(1).padStart(10),
						metric(samples, (sample) => sample.writes.operationsPerSecond).toFixed(0).padStart(10),
						metric(samples, (sample) => sample.domNodes).toFixed(0).padStart(10),
						memoryMetric(samples, "heapBytesBeforeGc").padStart(7),
						memoryMetric(samples, "heapBytes").padStart(12),
					].join(" "));
				}
				break;
			}
		}
	}
}

function primaryMetric(result: BenchmarkResult): number {
	switch (result.kind) {
		case "mount": return result.mountMs;
		case "scroll": return result.scroll.p95FrameMs;
		case "writes": return result.writes.settledDurationMs;
	}
}

function printBaselineComparison(results: readonly BenchmarkResult[], baseline: BenchmarkSnapshot): void {
	console.log("\nChange from .benchmark/baseline.json (negative is faster):");
	for (const scenario of SCENARIOS) {
		for (const implementation of IMPLEMENTATIONS) {
			const currentSamples = results.filter((result) => result.scenario === scenario && result.implementation === implementation);
			const baselineSamples = baseline.results.filter((result) => result.scenario === scenario && result.implementation === implementation);
			if (currentSamples.length === 0 || baselineSamples.length === 0) continue;
			const current = median(currentSamples.map(primaryMetric));
			const previous = median(baselineSamples.map(primaryMetric));
			const change = previous === 0 ? 0 : (current - previous) / previous * 100;
			console.log(`${scenario.padEnd(20)} ${implementation.padEnd(20)} ${change >= 0 ? "+" : ""}${change.toFixed(1)}%`);
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
		generatedAt: new Date().toISOString(),
		iterations: ITERATIONS,
		warmups: WARMUPS,
		results: [...results],
	};
	await mkdir(OUTPUT_DIRECTORY, { recursive: true });
	const baseline = await readBaseline();
	await writeFile(LATEST_PATH, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
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
		await session.send("HeapProfiler.takeHeapSnapshot", { reportProgress: false, captureNumericValue: true });
	} finally {
		session.off("HeapProfiler.addHeapSnapshotChunk", handleChunk);
	}
	const filename = [
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
	const browser = new Stagehand({
		env: "LOCAL",
		localBrowserLaunchOptions: { headless: true, args: ["--enable-precise-memory-info"] },
	});
	try {
		await browser.init();
		const page = await browser.context.newPage() as PageLike;
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
		checkpoints.push(await collectMemoryCheckpoint({
			page,
			kind: "cycle",
			completedCycles: 0,
			idleMs: 0,
		}));
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
				checkpoints.push(await collectMemoryCheckpoint({
					page,
					kind: "cycle",
					completedCycles: cycle,
					idleMs: 0,
				}));
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
			checkpoints.push(await collectMemoryCheckpoint({
				page,
				kind: "idle",
				completedCycles: maximumCycles,
				idleMs,
			}));
		}
		return {
			implementation: options.implementation,
			rows: options.rows,
			columns: DIAGNOSTIC_COLUMNS,
			durationMs: DIAGNOSTIC_DURATION_MS,
			viewport,
			browser: browserVersion,
			startedAt,
			cycles,
			checkpoints,
			heapSnapshots,
		};
	} finally {
		await browser.close();
	}
}

function printMemoryDiagnostic(samples: readonly MemoryDiagnosticSample[]): void {
	console.log("\nVertical memory diagnostic (MB after explicit GC):");
	console.log("implementation         rows cycles  raw MB retained MB DOM nodes row live cell live");
	for (const sample of samples) {
		for (const checkpoint of sample.checkpoints) {
			const label = checkpoint.kind === "cycle"
				? String(checkpoint.completedCycles)
				: `${checkpoint.completedCycles}+${checkpoint.idleMs}ms`;
			console.log([
				sample.implementation.padEnd(20),
				String(sample.rows).padStart(8),
				label.padStart(6),
				(checkpoint.heapBytesBeforeGc === null ? "n/a" : (checkpoint.heapBytesBeforeGc / 1e6).toFixed(1)).padStart(7),
				(checkpoint.heapBytes === null ? "n/a" : (checkpoint.heapBytes / 1e6).toFixed(1)).padStart(11),
				String(checkpoint.domNodes).padStart(9),
				String(checkpoint.lifecycle?.rowLive ?? "n/a").padStart(8),
				String(checkpoint.lifecycle?.cellLive ?? "n/a").padStart(9),
			].join(" "));
		}
	}
}

async function runMemoryDiagnostic(): Promise<void> {
	const samples: MemoryDiagnosticSample[] = [];
	for (let iteration = 0; iteration < ITERATIONS; iteration++) {
		for (const rows of DIAGNOSTIC_ROWS) {
			for (const implementation of IMPLEMENTATIONS) {
				console.log(`[${iteration + 1}/${ITERATIONS}] memory diagnostic ${implementation}, ${rows.toLocaleString()} rows…`);
				samples.push(await runMemoryDiagnosticSample({ implementation, rows }));
			}
		}
	}
	const snapshot: MemoryDiagnosticSnapshot = {
		generatedAt: new Date().toISOString(),
		iterations: ITERATIONS,
		cycleCheckpoints: [0, ...DIAGNOSTIC_CYCLES].filter((value, index, all) => all.indexOf(value) === index).sort((a, b) => a - b),
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
	const browser = new Stagehand({
		env: "LOCAL",
		localBrowserLaunchOptions: { headless: true, args: ["--enable-precise-memory-info"] },
	});
	try {
		await browser.init();
		const page = await browser.context.newPage() as PageLike;
		await page.goto(`${BASE_URL}?implementation=${options.implementation}&scenario=${options.scenario}`);
		await waitForReady(page);
		const result = await page.evaluate(async () => {
			if (!window.__BENCHMARK__) throw new Error("Benchmark API is missing");
			return window.__BENCHMARK__.run();
		});
		await page.sendCDP("HeapProfiler.collectGarbage");
		const heapBytes = await page.evaluate(() => {
			const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
			return memory?.usedJSHeapSize ?? null;
		});
		return { ...result, heapBytes };
	} finally {
		await browser.close();
	}
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
		case "mount": return `mount ${result.mountMs.toFixed(1)}ms`;
		case "scroll": return `mount ${result.mountMs.toFixed(1)}ms, ${result.scroll.axis} p95 ${result.scroll.p95FrameMs.toFixed(1)}ms`;
		case "writes": return `mount ${result.mountMs.toFixed(1)}ms, ${result.writes.mode} ${result.writes.distribution} writes ${result.writes.operationsPerSecond.toFixed(0)}/s`;
	}
}

let preview: ChildProcess | null = null;
try {
	if (!Number.isInteger(WARMUPS) || WARMUPS < 0 || !Number.isInteger(ITERATIONS) || ITERATIONS < 1 || !Number.isInteger(RETRIES) || RETRIES < 0) {
		throw new Error("BENCHMARK_WARMUPS and BENCHMARK_RETRIES must be >= 0; BENCHMARK_ITERATIONS must be >= 1");
	}
	if (!Number.isInteger(DIAGNOSTIC_COLUMNS) || DIAGNOSTIC_COLUMNS < 1 || !Number.isInteger(DIAGNOSTIC_DURATION_MS) || DIAGNOSTIC_DURATION_MS < 1) {
		throw new Error("BENCHMARK_DIAGNOSTIC_COLUMNS and BENCHMARK_DIAGNOSTIC_DURATION_MS must be positive integers");
	}
	await command("pnpm", ["build:lib"]);
	await command("pnpm", ["--filter", "@peculiarnewbie/benchmarks", "build"]);
	preview = spawn("node", ["apps/benchmarks/node_modules/vite/bin/vite.js", "preview", "apps/benchmarks", "--port", String(PORT)], {
		cwd: process.cwd(),
		stdio: ["ignore", "ignore", "inherit"],
	});
	await waitForServer();
	if (MEMORY_DIAGNOSTIC) {
		await runMemoryDiagnostic();
	} else {
	const results: BenchmarkResult[] = [];
	for (const scenario of SCENARIOS) {
		for (let iteration = -WARMUPS; iteration < ITERATIONS; iteration++) {
			for (const implementation of IMPLEMENTATIONS) {
				const prefix = iteration < 0 ? "[warmup]" : `[${iteration + 1}/${ITERATIONS}]`;
				console.log(`${prefix} starting ${scenario} / ${implementation}…`);
				const result = await runSampleWithRetry({ implementation, scenario });
				if (iteration >= 0) {
					results.push(result);
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
	process.exitCode = 1;
} finally {
	preview?.kill("SIGTERM");
}
