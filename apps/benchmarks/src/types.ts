export const IMPLEMENTATIONS = ["peculiar-sheets", "ag-grid", "handsontable"] as const;
export const SCENARIO_NAMES = [
	"mount-small",
	"mount-large",
	"vertical-scroll",
	"horizontal-scroll",
	"visible-writes",
	"offscreen-writes",
	"batch-writes",
	"replace-large-disjoint",
	"replace-large-retained",
	"replace-small-disjoint",
	"replace-small-large",
	"replace-filter-roundtrip",
	"replace-few-cells",
] as const;

export type ImplementationName = (typeof IMPLEMENTATIONS)[number];
export type ScenarioName = (typeof SCENARIO_NAMES)[number];
export type BenchmarkCellValue = string | number | boolean | null;

export type BenchmarkScenario =
	| { name: "mount-small" | "mount-large"; kind: "mount"; rows: number; columns: number }
	| { name: "vertical-scroll" | "horizontal-scroll"; kind: "scroll"; rows: number; columns: number; axis: "vertical" | "horizontal"; durationMs: number }
	| { name: "visible-writes" | "offscreen-writes" | "batch-writes"; kind: "writes"; rows: number; columns: number; distribution: "visible" | "offscreen"; mode: "independent" | "batch"; count: number }
	| {
		name:
			| "replace-large-disjoint"
			| "replace-large-retained"
			| "replace-small-disjoint"
			| "replace-small-large"
			| "replace-filter-roundtrip"
			| "replace-few-cells";
		kind: "replace";
		rows: number;
		columns: number;
		replacementRows: number;
		replacement: "disjoint" | "retained" | "filter-roundtrip" | "few-cells";
	};

export interface BenchmarkDataset {
	readonly rows: number;
	readonly columns: number;
	readonly values: BenchmarkCellValue[][];
	readonly rowIds: string[];
}

export interface BenchmarkController {
	getScrollElement(): HTMLElement;
	readCell(row: number, column: number): BenchmarkCellValue;
	scrollToRow(row: number): void;
	writeCell(row: number, column: number, value: BenchmarkCellValue): void;
	writeCells(writes: readonly BenchmarkWrite[]): void;
	replaceDataset?(dataset: BenchmarkDataset): void;
	destroy(): void;
}

export interface BenchmarkWrite {
	row: number;
	column: number;
	value: BenchmarkCellValue;
}

export interface BenchmarkAdapter {
	mount(container: HTMLElement, dataset: BenchmarkDataset): BenchmarkController | Promise<BenchmarkController>;
}

export interface ScrollMetrics {
	axis: "vertical" | "horizontal";
	durationMs: number;
	frames: number;
	medianFrameMs: number;
	p95FrameMs: number;
	maxFrameMs: number;
	longTaskCount: number;
	longTaskTotalMs: number;
}

export interface GridLifecycleCounts {
	rowMounts: number;
	rowCleanups: number;
	rowLive: number;
	rowMaxLive: number;
	cellMounts: number;
	cellCleanups: number;
	cellLive: number;
	cellMaxLive: number;
}

export interface BenchmarkDiagnosticSnapshot {
	domNodes: number;
	heapBytesBeforeGc: number | null;
	lifecycle: GridLifecycleCounts | null;
}

export interface WriteMetrics {
	distribution: "visible" | "offscreen";
	mode: "independent" | "batch";
	count: number;
	/** Synchronous time spent submitting the mutations. */
	durationMs: number;
	/** Submission plus two animation frames for reactive/render work to settle. */
	settledDurationMs: number;
	operationsPerSecond: number;
}

export interface ReplacementStepMetrics {
	name: string;
	fromRows: number;
	toRows: number;
	synchronousMs: number;
	settledMs: number;
}

export interface ReplacementMetrics {
	mode: "disjoint" | "retained" | "filter-roundtrip" | "few-cells";
	steps: ReplacementStepMetrics[];
	profile?: {
		counts: Record<string, number>;
		durations: Record<string, number>;
	};
}

interface BaseBenchmarkResult {
	implementation: ImplementationName;
	scenario: ScenarioName;
	rows: number;
	columns: number;
	navigationToReadyMs: number;
	mountMs: number;
	domNodes: number;
	/** Heap sampled immediately after the workload, before an explicit GC. */
	heapBytesBeforeGc: number | null;
	/** Heap sampled after an explicit GC when Chromium exposes both APIs. */
	heapBytes: number | null;
}

export type BenchmarkResult =
	| (BaseBenchmarkResult & { kind: "mount" })
	| (BaseBenchmarkResult & { kind: "scroll"; scroll: ScrollMetrics })
	| (BaseBenchmarkResult & { kind: "writes"; writes: WriteMetrics })
	| (BaseBenchmarkResult & { kind: "replace"; replacement: ReplacementMetrics });

export interface BenchmarkApi {
	implementation: ImplementationName;
	scenario: ScenarioName;
	ready: boolean;
	run(): Promise<BenchmarkResult>;
	runScrollCycle(): Promise<ScrollMetrics>;
	getDiagnosticSnapshot(): BenchmarkDiagnosticSnapshot;
}

declare global {
	interface Window {
		__BENCHMARK__?: BenchmarkApi;
		__BENCH_ERROR__?: string;
		__BENCH_NAVIGATION_STARTED__?: number;
		__PECULIAR_SHEETS_LIFECYCLE__?: GridLifecycleCounts;
		__PECULIAR_SHEETS_RECONCILIATION__?: {
			counts: Record<string, number>;
			durations: Record<string, number>;
		};
	}
}
