import {
	type ColumnIndex,
	columnIdx,
	toNumber,
	type VisualRowIndex,
	visualRow,
} from "../core/brands";
import { defaultFormatCellValue } from "../core/formatting";
import { selectionContains } from "../core/selection";
import type {
	CellRenderContext,
	CellStyle,
	CellValue,
	ColumnDef,
	PhysicalCellAddress,
	Selection,
	SheetCustomization,
	VisualCellAddress,
} from "../types";
import { trackGridLifecycle } from "./lifecycleDiagnostics";

export interface GridCellLayout {
	style: CellStyle;
	cssText: string;
}

export interface GridCellRow {
	readonly grid: GridCellContext;
	readonly customization: SheetCustomization | undefined;
	readonly item: { index: number; start: number; size: number };
	readonly className: string;
	readonly selection: Selection | null;
	readonly editingAddress: VisualCellAddress | null;
	readonly displayValues: readonly CellValue[] | undefined;
	getLayout(columnIndex: number): GridCellLayout;
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
	/** The parent recreates the row owner when custom rendering is enabled or disabled. */
	renderCustom?: boolean;
	/** The parent recreates rows when custom style hooks are added or removed. */
	plainLayout?: boolean;
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
	) {}
	get grid() {
		return this.rowModel.grid;
	}
	get customization() {
		return this.rowModel.customization;
	}
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
		const editing = this.rowModel.editingAddress;
		return editing?.row === this.row && editing.col === this.col;
	}
	get isSelected() {
		const selection = this.rowModel.selection;
		return selection !== null && selectionContains(selection, this.address);
	}
	get className() {
		const row = this.row;
		const column = this.virtualColumn;
		const col = columnIdx(column.index);
		const grid = this.grid;
		const selection = this.rowModel.selection;
		const focus = selection?.focus;
		const editing = this.rowModel.editingAddress;
		const current = grid.searchCurrentAddress;
		let classes = "se-cell";
		const rowClass = this.rowModel.className;
		const cellClass = this.customization?.getCellClass?.(row, col);
		if (rowClass) classes += ` ${rowClass}`;
		if (cellClass) classes += ` ${cellClass}`;
		if ((grid.pinnedLeftOffsets[column.index] ?? -1) >= 0) classes += " se-cell--pinned";
		if (column.index === grid.lastPinnedIndex) classes += " se-cell--pinned-last";
		if (grid.searchMatchSet.has(`${row},${col}`)) classes += " se-cell--search-match";
		if (current !== null && toNumber(current.row) === toNumber(row) && current.col === col)
			classes += " se-cell--search-current";
		if (focus?.row === row) classes += " se-cell--active-row";
		if (selection !== null && selectionContains(selection, { row, col }))
			classes += " se-cell--range";
		if (focus?.row === row && focus.col === col) classes += " se-cell--focus";
		if (editing?.row === row && editing.col === col) classes += " se-cell--editing";
		return classes;
	}
	get style() {
		const layout = this.rowModel.getLayout(this.columnIndex);
		const custom = this.customization?.getCellStyle?.(this.row, this.col);
		// Host styles cannot override virtualized layout.
		return custom ? { ...custom, ...layout.style } : layout.style;
	}
	get layoutCssText() {
		return this.rowModel.getLayout(this.columnIndex).cssText;
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
function cellMouseOver(view: CellView, event: MouseEvent) {
	// Delegate the bubbling event while preserving mouseenter semantics.
	if (
		event.currentTarget instanceof Node &&
		event.relatedTarget instanceof Node &&
		event.currentTarget.contains(event.relatedTarget)
	) {
		return;
	}
	view.grid.onCellMouseEnter?.(view.address, event);
}
function cellDoubleClick(view: CellView) {
	view.grid.onCellDblClick(view.address);
}

export default function GridCell(props: GridCellProps) {
	trackGridLifecycle("cell");
	const view = new CellView(props.row, props.columnIndex);
	// Geometry changes flow through inherited CSS variables; this binding is static.
	if (props.renderCustom === false && props.plainLayout === true) {
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
				style={/* @static */ view.layoutCssText}
				onMouseDown={[cellMouseDown, view]}
				onMouseOver={[cellMouseOver, view]}
				onDblClick={[cellDoubleClick, view]}
			>
				<span class="se-cell__text" textContent={view.formattedText} />
			</div>
		);
	}
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
				onMouseOver={[cellMouseOver, view]}
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
			onMouseOver={[cellMouseOver, view]}
			onDblClick={[cellDoubleClick, view]}
		>
			{view.renderContent()}
		</div>
	);
}
