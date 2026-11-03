import { createMemo, createProjection, For, Repeat, Show } from "solid-js";
import { columnIdx, type RowId, type VisualRowIndex, visualRow } from "../core/brands";
import { normalizeRange } from "../core/selection";
import { useSheetCustomization } from "../customization";
import type { CellValue, ColumnDef, RowClassContext } from "../types";
import GridCell, { type GridCellContext, type GridCellRow } from "./GridCell";
import { trackGridLifecycle } from "./lifecycleDiagnostics";
import type { RowMetrics } from "./rowMetrics";

interface GridBodyProps extends GridCellContext {
	columns: ColumnDef[];
	rowMetrics: RowMetrics;
	showReferenceHeaders: boolean;
	getRowHeaderIndex: (visualRow: VisualRowIndex) => number;
	getRowId: (visualRow: VisualRowIndex) => RowId;
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

export default function GridBody(props: GridBodyProps) {
	const customization = useSheetCustomization();
	const hasFormatters = createMemo(() => props.columns.some((column) => column.formatValue));

	return (
		<div
			class="se-body"
			role="rowgroup"
			style={{
				position: "relative",
				height: `${props.totalHeight}px`,
			}}
		>
			<For keyed={(row) => row.index} each={props.virtualRows}>
				{(virtualRow) => {
					trackGridLifecycle("row");
					const rowIdx = () => virtualRow().index;
					const rowHeight = () => virtualRow().size;
					const rowTop = () => virtualRow().start;
					const vRow = () => visualRow(rowIdx());
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
					const rowClassContext = (): RowClassContext => ({
						rowId: props.getRowId(vRow()),
						visualRowIndex: rowIdx(),
						dataRowIndex: rowHeaderIndex(),
						containsFocus: containsFocus(),
						intersectsSelection: intersectsSelection(),
						containsActiveEditor: containsActiveEditor(),
					});
					const customRowClass = createMemo(
						() => customization?.getRowClass?.(rowHeaderIndex(), rowClassContext()) ?? "",
					);
					// Project custom formatter inputs so unchanged values do not repeat
					// host work. The default text path avoids per-cell projection nodes.
					const displayValues = createMemo(() => {
						if (!hasFormatters()) return undefined;
						return createProjection<CellValue[]>(
							() =>
								props.virtualColumns.map((column) =>
									props.getDisplayValue(vRow(), columnIdx(column.index)),
								),
							[],
							{ key: null, shallow: true },
						);
					});
					const cellRow: GridCellRow = {
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
							aria-rowindex={rowIdx() + 1}
							style={{
								position: "absolute",
								top: `${rowTop()}px`,
								display: "flex",
								width: "100%",
								height: `${rowHeight()}px`,
							}}
						>
							<Show when={props.showReferenceHeaders}>
								<div
									class={[
										`se-row-header-cell${customRowClass() ? ` ${customRowClass()}` : ""}${rowHeaderClass() ? ` ${rowHeaderClass()}` : ""}`,
										{
											"se-row-header-cell--resizing": props.activeResizeRow === rowIdx(),
											"se-row-header-cell--active": containsFocus(),
											"se-row-header-cell--selected": intersectsSelection(),
											"se-row-header-cell--editing": containsActiveEditor(),
										},
									]}
									role="rowheader"
									style={{
										width: `${props.rowGutterWidth}px`,
										"min-width": `${props.rowGutterWidth}px`,
										height: `${rowHeight()}px`,
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
								{(columnIndex) => <GridCell row={cellRow} columnIndex={columnIndex} grid={props} />}
							</Repeat>
						</div>
					);
				}}
			</For>
		</div>
	);
}
