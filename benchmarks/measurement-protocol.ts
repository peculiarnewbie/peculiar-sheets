import { LEGACY_COMPETITOR_CONFIG, MEASUREMENT_PROTOCOL } from "../apps/benchmarks/src/types";
import type { ReportSnapshot } from "./report";

/** Snapshots without a marker loaded the full AG Grid and Handsontable bundles. */
export function competitorConfigLabel(snapshot: Pick<ReportSnapshot, "competitorConfig">): string {
	return snapshot.competitorConfig ?? LEGACY_COMPETITOR_CONFIG;
}

export function usesApiCompletion(protocol: string | undefined): boolean {
	return protocol === "api-completion-v2" || protocol === MEASUREMENT_PROTOCOL;
}

/** Reject accidentally mixed journals before producing any rankings. */
export function validateReplacementTiming(
	snapshot: Pick<ReportSnapshot, "measurementProtocol" | "results">,
) {
	const aligned = snapshot.measurementProtocol === MEASUREMENT_PROTOCOL;
	for (const sample of snapshot.results) {
		if (sample.kind !== "replace") continue;
		if (aligned !== (sample.replacement.timingProtocol === "frame-aligned-v1"))
			throw new Error(
				"Replacement timing protocol mismatch; do not mix aligned and historical samples",
			);
		if (
			aligned &&
			sample.replacement.steps.some(
				(step) =>
					step.firstFrameMs === undefined ||
					!Number.isFinite(step.firstFrameMs) ||
					step.firstFrameMs < step.synchronousMs ||
					step.secondFrameMs === undefined ||
					!Number.isFinite(step.secondFrameMs) ||
					step.secondFrameMs < 0 ||
					Math.abs(step.firstFrameMs + step.secondFrameMs - step.settledMs) > 0.001,
			)
		)
			throw new Error("Frame-aligned replacement requires complete frame diagnostics");
	}
}
