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
	ReplacementStepMetrics,
} from "./types";
import { IMPLEMENTATIONS, SCENARIO_NAMES } from "./types";
import { Result, TaggedError } from "better-result";
import { SCENARIOS } from "./scenarios";
import { createDataset, createReplacementDataset } from "./datasets";
import { createInteractionProbe } from "./interaction-probe";
import "./styles.css";

function parseQuery(): { implementation: ImplementationName; scenario: BenchmarkScenario } {
	const query = new URLSearchParams(location.search);
	const requestedImplementation = query.get("implementation");
	const requestedScenario = query.get("scenario");
	if (!IMPLEMENTATIONS.some((name) => name === requestedImplementation)) {
		throw new Error(
			`Unknown implementation ${JSON.stringify(requestedImplementation)}. Expected ${IMPLEMENTATIONS.join(", ")}`,
		);
	}
	if (!SCENARIO_NAMES.some((name) => name === requestedScenario)) {
		throw new Error(
			`Unknown scenario ${JSON.stringify(requestedScenario)}. Expected ${SCENARIO_NAMES.join(", ")}`,
		);
	}
	const baseScenario = SCENARIOS[requestedScenario as keyof typeof SCENARIOS];
	const rows = parsePositiveInteger(query.get("rows"), "rows") ?? baseScenario.rows;
	const columns = parsePositiveInteger(query.get("columns"), "columns") ?? baseScenario.columns;
	const durationMs = parsePositiveInteger(query.get("durationMs"), "durationMs");
	const scenario =
		baseScenario.kind === "scroll" && durationMs !== undefined
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
		case "peculiar-sheets":
			return (await import("./adapters/peculiar-sheets")).adapter;
		case "ag-grid":
			return (await import("./adapters/ag-grid")).adapter;
		case "handsontable":
			return (await import("./adapters/handsontable")).adapter;
		case "gridsheet":
			return (await import("./adapters/gridsheet")).adapter;
		case "revogrid":
			return (await import("./adapters/revogrid")).adapter;
		case "univer":
			return (await import("./adapters/univer")).adapter;
	}
}

class BenchmarkInitializationError extends TaggedError("BenchmarkInitializationError")<{
	implementation: ImplementationName;
	phase: "load" | "mount";
	message: string;
	cause: unknown;
}> {}

function initializeGrid(
	implementation: ImplementationName,
	root: HTMLElement,
	dataset: BenchmarkDataset,
) {
	return Result.gen(async function* () {
		const adapter = yield* Result.await(
			Result.tryPromise({
				try: () => loadAdapter(implementation),
				catch: (cause) =>
					new BenchmarkInitializationError({
						implementation,
						phase: "load",
						message: `Could not load ${implementation}`,
						cause,
					}),
			}),
		);
		const mountStart = performance.now();
		const controller = yield* Result.await(
			Result.tryPromise({
				try: async () => {
					const controller = await adapter.mount(root, dataset);
					if (controller.ui) {
						const deadline = performance.now() + 3_000;
						while (true) {
							const cell = controller.ui.getCellElement(0, 0);
							const rect = cell?.getBoundingClientRect();
							if (
								rect?.width &&
								rect.height &&
								cell?.textContent?.trim() === String(dataset.values[0]?.[0] ?? "")
							)
								break;
							if (performance.now() >= deadline)
								throw new Error("The first data cell did not render before the readiness deadline");
							await nextFrame();
						}
					}
					return controller;
				},
				catch: (cause) =>
					new BenchmarkInitializationError({
						implementation,
						phase: "mount",
						message: `Could not mount ${implementation}`,
						cause,
					}),
			}),
		);
		return Result.ok({ controller, mountStart });
	});
}

function nextFrame(): Promise<void> {
	return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function countDomElements(root: Document | ShadowRoot = document): number {
	let count = 0;
	for (const element of root.querySelectorAll("*")) {
		count++;
		if (element.shadowRoot) count += countDomElements(element.shadowRoot);
	}
	return count;
}

function scrollToProgress(
	controller: BenchmarkController,
	axis: "vertical" | "horizontal",
	progress: number,
): void | Promise<void> {
	if (controller.scrollToProgress) {
		return controller.scrollToProgress(axis, progress);
	}
	const viewport = controller.getScrollElement();
	if (axis === "vertical")
		viewport.scrollTop = progress * Math.max(0, viewport.scrollHeight - viewport.clientHeight);
	else viewport.scrollLeft = progress * Math.max(0, viewport.scrollWidth - viewport.clientWidth);
}

function percentile(sorted: readonly number[], ratio: number): number {
	if (sorted.length === 0) return 0;
	return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))] ?? 0;
}

async function measureScroll(
	controller: BenchmarkController,
	scenario: Extract<BenchmarkScenario, { kind: "scroll" }>,
): Promise<ScrollMetrics> {
	await controller.scrollToRow(0);
	await scrollToProgress(controller, "horizontal", 0);
	await nextFrame();
	const frameTimes: number[] = [];
	const longTasks: number[] = [];
	const observer =
		typeof PerformanceObserver !== "undefined"
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
	try {
		await new Promise<void>((resolve, reject) => {
			function step(now: number) {
				frameTimes.push(now - previous);
				previous = now;
				const progress = Math.min(1, (now - start) / scenario.durationMs);
				const triangle = progress <= 0.5 ? progress * 2 : (1 - progress) * 2;
				const schedule = () => {
					if (progress < 1) requestAnimationFrame(step);
					else resolve();
				};
				try {
					const completion = scrollToProgress(controller, scenario.axis, triangle);
					if (completion) completion.then(schedule, reject);
					else schedule();
				} catch (error) {
					reject(error);
				}
			}
			requestAnimationFrame(step);
		});
	} finally {
		observer?.disconnect();
	}
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

function writeTarget(
	index: number,
	scenario: Extract<BenchmarkScenario, { kind: "writes" }>,
): { row: number; column: number } {
	if (scenario.distribution === "visible") {
		return { row: index % 20, column: Math.floor(index / 20) % scenario.columns };
	}
	return { row: (index * 97) % scenario.rows, column: index % scenario.columns };
}

async function measureWrites(
	controller: BenchmarkController,
	scenario: Extract<BenchmarkScenario, { kind: "writes" }>,
): Promise<WriteMetrics> {
	await controller.scrollToRow(0);
	await nextFrame();
	const writes = Array.from({ length: scenario.count }, (_, index) => {
		const target = writeTarget(index, scenario);
		return { ...target, value: `value-${index}` };
	});
	const start = performance.now();
	const pending: Promise<void>[] = [];
	if (scenario.mode === "batch") {
		const completion = controller.writeCells(writes);
		if (completion) pending.push(completion);
	} else {
		for (const write of writes) {
			const completion = controller.writeCell(write.row, write.column, write.value);
			if (completion) pending.push(completion);
		}
	}
	const durationMs = performance.now() - start;
	if (pending.length > 0) await Promise.all(pending);
	await nextFrame();
	await nextFrame();
	const settledDurationMs = performance.now() - start;
	const expectedCells = new Map<string, (typeof writes)[number]>();
	for (const write of writes) expectedCells.set(`${write.row}:${write.column}`, write);
	for (const write of expectedCells.values()) {
		const actual = controller.readCell(write.row, write.column);
		if (actual !== write.value) {
			throw new Error(
				`Write workload failed its data-integrity check at ${write.row},${write.column}: expected ${JSON.stringify(write.value)}, received ${JSON.stringify(actual)}`,
			);
		}
	}
	return {
		distribution: scenario.distribution,
		mode: scenario.mode,
		count: scenario.count,
		durationMs,
		settledDurationMs,
		operationsPerSecond: (scenario.count / durationMs) * 1_000,
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
	const stateScenario =
		scenario.replacement === "reorder" || scenario.replacement === "insert-delete";
	const stateRow = Math.min(initial.rows - 1, Math.floor(initial.rows / 2) + 5);
	const stateRowId = initial.rowIds[stateRow];
	const scrollPosition = () =>
		controller.getScrollPosition?.() ?? {
			top: controller.getScrollElement().scrollTop,
			left: controller.getScrollElement().scrollLeft,
		};
	if (stateScenario && controller.ui?.focusCell) {
		await controller.ui.focusCell(stateRow, 0);
		await controller.writeCell(stateRow, 0, "preserved-edit");
		const sourceRow = initial.values[stateRow];
		if (!sourceRow) throw new Error("Structural scenario source row missing");
		sourceRow[0] = "preserved-edit";
		await nextFrame();
		await nextFrame();
	}
	const focusBefore = (await controller.ui?.getActiveCell()) ?? null;
	const scrollBefore = scrollPosition();
	const replacement = createReplacementDataset(scenario, initial);
	const steps: ReplacementStepMetrics[] = [];
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
		for (let row = 0; row < to.rows; row++) {
			for (let column = 0; column < to.columns; column++) {
				if (controller.readCell(row, column) !== (to.values[row]?.[column] ?? null)) {
					throw new Error(`Replacement integrity check failed at ${row},${column}`);
				}
			}
		}

		steps.push({ name, fromRows: from.rows, toRows: to.rows, synchronousMs, settledMs });
	};
	await measureStep("replace", initial, replacement);
	if (scenario.replacement === "filter-roundtrip" || scenario.replacement === "insert-delete") {
		await measureStep(
			scenario.replacement === "insert-delete" ? "delete-inserted" : "restore",
			replacement,
			initial,
		);
	}
	const profile = window.__PECULIAR_SHEETS_RECONCILIATION__;
	delete window.__PECULIAR_SHEETS_RECONCILIATION__;
	const metrics: ReplacementMetrics = {
		mode: scenario.replacement,
		steps,
		...(profile ? { profile } : {}),
	};
	if (stateScenario && stateRowId && controller.ui?.focusCell) {
		const after = await controller.ui.getActiveCell();
		const finalDataset = scenario.replacement === "insert-delete" ? initial : replacement;
		const expectedRow = finalDataset.rowIds.indexOf(stateRowId);
		metrics.state = {
			rowId: stateRowId,
			before: focusBefore,
			after,
			expectedRow,
			selectionFollowsRow: after?.row === expectedRow && after.column === 0,
			scrollBefore,
			scrollAfter: scrollPosition(),
		};
	}
	return metrics;
}

async function main(): Promise<void> {
	const { implementation, scenario } = parseQuery();
	const root = document.querySelector<HTMLElement>("#benchmark-root");
	if (!root) throw new Error("Benchmark root is missing");
	root.dataset.implementation = implementation;
	root.dataset.scenario = scenario.name;
	const dataset = createDataset(scenario);
	const initialized = await initializeGrid(implementation, root, dataset);
	initialized.tapError((error) =>
		console.debug("benchmark.initialization.failed", {
			implementation,
			phase: error.phase,
			cause: error.cause,
		}),
	);
	if (initialized.isErr()) {
		const error = initialized.error;
		window.__BENCH_ERROR__ = `${error.message}: ${error.cause instanceof Error ? (error.cause.stack ?? error.cause.message) : String(error.cause)}`;
		return;
	}
	const { controller, mountStart } = initialized.value;
	await nextFrame();
	await nextFrame();
	const mountMs = performance.now() - mountStart;
	const navigationToReadyMs = performance.now() - (window.__BENCH_NAVIGATION_STARTED__ ?? 0);
	for (const [row, column] of [
		[0, 0],
		[scenario.rows - 1, scenario.columns - 1],
	]) {
		if (controller.readCell(row, column) !== dataset.values[row]?.[column]) {
			throw new Error(`Mount integrity check failed at ${row},${column}`);
		}
	}

	const probe = createInteractionProbe(controller, dataset);
	window.__BENCHMARK__ = {
		implementation,
		scenario: scenario.name,
		ready: true,
		getCellPoint(row, column) {
			const cell = controller.ui?.getCellElement(row, column);
			if (!cell) return null;
			const rect = cell.getBoundingClientRect();
			if (
				!rect.width ||
				!rect.height ||
				rect.bottom <= 0 ||
				rect.top >= innerHeight ||
				rect.right <= 0 ||
				rect.left >= innerWidth
			)
				return null;
			return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
		},
		getVisibleCell() {
			const position = controller.getScrollPosition?.() ?? {
				top: controller.getScrollElement().scrollTop,
				left: controller.getScrollElement().scrollLeft,
			};
			return (
				controller.ui?.getVisibleCell?.() ?? {
					row: Math.min(dataset.rows - 1, Math.ceil(position.top / 28) + 2),
					column: Math.min(dataset.columns - 1, Math.ceil(position.left / 100) + 1),
				}
			);
		},
		getViewportPoint() {
			const rect = root.getBoundingClientRect();
			return {
				x: rect.x + Math.min(250, rect.width / 2),
				y: rect.y + Math.min(250, rect.height / 2),
			};
		},
		async getActiveCell() {
			return (await controller.ui?.getActiveCell()) ?? null;
		},
		selectRange(rows, columns) {
			if (!controller.ui?.selectRange)
				throw new Error("Range selection is unavailable in this adapter");
			return controller.ui.selectRange(rows, columns);
		},
		verifyCells: probe.verifyCells,
		async verifyActiveCell(row, column) {
			const deadline = performance.now() + 3_000;
			let active = await controller.ui?.getActiveCell();
			while (active?.row !== row || active?.column !== column) {
				if (performance.now() >= deadline) {
					const message = `Expected focus ${row},${column}, received ${JSON.stringify(active)}`;
					window.__BENCH_ERROR__ = message;
					throw new Error(message);
				}
				await nextFrame();
				active = await controller.ui?.getActiveCell();
			}
			await nextFrame();
			await nextFrame();
			probe.recordCompletion();
		},
		verifyVisibleCell(row, column) {
			const cell = controller.ui?.getCellElement(row, column);
			const rect = cell?.getBoundingClientRect();
			const expected = controller.readCell(row, column);
			if (
				!cell ||
				!rect ||
				rect.bottom <= 0 ||
				rect.top >= innerHeight ||
				rect.right <= 0 ||
				rect.left >= innerWidth ||
				cell.textContent?.trim() !== String(expected ?? "")
			) {
				const message = `Visible cell check failed at ${row},${column}: ${cell?.textContent}, rect ${JSON.stringify(rect)}, expected ${JSON.stringify(expected)}`;
				window.__BENCH_ERROR__ = message;
				throw new Error(message);
			}
		},
		startInteraction: probe.start,
		async startStream() {
			probe.startStream();
		},
		scrollToProgress(axis, progress) {
			return scrollToProgress(controller, axis, progress);
		},
		runScrollCycle() {
			if (scenario.kind !== "scroll") {
				throw new Error(`Scenario ${scenario.name} is not a scroll scenario`);
			}
			return measureScroll(controller, scenario);
		},
		getDiagnosticSnapshot() {
			const viewport = controller.getScrollElement();
			const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
			return {
				scrollPosition: controller.getScrollPosition?.() ?? {
					top: viewport.scrollTop,
					left: viewport.scrollLeft,
				},
				domNodes: countDomElements(),
				heapBytesBeforeGc: memory?.usedJSHeapSize ?? null,
				lifecycle: window.__PECULIAR_SHEETS_LIFECYCLE__
					? { ...window.__PECULIAR_SHEETS_LIFECYCLE__ }
					: null,
			};
		},
		async run(): Promise<BenchmarkResult> {
			const snapshot = () => {
				const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } })
					.memory;
				const heapBytesBeforeGc = memory?.usedJSHeapSize ?? null;
				return {
					implementation,
					scenario: scenario.name,
					rows: scenario.rows,
					columns: scenario.columns,
					navigationToReadyMs,
					mountMs,
					domNodes: countDomElements(),
					heapBytesBeforeGc,
					heapBytes: memory?.usedJSHeapSize ?? null,
				};
			};
			switch (scenario.kind) {
				case "interaction": {
					const interaction = await probe.finish();
					return { ...snapshot(), kind: "interaction", interaction };
				}
				case "mount":
					return { ...snapshot(), kind: "mount" };
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
	window.__BENCH_ERROR__ =
		error instanceof Error
			? `${error.name}: ${error.message}\n${error.stack ?? ""}`
			: String(error);
	console.error(error);
});
