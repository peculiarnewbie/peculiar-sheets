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
	CellStyle,
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
	getLayoutStyle(columnIndex: number, height: number): CellStyle;
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
	/** Stable contexts and a fixed Repeat slot; updates flow through their getters. */
	row: GridCellRow;
	columnIndex: number;
	/** Shared reactive props: cells subscribe where a value is used. */
	grid: GridCellContext;
	/** The parent recreates the row owner when custom rendering is enabled or disabled. */
	renderCustom?: boolean;
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
		readonly rowModel: GridCellRow,
		readonly columnIndex: number,
		readonly grid: GridCellContext,
		readonly customization: ReturnType<typeof useSheetCustomization>,
	) {}
	get virtualColumn() {
		const column = this.grid.virtualColumns[this.columnIndex];
		if (!column)
			throw new Error(`Virtual column ${this.columnIndex} is outside the rendered range`);
		return column;
	}
	get row() {
		return visualRow(this.rowModel.item.index);
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
		return this.grid.getRawValue(this.row, this.col);
	}
	get formattedText() {
		const projected = this.rowModel.displayValues;
		const value = projected
			? (projected[this.columnIndex] ?? null)
			: this.grid.getDisplayValue(this.row, this.col);
		const format = this.column.formatValue;
		return format ? format(value, { row: this.row, col: this.col }) : defaultFormatCellValue(value);
	}
	get readOnly() {
		return (this.grid.readOnly ?? false) || this.column.editable === false;
	}
	get isEditing() {
		return this.grid.editingAddress?.row === this.row && this.grid.editingAddress?.col === this.col;
	}
	get isSelected() {
		return selectionContains(this.grid.selection, this.address);
	}
	get isCurrentMatch() {
		const current = this.grid.searchCurrentAddress;
		return (
			current !== null && toNumber(current.row) === toNumber(this.row) && current.col === this.col
		);
	}
	get pinnedLeft() {
		return this.grid.pinnedLeftOffsets[this.virtualColumn.index] ?? -1;
	}
	get isPinned() {
		return this.pinnedLeft >= 0;
	}
	get className() {
		let classes = "se-cell";
		const rowClass = this.rowModel.className;
		const cellClass = this.customization?.getCellClass?.(this.row, this.col);
		if (rowClass) classes += ` ${rowClass}`;
		if (cellClass) classes += ` ${cellClass}`;
		if (this.isPinned) classes += " se-cell--pinned";
		if (this.virtualColumn.index === this.grid.lastPinnedIndex) classes += " se-cell--pinned-last";
		if (this.grid.searchMatchSet.has(`${this.row},${this.col}`))
			classes += " se-cell--search-match";
		if (this.isCurrentMatch) classes += " se-cell--search-current";
		const focus = this.grid.selection.focus;
		if (focus.row === this.row) classes += " se-cell--active-row";
		if (this.isSelected) classes += " se-cell--range";
		if (focus.row === this.row && focus.col === this.col) classes += " se-cell--focus";
		if (this.isEditing) classes += " se-cell--editing";
		return classes;
	}
	get style() {
		const layout = this.rowModel.getLayoutStyle(this.columnIndex, this.rowModel.item.size);
		const custom = this.customization?.getCellStyle?.(this.row, this.col);
		// Host styles cannot override virtualized layout.
		return custom ? { ...custom, ...layout } : layout;
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
	view.grid.onCellMouseDown(view.address, event);
}
function cellMouseEnter(view: CellView, event: MouseEvent) {
	view.grid.onCellMouseEnter?.(view.address, event);
}
function cellDoubleClick(view: CellView) {
	view.grid.onCellDblClick(view.address);
}

export default function GridCell(props: GridCellProps) {
	trackGridLifecycle("cell");
	const view = new CellView(props.row, props.columnIndex, props.grid, useSheetCustomization());
	// Keeping the default span in the root template lets Solid compile text and
	// attributes into one computation, without a per-cell renderer branch.
	if (props.renderCustom === false) {
		return (
			<div
				id={view.grid.getCellId(view.address)}
				class={view.className}
				role="gridcell"
				aria-colindex={view.col + 1}
				aria-selected={view.isSelected ? "true" : "false"}
				aria-readonly={view.readOnly ? "true" : "false"}
				title={resolveTitle(
					view.column.getCellTitle?.(view.rawValue, { row: view.row, col: view.col }),
					view.formattedText,
				)}
				style={view.style}
				onMouseDown={[cellMouseDown, view]}
				onMouseEnter={[cellMouseEnter, view]}
				onDblClick={[cellDoubleClick, view]}
			>
				<span class="se-cell__text" textContent={view.formattedText} />
			</div>
		);
	}
	return (
		<div
			id={view.grid.getCellId(view.address)}
			class={view.className}
			role="gridcell"
			aria-colindex={view.col + 1}
			aria-selected={view.isSelected ? "true" : "false"}
			aria-readonly={view.readOnly ? "true" : "false"}
			title={resolveTitle(
				view.column.getCellTitle?.(view.rawValue, { row: view.row, col: view.col }),
				view.formattedText,
			)}
			style={view.style}
			onMouseDown={[cellMouseDown, view]}
			onMouseEnter={[cellMouseEnter, view]}
			onDblClick={[cellDoubleClick, view]}
		>
			{view.renderContent()}
		</div>
	);
}
