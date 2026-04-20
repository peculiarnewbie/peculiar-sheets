/**
 * ReplayHost — wraps a `<Sheet>` and surfaces the live controller + mutation
 * buffer so the showcase's `ScenarioPlayer` can drive scenarios through the
 * `DomDriver` without ever touching `window.*` globals.
 *
 * Under the hood we use the same `createMutationBuffer` factory that
 * `apps/e2e/src/harness.tsx` uses — one reconciliation implementation, two
 * mount points.
 *
 * The component renders children via a render-prop: the caller receives the
 * live `data()` signal and the full set of Sheet callbacks, then spreads them
 * onto whatever `<Sheet>` configuration that demo needs (formulas, column
 * defs, customization, etc.). That keeps ReplayHost demo-agnostic.
 */

import { createSignal, onCleanup, type JSX } from "solid-js";
import {
	createMutationBuffer,
	type MutationBuffer,
	type MutationBufferBindings,
} from "sheet-scenarios";
import type { CellValue, ColumnDef, SheetController } from "peculiar-sheets";

export interface ReplayHostHandle {
	/** Returns the live controller handle, or `null` if the sheet hasn't mounted yet. */
	controller: () => SheetController | null;
	/** Shared mutation buffer — feeds the DomDriver. */
	buffer: MutationBuffer;
}

export interface ReplayHostRenderProps {
	/** Live cell data — pass to `<Sheet data={...}>`. */
	data: () => CellValue[][];
	/** Sheet callbacks bound to the mutation buffer. */
	bindings: MutationBufferBindings;
	/** Ref callback to capture the SheetController. */
	ref: (ctrl: SheetController) => void;
}

export interface ReplayHostProps {
	/** Initial data snapshot — used by `buffer.reset()` between scenarios. */
	initialData: CellValue[][];
	/** Column layout; only the count is consumed internally, but we ask for the
	 * defs directly so callers can forward a single source of truth. */
	columns: readonly ColumnDef[];
	/** Called once the buffer + initial (null) controller snapshot are ready. */
	onReady?: (handle: ReplayHostHandle) => void;
	/** Render prop — receives live data + bindings + ref, returns the `<Sheet>` subtree. */
	children: (render: ReplayHostRenderProps) => JSX.Element;
}

export function ReplayHost(props: ReplayHostProps): JSX.Element {
	const [controller, setController] = createSignal<SheetController | null>(null);
	const buffer = createMutationBuffer({
		initialData: props.initialData,
		columnCount: props.columns.length,
	});

	const bindings = buffer.bindings(controller);

	props.onReady?.({ controller, buffer });

	onCleanup(() => {
		buffer.clear();
	});

	return props.children({
		data: buffer.data,
		bindings,
		ref: (ctrl) => setController(ctrl),
	});
}
