import type { BenchmarkScenario, BenchmarkSkip, ImplementationName, ScenarioName } from "./types";

export const SCENARIOS: Record<ScenarioName, BenchmarkScenario> = {
	"mount-small": { name: "mount-small", kind: "mount", rows: 1_000, columns: 20 },
	"mount-large": { name: "mount-large", kind: "mount", rows: 10_000, columns: 20 },
	"vertical-scroll": {
		name: "vertical-scroll",
		kind: "scroll",
		rows: 10_000,
		columns: 20,
		axis: "vertical",
		durationMs: 2_000,
	},
	"horizontal-scroll": {
		name: "horizontal-scroll",
		kind: "scroll",
		rows: 1_000,
		columns: 200,
		axis: "horizontal",
		durationMs: 2_000,
	},
	"visible-writes": {
		name: "visible-writes",
		kind: "writes",
		rows: 10_000,
		columns: 20,
		distribution: "visible",
		mode: "independent",
		count: 250,
	},
	"offscreen-writes": {
		name: "offscreen-writes",
		kind: "writes",
		rows: 10_000,
		columns: 20,
		distribution: "offscreen",
		mode: "independent",
		count: 250,
	},
	"batch-writes": {
		name: "batch-writes",
		kind: "writes",
		rows: 10_000,
		columns: 20,
		distribution: "offscreen",
		mode: "batch",
		count: 250,
	},
	"replace-large-disjoint": {
		name: "replace-large-disjoint",
		kind: "replace",
		rows: 10_000,
		columns: 1,
		replacementRows: 10,
		replacement: "disjoint",
	},
	"replace-large-retained": {
		name: "replace-large-retained",
		kind: "replace",
		rows: 10_000,
		columns: 1,
		replacementRows: 10,
		replacement: "retained",
	},
	"replace-small-disjoint": {
		name: "replace-small-disjoint",
		kind: "replace",
		rows: 10,
		columns: 1,
		replacementRows: 10,
		replacement: "disjoint",
	},
	"replace-small-large": {
		name: "replace-small-large",
		kind: "replace",
		rows: 10,
		columns: 1,
		replacementRows: 10_000,
		replacement: "disjoint",
	},
	"replace-filter-roundtrip": {
		name: "replace-filter-roundtrip",
		kind: "replace",
		rows: 10_000,
		columns: 1,
		replacementRows: 10,
		replacement: "filter-roundtrip",
	},
	"replace-few-cells": {
		name: "replace-few-cells",
		kind: "replace",
		rows: 10_000,
		columns: 1,
		replacementRows: 10_000,
		replacement: "few-cells",
	},
	"edit-commit": { name: "edit-commit", kind: "interaction", rows: 10_000, columns: 20 },
	"keyboard-navigation": {
		name: "keyboard-navigation",
		kind: "interaction",
		rows: 10_000,
		columns: 20,
	},
	"paste-small": { name: "paste-small", kind: "interaction", rows: 10_000, columns: 20 },
	"paste-large": { name: "paste-large", kind: "interaction", rows: 10_000, columns: 20 },
	"clear-undo-redo": { name: "clear-undo-redo", kind: "interaction", rows: 10_000, columns: 20 },
	"scroll-wheel-slow": {
		name: "scroll-wheel-slow",
		kind: "interaction",
		rows: 10_000,
		columns: 20,
	},
	"scroll-wheel-bursts": {
		name: "scroll-wheel-bursts",
		kind: "interaction",
		rows: 10_000,
		columns: 20,
	},
	"scroll-diagonal": { name: "scroll-diagonal", kind: "interaction", rows: 1_000, columns: 200 },
	"scroll-jump": { name: "scroll-jump", kind: "interaction", rows: 10_000, columns: 20 },
	"replace-wide-retained": {
		name: "replace-wide-retained",
		kind: "replace",
		rows: 10_000,
		columns: 20,
		replacementRows: 10,
		replacement: "retained",
	},
	"replace-wide-grow": {
		name: "replace-wide-grow",
		kind: "replace",
		rows: 10,
		columns: 200,
		replacementRows: 1_000,
		replacement: "disjoint",
	},
	"row-reorder": {
		name: "row-reorder",
		kind: "replace",
		rows: 10_000,
		columns: 20,
		replacementRows: 10_000,
		replacement: "reorder",
	},
	"row-insert-delete": {
		name: "row-insert-delete",
		kind: "replace",
		rows: 10_000,
		columns: 20,
		replacementRows: 10_100,
		replacement: "insert-delete",
	},
	"streaming-updates": {
		name: "streaming-updates",
		kind: "interaction",
		rows: 10_000,
		columns: 20,
	},
	"mount-tall": { name: "mount-tall", kind: "mount", rows: 100_000, columns: 20 },
	"mount-wide": { name: "mount-wide", kind: "mount", rows: 1_000, columns: 200 },
	"mount-mixed": {
		name: "mount-mixed",
		kind: "mount",
		rows: 10_000,
		columns: 20,
		dataShape: "mixed",
	},
	"mount-sparse": {
		name: "mount-sparse",
		kind: "mount",
		rows: 100_000,
		columns: 20,
		dataShape: "sparse",
	},
};

export function scenarioSkip(
	implementation: ImplementationName,
	scenario: ScenarioName,
): BenchmarkSkip | undefined {
	if (SCENARIOS[scenario].kind !== "interaction") return;
	if (implementation === "gridsheet" || implementation === "univer") {
		return {
			implementation,
			scenario,
			category: "adapter",
			reason:
				"Browser interaction adapter not implemented; mount, scroll, writes, and replacement remain available.",
		};
	}
	if (
		implementation === "ag-grid" &&
		["paste-small", "paste-large", "clear-undo-redo"].includes(scenario)
	) {
		return {
			implementation,
			scenario,
			category: "unsupported",
			reason:
				"Rectangular clipboard and range selection require AG Grid Enterprise; this suite uses Community.",
		};
	}
	if (implementation === "revogrid" && scenario === "clear-undo-redo") {
		return {
			implementation,
			scenario,
			category: "unsupported",
			reason: "Undo/redo history requires RevoGrid Pro; this suite uses Community.",
		};
	}
}
