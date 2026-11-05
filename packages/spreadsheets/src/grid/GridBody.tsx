import { createMemo, createProjection, For, Repeat, Show } from "solid-js";
import { columnIdx, type RowId, type VisualRowIndex, visualRow } from "../core/brands";
import { normalizeRange } from "../core/selection";
import { useSheetCustomization } from "../customization";
import type { CellStyle, CellValue, ColumnDef, RowClassContext } from "../types";
import GridCell, { type GridCellContext, type GridCellLayout, type GridCellRow } from "./GridCell";
import { trackGridLifecycle } from "./lifecycleDiagnostics";
import type { RowMetrics } from "./rowMetrics";

interface GridBodyProps extends GridCellContext {
	columns: ColumnDef[];
	rowMetrics: RowMetrics;
	showReferenceHeaders: boolean;
	getRowHeaderIndex: (visualRow: VisualRowIndex) => number;
	getRowId: (visualRow: VisualRowIndex) => RowId;
	/** Share row dependencies while preserving per-cell formula dependencies. */
	getRowDisplayValues?: (row: VisualRowIndex, columns: readonly { index: number }[]) => CellValue[];
	getRowHeaderTooltip?: (visualRow: VisualRowIndex, backingRow: number) => string | null;
	onRowResizeStart?: (row: VisualRowIndex, event: MouseEvent) => void;
	activeResizeRow?: number | null;
	/** Visible rows from the virtualizer. */
	virtualRows: Array<{ index: number; start: number; size: number }>;
	/** Visible columns from the horizontal virtualizer. Pinned columns are included explicitly. */
	virtualColumns: Array<{ index: number; start: number; size: number; column: ColumnDef }>;
	/** Total rendered height for sizing. */
	totalHeight: number;
	onRowHeaderMouseDown?: (row: VisualRowIndex, event: MouseEvent) => void;
}

interface ColumnLayout extends GridCellLayout {
	prefix: string;
}

export default function GridBody(props: GridBodyProps) {
	const customization = useSheetCustomization();
	const hasFormatters = createMemo(() => props.columns.some((column) => column.formatValue));
	const hasCustomRenderers = createMemo(() => props.columns.some((column) => column.renderCell));
	const hasCustomStyles = createMemo(() => Boolean(customization?.getCellStyle));
	const columnCount = createMemo(() => props.virtualColumns.length);
	// Slots retain their CSS references while the body publishes new geometry.
	// Plain cells bind these references once, including when rows are recycled.
	const layouts = createMemo(() => {
		return Array.from({ length: columnCount() }, (_, slot): ColumnLayout => {
			const prefix = `--se-column-${slot}`;
			const width = `var(${prefix}-width)`;
			const left = `var(${prefix}-left)`;
			// CSS accepts variables here; csstype's Position union omits them.
			const position = `var(${prefix}-position)` as NonNullable<CellStyle["position"]>;
			const height = "var(--se-rendered-row-height)";
			return {
				prefix,
				style: { width, "min-width": width, height, position, left },
				cssText: `width:${width};min-width:${width};height:${height};position:${position};left:${left}`,
			};
		});
	});
	const getLayout = (columnIndex: number): ColumnLayout => {
		const layout = layouts()[columnIndex];
		if (!layout) throw new Error(`Column layout ${columnIndex} is outside the rendered range`);
		return layout;
	};
	const layoutVariables = createMemo(() => {
		const gutter = props.rowGutterWidth;
		const pinned = props.pinnedLeftOffsets;
		const variables: Record<string, string> = {};
		props.virtualColumns.forEach((column, slot) => {
			const { prefix } = getLayout(slot);
			const pinnedLeft = pinned[column.index] ?? -1;
			variables[`${prefix}-width`] = `${column.size}px`;
			variables[`${prefix}-left`] = `${pinnedLeft >= 0 ? pinnedLeft : gutter + column.start}px`;
			variables[`${prefix}-position`] = pinnedLeft >= 0 ? "sticky" : "absolute";
		});
		return variables;
	});

	// Contiguous virtual rows share a viewport-sized set of owners. Overlapping
	// indices retain their owners; long jumps reuse the slots that left view.
	const renderRows = (renderCustom: boolean, plainLayout: boolean) => (
		<For keyed={(row) => row.index % props.virtualRows.length} each={props.virtualRows}>
			{(virtualRow) => {
				trackGridLifecycle("row");
				const vRow = () => visualRow(virtualRow().index);
				const rowHeaderIndex = () => props.getRowHeaderIndex(vRow());
				const rowHeaderTooltip = () =>
					props.getRowHeaderTooltip?.(vRow(), rowHeaderIndex()) ?? null;
				const containsFocus = () => props.selection.focus.row === vRow();
				const intersectsSelection = () =>
					props.selection.ranges.some((range) => {
						const normalized = normalizeRange(range);
						return vRow() >= normalized.start.row && vRow() <= normalized.end.row;
					});
				const containsActiveEditor = () => props.editingAddress?.row === vRow();
				const rowSelection = createMemo(() =>
					containsFocus() || intersectsSelection() ? props.selection : null,
				);
				const rowEditingAddress = createMemo(() =>
					containsActiveEditor() ? props.editingAddress : null,
				);
				const rowClassContext = (): RowClassContext => ({
					rowId: props.getRowId(vRow()),
					visualRowIndex: virtualRow().index,
					dataRowIndex: rowHeaderIndex(),
					containsFocus: containsFocus(),
					intersectsSelection: intersectsSelection(),
					containsActiveEditor: containsActiveEditor(),
				});
				const customRowClass = createMemo(
					() => customization?.getRowClass?.(rowHeaderIndex(), rowClassContext()) ?? "",
				);
				// Share display dependencies across a row. The plain memo avoids
				// per-cell store nodes; custom formatters also filter unchanged values.
				const readDisplayValues = () => {
					const row = vRow();
					const columns = props.virtualColumns;
					const readRow = props.getRowDisplayValues;
					return readRow
						? readRow(row, columns)
						: columns.map((column) => props.getDisplayValue(row, columnIdx(column.index)));
				};
				const displayValues = createMemo(() => {
					if (!hasFormatters()) return readDisplayValues();
					return createProjection<CellValue[]>(readDisplayValues, [], {
						key: null,
						shallow: true,
					});
				});
				const cellRow: GridCellRow = {
					grid: props,
					customization,
					getLayout,
					get selection() {
						return rowSelection();
					},
					get editingAddress() {
						return rowEditingAddress();
					},
					get displayValues() {
						return displayValues();
					},
					get item() {
						return virtualRow();
					},
					get className() {
						return customRowClass();
					},
				};
				const rowHeaderClass = () => customization?.getRowHeaderClass?.(rowHeaderIndex()) ?? "";
				return (
					<div
						class={[
							`se-row${customRowClass() ? ` ${customRowClass()}` : ""}`,
							{
								"se-row--active": containsFocus(),
								"se-row--selected": intersectsSelection(),
								"se-row--editing": containsActiveEditor(),
							},
						]}
						role="row"
						aria-rowindex={virtualRow().index + 1}
						style={{
							position: "absolute",
							top: `${virtualRow().start}px`,
							display: "flex",
							width: "100%",
							height: `${virtualRow().size}px`,
							"--se-rendered-row-height": `${virtualRow().size}px`,
						}}
					>
						<Show when={props.showReferenceHeaders}>
							<div
								class={[
									`se-row-header-cell${customRowClass() ? ` ${customRowClass()}` : ""}${rowHeaderClass() ? ` ${rowHeaderClass()}` : ""}`,
									{
										"se-row-header-cell--resizing": props.activeResizeRow === virtualRow().index,
										"se-row-header-cell--active": containsFocus(),
										"se-row-header-cell--selected": intersectsSelection(),
										"se-row-header-cell--editing": containsActiveEditor(),
									},
								]}
								role="rowheader"
								style={{
									width: `${props.rowGutterWidth}px`,
									"min-width": `${props.rowGutterWidth}px`,
									height: `${virtualRow().size}px`,
								}}
								title={rowHeaderTooltip() ?? undefined}
								onMouseDown={(e) => props.onRowHeaderMouseDown?.(vRow(), e)}
							>
								<Show when={customization?.getRowHeaderSublabel?.(rowHeaderIndex())}>
									{(sub) => <span class="se-row-header-sublabel">{sub()}</span>}
								</Show>
								{customization?.getRowHeaderLabel?.(rowHeaderIndex()) ??
									String(rowHeaderIndex() + 1)}
								<Show when={props.onRowResizeStart}>
									<div
										class="se-row-resize-handle"
										onMouseDown={(e) => {
											e.preventDefault();
											e.stopPropagation();
											props.onRowResizeStart?.(vRow(), e);
										}}
									/>
								</Show>
							</div>
						</Show>
						<Repeat count={props.virtualColumns.length}>
							{(columnIndex) => (
								<GridCell
									row={cellRow}
									columnIndex={columnIndex}
									renderCustom={renderCustom}
									plainLayout={plainLayout}
								/>
							)}
						</Repeat>
					</div>
				);
			}}
		</For>
	);
	const renderedRows = createMemo(() => {
		const renderCustom = hasCustomRenderers();
		return renderRows(renderCustom, !renderCustom && !hasCustomStyles());
	});

	return (
		<div
			class="se-body"
			role="rowgroup"
			style={{
				position: "relative",
				height: `${props.totalHeight}px`,
				...layoutVariables(),
			}}
		>
			{renderedRows()}
		</div>
	);
}
