import { For, Show } from "solid-js";
import type { CellRange, FillPreview, Selection } from "../types";
import { normalizeRange, primaryRange } from "../core/selection";

interface SelectionOverlayProps {
	selection: Selection;
	clipboardRange: CellRange | null;
	referenceRange: CellRange | null;
	externalReferenceRange: CellRange | null;
	fillPreview: FillPreview | null;
	showFillHandle: boolean;
	columnWidths: number[];
	rowHeight: number;
	scrollLeft: number;
	scrollTop: number;
	leftOffset?: number;
	onFillHandleMouseDown?: (event: MouseEvent) => void;
}

interface RangeRect {
	left: number;
	top: number;
	width: number;
	height: number;
}

function computeRangeRect(
	range: CellRange,
	columnWidths: number[],
	rowHeight: number,
): RangeRect {
	const nr = normalizeRange(range);

	let left = 0;
	for (let c = 0; c < nr.start.col; c++) {
		left += columnWidths[c] ?? 120;
	}

	let width = 0;
	for (let c = nr.start.col; c <= nr.end.col; c++) {
		width += columnWidths[c] ?? 120;
	}

	const top = nr.start.row * rowHeight;
	const height = (nr.end.row - nr.start.row + 1) * rowHeight;

	return { left, top, width, height };
}

export default function SelectionOverlay(props: SelectionOverlayProps) {
	const rects = () =>
		props.selection.ranges.map((range) =>
			computeRangeRect(range, props.columnWidths, props.rowHeight),
		);

	const clipboardRect = () => {
		const range = props.clipboardRange;
		if (!range) return null;
		return computeRangeRect(range, props.columnWidths, props.rowHeight);
	};

	const referenceRect = () => {
		const range = props.referenceRange;
		if (!range) return null;
		return computeRangeRect(range, props.columnWidths, props.rowHeight);
	};

	const externalReferenceRect = () => {
		const range = props.externalReferenceRange;
		if (!range) return null;
		return computeRangeRect(range, props.columnWidths, props.rowHeight);
	};

	const fillPreviewRect = () => {
		const preview = props.fillPreview;
		if (!preview) return null;
		return computeRangeRect(preview.extension, props.columnWidths, props.rowHeight);
	};

	const primaryRect = () => {
		const range = primaryRange(props.selection);
		if (!range) return null;
		return computeRangeRect(range, props.columnWidths, props.rowHeight);
	};

	return (
		<div
			class="se-selection-overlay"
			style={{ left: `${props.leftOffset ?? 0}px` }}
		>
			<For each={rects()}>
				{(rect) => (
					<div
						class="se-selection-rect"
						style={{
							position: "absolute",
							left: `${rect.left}px`,
							top: `${rect.top}px`,
							width: `${rect.width}px`,
							height: `${rect.height}px`,
						}}
					/>
				)}
			</For>
			<Show when={clipboardRect()}>
				{(rect) => (
					<div
						class="se-clipboard-rect"
						style={{
							position: "absolute",
							left: `${rect().left}px`,
							top: `${rect().top}px`,
							width: `${rect().width}px`,
							height: `${rect().height}px`,
						}}
					/>
				)}
			</Show>
			<Show when={referenceRect()}>
				{(rect) => (
					<div
						class="se-reference-rect"
						style={{
							position: "absolute",
							left: `${rect().left}px`,
							top: `${rect().top}px`,
							width: `${rect().width}px`,
							height: `${rect().height}px`,
						}}
					/>
				)}
			</Show>
			<Show when={externalReferenceRect()}>
				{(rect) => (
					<div
						class="se-reference-rect"
						style={{
							position: "absolute",
							left: `${rect().left}px`,
							top: `${rect().top}px`,
							width: `${rect().width}px`,
							height: `${rect().height}px`,
						}}
					/>
				)}
			</Show>
			<Show when={fillPreviewRect()}>
				{(rect) => (
					<div
						class="se-fill-preview-rect"
						style={{
							position: "absolute",
							left: `${rect().left}px`,
							top: `${rect().top}px`,
							width: `${rect().width}px`,
							height: `${rect().height}px`,
						}}
					/>
				)}
			</Show>
			<Show when={props.showFillHandle && primaryRect()}>
				{(rect) => (
					<div
						class="se-fill-handle"
						style={{
							left: `${rect().left + rect().width}px`,
							top: `${rect().top + rect().height}px`,
						}}
						onMouseDown={(event) => props.onFillHandleMouseDown?.(event)}
					/>
				)}
			</Show>
		</div>
	);
}
