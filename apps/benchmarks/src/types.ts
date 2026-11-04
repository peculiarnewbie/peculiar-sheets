export const IMPLEMENTATIONS = [
	"peculiar-sheets",
	"ag-grid",
	"handsontable",
	"gridsheet",
	"revogrid",
	"univer",
] as const;
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
	"edit-commit",
	"keyboard-navigation",
	"paste-small",
	"paste-large",
	"clear-undo-redo",
	"scroll-wheel-slow",
	"scroll-wheel-bursts",
	"scroll-diagonal",
	"scroll-jump",
	"replace-wide-retained",
	"replace-wide-grow",
	"row-reorder",
	"row-insert-delete",
	"streaming-updates",
	"mount-tall",
	"mount-wide",
	"mount-mixed",
	"mount-sparse",
] as const;

export type ImplementationName = (typeof IMPLEMENTATIONS)[number];
export type ScenarioName = (typeof SCENARIO_NAMES)[number];
export type BenchmarkCellValue = string | number | boolean | null;

export type BenchmarkScenario =
	| {
			name:
				| "mount-small"
				| "mount-large"
				| "mount-tall"
				| "mount-wide"
				| "mount-mixed"
				| "mount-sparse";
			kind: "mount";
			rows: number;
			columns: number;
			dataShape?: "mixed" | "sparse";
	  }
	| {
			name: "vertical-scroll" | "horizontal-scroll";
			kind: "scroll";
			rows: number;
			columns: number;
			axis: "vertical" | "horizontal";
			durationMs: number;
	  }
	| {
			name: "visible-writes" | "offscreen-writes" | "batch-writes";
			kind: "writes";
			rows: number;
			columns: number;
			distribution: "visible" | "offscreen";
			mode: "independent" | "batch";
			count: number;
	  }
	| {
			name:
				| "replace-large-disjoint"
				| "replace-large-retained"
				| "replace-small-disjoint"
				| "replace-small-large"
				| "replace-filter-roundtrip"
				| "replace-few-cells"
				| "replace-wide-retained"
				| "replace-wide-grow"
				| "row-reorder"
				| "row-insert-delete";
			kind: "replace";
			rows: number;
			columns: number;
			replacementRows: number;
			replacement:
				| "disjoint"
				| "retained"
				| "filter-roundtrip"
				| "few-cells"
				| "reorder"
				| "insert-delete";
	  }
	| {
			name:
				| "edit-commit"
				| "keyboard-navigation"
				| "paste-small"
				| "paste-large"
				| "clear-undo-redo"
				| "scroll-wheel-slow"
				| "scroll-wheel-bursts"
				| "scroll-diagonal"
				| "scroll-jump"
				| "streaming-updates";
			kind: "interaction";
			rows: number;
			columns: number;
	  };

export interface BenchmarkDataset {
	readonly rows: number;
	readonly columns: number;
	readonly values: BenchmarkCellValue[][];
	readonly rowIds: string[];
}

export interface BenchmarkController {
	getScrollElement(): HTMLElement;
	/** Canvas grids and grids with separate axis viewports can provide their own scrolling. */
	scrollToProgress?(axis: "vertical" | "horizontal", progress: number): void | Promise<void>;
	getScrollPosition?(): { top: number; left: number };
	readCell(row: number, column: number): BenchmarkCellValue;
	scrollToRow(row: number): void | Promise<void>;
	writeCell(row: number, column: number, value: BenchmarkCellValue): void | Promise<void>;
	writeCells(writes: readonly BenchmarkWrite[]): void | Promise<void>;
	replaceDataset?(dataset: BenchmarkDataset): void;
	ui?: {
		getCellElement(row: number, column: number): HTMLElement | null;
		getActiveCell():
			| { row: number; column: number }
			| null
			| Promise<{ row: number; column: number } | null>;
		selectRange?(rows: number, columns: number): void | Promise<void>;
		focusCell?(row: number, column: number): void | Promise<void>;
		getVisibleCell?(): { row: number; column: number } | null;
	};
	destroy(): void;
}

export interface BenchmarkWrite {
	row: number;
	column: number;
	value: BenchmarkCellValue;
}

export interface BenchmarkAdapter {
	mount(
		container: HTMLElement,
		dataset: BenchmarkDataset,
	): BenchmarkController | Promise<BenchmarkController>;
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
	scrollPosition: { top: number; left: number };
	domNodes: number;
	heapBytesBeforeGc: number | null;
	lifecycle: GridLifecycleCounts | null;
}

export const MEASUREMENT_PROTOCOL = "api-completion-v2";

export interface WriteMetrics {
	distribution: "visible" | "offscreen";
	mode: "independent" | "batch";
	count: number;
	/** Synchronous time spent submitting the mutations. */
	durationMs: number;
	/** API calls and every returned promise; absent only in historical snapshots. */
	completionDurationMs?: number;
	/** Completion, integrity checking, and two animation frames (diagnostic only). */
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
	mode: Extract<BenchmarkScenario, { kind: "replace" }>["replacement"];
	steps: ReplacementStepMetrics[];
	state?: {
		rowId: string;
		before: { row: number; column: number } | null;
		after: { row: number; column: number } | null;
		expectedRow: number;
		selectionFollowsRow: boolean;
		scrollBefore: { top: number; left: number };
		scrollAfter: { top: number; left: number };
	};
	profile?: {
		counts: Record<string, number>;
		durations: Record<string, number>;
	};
}

export interface InteractionMetrics {
	/** Includes the browser driver and scripted pacing; diagnostic, not a throughput score. */
	durationMs: number;
	actions: number;
	verifiedCells: number;
	/** Trusted input event to two animation frames, sampled inside the browser. */
	responseP50Ms: number;
	responseP95Ms: number;
	responseMaxMs: number;
	responseSamples: number;
	/** Input to a verified data/focus outcome; includes the driver's verification roundtrip. */
	verifiedResponseP95Ms: number;
	verifiedResponseSamples: number;
	frameP95Ms: number;
	maxFrameMs: number;
	longTaskCount: number;
	longTaskTotalMs: number;
	scrollDistanceX: number;
	scrollDistanceY: number;
	streamBatches: number;
	streamWrites: number;
	streamBatchP95Ms: number;
}

export interface BenchmarkSkip {
	implementation: ImplementationName;
	scenario: ScenarioName;
	category: "disabled" | "unsupported" | "adapter";
	reason: string;
}

export interface BenchmarkPoint {
	x: number;
	y: number;
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
	| (BaseBenchmarkResult & { kind: "replace"; replacement: ReplacementMetrics })
	| (BaseBenchmarkResult & { kind: "interaction"; interaction: InteractionMetrics });

export interface BenchmarkApi {
	implementation: ImplementationName;
	scenario: ScenarioName;
	ready: boolean;
	run(): Promise<BenchmarkResult>;
	runScrollCycle(): Promise<ScrollMetrics>;
	getDiagnosticSnapshot(): BenchmarkDiagnosticSnapshot;
	scrollToProgress(axis: "vertical" | "horizontal", progress: number): void | Promise<void>;
	getCellPoint(row: number, column: number): BenchmarkPoint | null;
	getViewportPoint(): BenchmarkPoint;
	getVisibleCell(): { row: number; column: number } | null;
	getActiveCell(): Promise<{ row: number; column: number } | null>;
	selectRange(rows: number, columns: number): void | Promise<void>;
	verifyCells(writes: readonly BenchmarkWrite[]): void;
	verifyActiveCell(row: number, column: number): Promise<void>;
	verifyVisibleCell(row: number, column: number): void;
	startInteraction(): void;
	startStream(): Promise<void>;
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
