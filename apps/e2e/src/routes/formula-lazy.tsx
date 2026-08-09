import HyperFormula from "hyperformula";
import { createResource, createSignal, onCleanup, onMount } from "solid-js";
import {
	Sheet,
	formulaSheetId,
	type CellValue,
	type ColumnDef,
	type SheetController,
} from "peculiar-sheets";

const columns: ColumnDef[] = Array.from({ length: 10 }, (_, index) => ({
	id: `column-${index}`,
	header: String.fromCharCode(65 + index),
	width: 100,
	editable: true,
}));

const data: CellValue[][] = Array.from({ length: 50 }, () => Array<CellValue>(10).fill(null));

export default function FormulaLazyPage() {
	const shouldSimulateLateDetach = new URLSearchParams(window.location.search).has("simulate-late-detach");
	const nativeResizeObserver = window.ResizeObserver;
	if (shouldSimulateLateDetach) {
		class SilentResizeObserver implements ResizeObserver {
			disconnect(): void {}
			observe(_target: Element, _options?: ResizeObserverOptions): void {}
			unobserve(_target: Element): void {}
		}

		window.ResizeObserver = SilentResizeObserver;
		onCleanup(() => {
			window.ResizeObserver = nativeResizeObserver;
		});
	}

	const [routeEpoch, setRouteEpoch] = createSignal<number>();
	const [routeReady] = createResource(routeEpoch, async () => {
		await new Promise((resolve) => setTimeout(resolve, 20));
		return "ready";
	});
	const hf = HyperFormula.buildEmpty({ licenseKey: "gpl-v3" });
	const sheetName = hf.addSheet("lazy-scratch");
	const sheetId = hf.getSheetId(sheetName);

	if (sheetId === undefined) {
		throw new Error(`HyperFormula did not resolve sheet "${sheetName}".`);
	}

	onMount(() => {
		window.__SHEET_DATA__ = data;
		// Exercise the route transition Electroswag hits: the lazy route first
		// mounts, then a route-owned resource briefly returns to its Suspense
		// fallback while preserving the content branch.
		queueMicrotask(() => {
			if (shouldSimulateLateDetach) {
				for (const virtualizer of window.__VIRTUALIZERS__ ?? []) {
					const viewport = virtualizer.scrollElement;
					virtualizer._didMount()();
					virtualizer.scrollElement = viewport;
					virtualizer.scrollRect = { width: 0, height: 0 };
					virtualizer.range = null;
					virtualizer.options.onChange(virtualizer, false);
				}
				return;
			}

			setRouteEpoch(1);
		});
	});

	return (
		<div
			data-testid="harness"
			data-build-mode={import.meta.env.PROD ? "production" : "development"}
			style={{
				display: "flex",
				"flex-direction": "column",
				height: "100vh",
				width: "100vw",
			}}
		>
			<span style={{ display: "none" }}>{routeReady()}</span>
			<div style={{ height: "36px", "flex-shrink": 0 }}>Lazy formula route</div>
			<div style={{ display: "flex", flex: 1, "min-height": 0, "min-width": 0 }}>
				<div style={{ flex: 1, "min-height": 0, "min-width": 0 }}>
					<Sheet
						data={data}
						columns={columns}
						formulaEngine={{ instance: hf, sheetId: formulaSheetId(sheetId), sheetName }}
						showFormulaBar
						showReferenceHeaders
						ref={(controller: SheetController) => {
							window.__SHEET_CONTROLLER__ = controller;
						}}
					/>
				</div>
			</div>
		</div>
	);
}
