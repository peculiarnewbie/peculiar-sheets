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

export interface GridCellRow {
	readonly item: { index: number; start: number; size: number };
	readonly className: string;
	readonly displayValues: readonly CellValue[] | undefined;
}

export interface GridCellContext {
	virtualColumns: Array<{ index: number; start: number; size: number; column: ColumnDef }>;
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
	row: GridCellRow;
	columnIndex: number;
	/** Shared reactive props: cells subscribe where a value is used. */
	grid: GridCellContext;
}

function resolveTitle(title: string | undefined, formattedText: string): string | undefined {
	if (title === undefined) return formattedText || undefined;
	if (title === "") return undefined;
	return title;
}

/** Shared getters avoid allocating a separate closure for each derived cell field.
 * Reading them in JSX still subscribes Solid to the underlying reactive props. */
class CellView {
	constructor(
		readonly props: GridCellProps,
		readonly customization: ReturnType<typeof useSheetCustomization>,
	) {}
	get virtualColumn() {
		const column = this.props.grid.virtualColumns[this.props.columnIndex];
		if (!column)
			throw new Error(`Virtual column ${this.props.columnIndex} is outside the rendered range`);
		return column;
	}
	get row() {
		return visualRow(this.props.row.item.index);
	}
	get col() {
		return columnIdx(this.virtualColumn.index);
	}
	get column() {
		return this.virtualColumn.column;
	}
	get address(): VisualCellAddress {
		return { row: this.row, col: this.col };
	}
	get rawValue() {
		return this.props.grid.getRawValue(this.row, this.col);
	}
	get formattedText() {
		const projected = this.props.row.displayValues;
		const value = projected
			? (projected[this.props.columnIndex] ?? null)
			: this.props.grid.getDisplayValue(this.row, this.col);
		const format = this.column.formatValue;
		return format ? format(value, { row: this.row, col: this.col }) : defaultFormatCellValue(value);
	}
	get readOnly() {
		return (this.props.grid.readOnly ?? false) || this.column.editable === false;
	}
	get isEditing() {
		return (
			this.props.grid.editingAddress?.row === this.row &&
			this.props.grid.editingAddress?.col === this.col
		);
	}
	get isSelected() {
		return selectionContains(this.props.grid.selection, this.address);
	}
	get isCurrentMatch() {
		const current = this.props.grid.searchCurrentAddress;
		return (
			current !== null && toNumber(current.row) === toNumber(this.row) && current.col === this.col
		);
	}
	get pinnedLeft() {
		return this.props.grid.pinnedLeftOffsets[this.virtualColumn.index] ?? -1;
	}
	get isPinned() {
		return this.pinnedLeft >= 0;
	}
	renderContent() {
		const render = this.column.renderCell;
		if (!render) return <span class="se-cell__text" textContent={this.formattedText} />;
		return render({
			value: this.rawValue,
			formattedText: this.formattedText,
			row: this.row,
			col: this.col,
			readOnly: this.readOnly,
			isEditing: this.isEditing,
		} satisfies CellRenderContext);
	}
}

function cellMouseDown(view: CellView, event: MouseEvent) {
	view.props.grid.onCellMouseDown(view.address, event);
}
function cellMouseEnter(view: CellView, event: MouseEvent) {
	view.props.grid.onCellMouseEnter?.(view.address, event);
}
function cellDoubleClick(view: CellView) {
	view.props.grid.onCellDblClick(view.address);
}

export default function GridCell(props: GridCellProps) {
	trackGridLifecycle("cell");
	const view = new CellView(props, useSheetCustomization());
	return (
		<div
			id={props.grid.getCellId(view.address)}
			class={[
				"se-cell",
				props.row.className,
				view.customization?.getCellClass?.(view.row, view.col),
				{
					"se-cell--pinned": view.isPinned,
					"se-cell--pinned-last": view.virtualColumn.index === props.grid.lastPinnedIndex,
					"se-cell--search-match": props.grid.searchMatchSet.has(`${view.row},${view.col}`),
					"se-cell--search-current": view.isCurrentMatch,
					"se-cell--active-row": props.grid.selection.focus.row === view.row,
					"se-cell--range": view.isSelected,
					"se-cell--focus":
						props.grid.selection.focus.row === view.row &&
						props.grid.selection.focus.col === view.col,
					"se-cell--editing": view.isEditing,
				},
			]}
			role="gridcell"
			aria-colindex={view.col + 1}
			aria-selected={view.isSelected ? "true" : "false"}
			aria-readonly={view.readOnly ? "true" : "false"}
			title={resolveTitle(
				view.column.getCellTitle?.(view.rawValue, { row: view.row, col: view.col }),
				view.formattedText,
			)}
			style={{
				// Host styles cannot override virtualized layout.
				...(view.customization?.getCellStyle?.(view.row, view.col) ?? {}),
				width: `${view.virtualColumn.size}px`,
				height: `${props.row.item.size}px`,
				"min-width": `${view.virtualColumn.size}px`,
				position: view.isPinned ? undefined : "absolute",
				left: `${view.isPinned ? view.pinnedLeft : props.grid.rowGutterWidth + view.virtualColumn.start}px`,
			}}
			onMouseDown={[cellMouseDown, view]}
			onMouseEnter={[cellMouseEnter, view]}
			onDblClick={[cellDoubleClick, view]}
		>
			{view.renderContent()}
		</div>
	);
}
