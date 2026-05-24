import type { CellRange, VisualCellAddress } from "../types";
import type { WorkbookSheetRuntime } from "./registry";
import type { WorkbookCoordinatorError } from "../internal/errors";
import type { ResultLike } from "../internal/result";
import { Result } from "../internal/result";

// ── Types ───────────────────────────────────────────────────────────────────

export interface ReferenceSessionState {
	sourceSheetKey: string;
	targetSheetKey: string;
	anchor: VisualCellAddress;
	didDrag: boolean;
}

type RegistryAccess = {
	tryGetSheetRuntime(sheetKey: string): ResultLike<WorkbookSheetRuntime, WorkbookCoordinatorError>;
	iterSheetRuntimes(): IterableIterator<WorkbookSheetRuntime>;
};

export interface ReferenceSession {
	currentSession: ReferenceSessionState | null;
	findActiveReferenceSource(excludedSheetKey: string, registry: RegistryAccess): WorkbookSheetRuntime | null;
	setReferenceHighlight(sheetKey: string, range: CellRange | null, registry: RegistryAccess): void;
	clearReferenceHighlights(registry: RegistryAccess): void;
}

// ── Factory ─────────────────────────────────────────────────────────────────

export function createReferenceSession(): ReferenceSession {
	let session: ReferenceSessionState | null = null;

	return {
		get currentSession() {
			return session;
		},
		set currentSession(s) {
			session = s;
		},

		findActiveReferenceSource(excludedSheetKey, registry) {
			for (const runtime of registry.iterSheetRuntimes()) {
				if (runtime.sheetKey === excludedSheetKey) continue;
				if (runtime.controller?.canInsertReference()) {
					return runtime;
				}
			}
			return null;
		},

		setReferenceHighlight(sheetKey, range, registry) {
			const runtimeResult = registry.tryGetSheetRuntime(sheetKey);
			if (Result.isError(runtimeResult)) return;
			runtimeResult.value.controller?.setReferenceHighlight(range);
		},

		clearReferenceHighlights(registry) {
			for (const runtime of registry.iterSheetRuntimes()) {
				runtime.controller?.setReferenceHighlight(null);
			}
			session = null;
		},
	};
}
