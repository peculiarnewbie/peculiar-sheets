import { createMemo } from "solid-js";
import {
	type ColumnIndex,
	columnIdx,
	toNumber,
	type VisualRowIndex,
	visualRow,
} from "../core/brands";
import { defaultFormatCellValue } from "../core/formatting";
import { selectionContains } from "../core/selection";
import { useSheetCustomization } from "../customization";
import type {
	CellRenderContext,
	CellValue,
	ColumnDef,
	PhysicalCellAddress,
	Selection,
	VisualCellAddress,
} from "../types";
import { trackGridLifecycle } from "./lifecycleDiagnostics";

export interface GridCellContext {
	rowGutterWidth: number;
	getCellId: (address: VisualCellAddress) => string;
	getDisplayValue: (row: VisualRowIndex, col: ColumnIndex) => CellValue;
	getRawValue: (row: VisualRowIndex, col: ColumnIndex) => CellValue;
	editingAddress: VisualCellAddress | null;
	selection: Selection;
	onCellMouseDown: (addr: VisualCellAddress, event: MouseEvent) => void;
	onCellMouseEnter?: (addr: VisualCellAddress, event: MouseEvent) => void;
	onCellDblClick: (addr: VisualCellAddress) => void;
	pinnedLeftOffsets: number[];
	lastPinnedIndex: number;
	readOnly?: boolean;
	searchMatchSet: Set<string>;
	searchCurrentAddress: PhysicalCellAddress | null;
}

interface GridCellProps {
	virtualRow: { index: number; start: number; size: number };
	virtualColumn: { index: number; start: number; size: number; column: ColumnDef };
	/** Shared reactive props: cells subscribe where a value is used. */
	grid: GridCellContext;
	rowClass: string;
}

function resolveTitle(title: string | undefined, formattedText: string): string | undefined {
	if (title === undefined) return formattedText || undefined;
	if (title === "") return undefined;
	return title;
}

export default function GridCell(props: GridCellProps) {
	trackGridLifecycle("cell");
	const customization = useSheetCustomization();
	const row = () => visualRow(props.virtualRow.index);
	const col = () => columnIdx(props.virtualColumn.index);
	const column = () => props.virtualColumn.column;
	const address = (): VisualCellAddress => ({ row: row(), col: col() });
	const rawValue = () => props.grid.getRawValue(row(), col());
	const formattedText = () => {
		const value = props.grid.getDisplayValue(row(), col());
		const format = column().formatValue;
		return format ? format(value, { row: row(), col: col() }) : defaultFormatCellValue(value);
	};
	const readOnly = () => (props.grid.readOnly ?? false) || column().editable === false;
	const isEditing = () =>
		props.grid.editingAddress?.row === row() && props.grid.editingAddress?.col === col();
	const isSelected = () => selectionContains(props.grid.selection, address());
	const isCurrentMatch = () => {
		const current = props.grid.searchCurrentAddress;
		return current !== null && toNumber(current.row) === toNumber(row()) && current.col === col();
	};
	const pinnedLeft = () => props.grid.pinnedLeftOffsets[props.virtualColumn.index] ?? -1;
	const isPinned = () => pinnedLeft() >= 0;
	const renderer = createMemo(() => column().renderCell);
	function renderContent() {
		const render = renderer();
		if (!render) return <span class="se-cell__text">{formattedText()}</span>;
		return render({
			value: rawValue(),
			formattedText: formattedText(),
			row: row(),
			col: col(),
			readOnly: readOnly(),
			isEditing: isEditing(),
		} satisfies CellRenderContext);
	}

	return (
		<div
			id={props.grid.getCellId(address())}
			class={[
				"se-cell",
				props.rowClass,
				customization?.getCellClass?.(row(), col()),
				{
					"se-cell--pinned": isPinned(),
					"se-cell--pinned-last": props.virtualColumn.index === props.grid.lastPinnedIndex,
					"se-cell--search-match": props.grid.searchMatchSet.has(`${row()},${col()}`),
					"se-cell--search-current": isCurrentMatch(),
					"se-cell--active-row": props.grid.selection.focus.row === row(),
					"se-cell--range": isSelected(),
					"se-cell--focus":
						props.grid.selection.focus.row === row() && props.grid.selection.focus.col === col(),
					"se-cell--editing": isEditing(),
				},
			]}
			role="gridcell"
			aria-colindex={col() + 1}
			aria-selected={isSelected() ? "true" : "false"}
			aria-readonly={readOnly() ? "true" : "false"}
			title={resolveTitle(
				column().getCellTitle?.(rawValue(), { row: row(), col: col() }),
				formattedText(),
			)}
			style={{
				// Host styles cannot override virtualized layout.
				...(customization?.getCellStyle?.(row(), col()) ?? {}),
				width: `${props.virtualColumn.size}px`,
				height: `${props.virtualRow.size}px`,
				"min-width": `${props.virtualColumn.size}px`,
				position: isPinned() ? undefined : "absolute",
				left: `${isPinned() ? pinnedLeft() : props.grid.rowGutterWidth + props.virtualColumn.start}px`,
			}}
			onMouseDown={(event) => props.grid.onCellMouseDown(address(), event)}
			onMouseEnter={(event) => props.grid.onCellMouseEnter?.(address(), event)}
			onDblClick={() => props.grid.onCellDblClick(address())}
		>
			{renderContent()}
		</div>
	);
}
