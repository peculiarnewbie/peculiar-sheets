import { createMemo, For, Index, Show } from "solid-js";
import type { CellValue, ColumnDef, PhysicalCellAddress, RowClassContext, Selection, VisualCellAddress } from "../types";
import { type ColumnIndex, type RowId, type VisualRowIndex, columnIdx, toNumber, visualRow } from "../core/brands";
import { useSheetCustomization } from "../customization";
import { defaultFormatCellValue } from "../core/formatting";
import { normalizeRange, selectionContains } from "../core/selection";
import GridCell from "./GridCell";
import type { RowMetrics } from "./rowMetrics";
import { trackGridLifecycle } from "./lifecycleDiagnostics";

function addressMatchesCurrent(addr: VisualCellAddress, current: PhysicalCellAddress | null): boolean {
	if (!current) return false;
	return toNumber(current.row) === toNumber(addr.row) && toNumber(current.col) === toNumber(addr.col);
}

interface GridBodyProps {
	columns: ColumnDef[];
	rowMetrics: RowMetrics;
	rowGutterWidth: number;
	showReferenceHeaders: boolean;
	getRowHeaderIndex: (visualRow: VisualRowIndex) => number;
	getRowId: (visualRow: VisualRowIndex) => RowId;
	getCellId: (address: VisualCellAddress) => string;
	getRowHeaderTooltip?: (visualRow: VisualRowIndex, backingRow: number) => string | null;
	onRowResizeStart?: (row: VisualRowIndex, event: MouseEvent) => void;
	activeResizeRow?: number | null;
	/** Visible rows from the virtualizer. */
	virtualRows: Array<{ index: number; start: number; size: number }>;
	/** Visible columns from the horizontal virtualizer. Pinned columns are included explicitly. */
	virtualColumns: Array<{ index: number; start: number; size: number; column: ColumnDef }>;
	/** Total rendered height for sizing. */
	totalHeight: number;
	getDisplayValue: (row: VisualRowIndex, col: ColumnIndex) => CellValue;
	/** Raw cell value (pre-formula-eval, pre-formatValue). Used for renderCell + title hooks. */
	getRawValue: (row: VisualRowIndex, col: ColumnIndex) => CellValue;
	/** Visual address of the currently-editing cell (if any). Used to set `isEditing` on custom renderers. */
	editingAddress: VisualCellAddress | null;
	selection: Selection;
	onCellMouseDown: (addr: VisualCellAddress, event: MouseEvent) => void;
	onCellMouseEnter?: (addr: VisualCellAddress, event: MouseEvent) => void;
	onRowHeaderMouseDown?: (row: VisualRowIndex, event: MouseEvent) => void;
	onCellDblClick: (addr: VisualCellAddress) => void;
	pinnedLeftOffsets: number[];
	lastPinnedIndex: number;
	readOnly?: boolean;
	searchMatchSet: Set<string>;
	searchCurrentAddress: PhysicalCellAddress | null;
}

export default function GridBody(props: GridBodyProps) {
	const customization = useSheetCustomization();

	return (
		<div
			class="se-body"
			role="rowgroup"
			style={{
				position: "relative",
				height: `${props.totalHeight}px`,
			}}
		>
			<For each={props.virtualRows}>
				{(virtualRow) => {
					trackGridLifecycle("row");
					const rowIdx = () => virtualRow.index;
					const rowHeight = () => virtualRow.size;
					const rowTop = () => virtualRow.start;
					const vRow = () => visualRow(rowIdx());
					const rowHeaderIndex = () => props.getRowHeaderIndex(vRow());
					const rowHeaderTooltip = () => props.getRowHeaderTooltip?.(vRow(), rowHeaderIndex()) ?? null;
					const containsFocus = () => props.selection.focus.row === vRow();
					const intersectsSelection = () => props.selection.ranges.some((range) => {
						const normalized = normalizeRange(range);
						return vRow() >= normalized.start.row && vRow() <= normalized.end.row;
					});
					const containsActiveEditor = () => props.editingAddress?.row === vRow();
					const rowClassContext = createMemo<RowClassContext>(() => ({
						rowId: props.getRowId(vRow()),
						visualRowIndex: rowIdx(),
						dataRowIndex: rowHeaderIndex(),
						containsFocus: containsFocus(),
						intersectsSelection: intersectsSelection(),
						containsActiveEditor: containsActiveEditor(),
					}));
					const customRowClass = createMemo(() =>
						customization?.getRowClass?.(rowHeaderIndex(), rowClassContext()) ?? "",
					);
					const rowHeaderClass = () => customization?.getRowHeaderClass?.(rowHeaderIndex()) ?? "";
					return (
						<div
							class={`se-row${customRowClass() ? ` ${customRowClass()}` : ""}`}
							classList={{
								"se-row--active": containsFocus(),
								"se-row--selected": intersectsSelection(),
								"se-row--editing": containsActiveEditor(),
							}}
							role="row"
							aria-rowindex={rowIdx() + 1}
							style={{
								position: "absolute",
								top: `${rowTop()}px`,
								display: "flex",
								height: `${rowHeight()}px`,
							}}
						>
							<Show when={props.showReferenceHeaders}>
								<div
									class={`se-row-header-cell${customRowClass() ? ` ${customRowClass()}` : ""}${rowHeaderClass() ? ` ${rowHeaderClass()}` : ""}`}
									classList={{
										"se-row-header-cell--resizing": props.activeResizeRow === rowIdx(),
										"se-row-header-cell--active": containsFocus(),
										"se-row-header-cell--selected": intersectsSelection(),
										"se-row-header-cell--editing": containsActiveEditor(),
									}}
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
									{customization?.getRowHeaderLabel?.(rowHeaderIndex()) ?? String(rowHeaderIndex() + 1)}
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
							<Index each={props.virtualColumns}>
								{(virtualColumn) => {
									const col = () => virtualColumn().column;
									const cidx = () => columnIdx(virtualColumn().index);
									const addr = (): VisualCellAddress => ({ row: vRow(), col: cidx() });
									const rawValue = () => props.getRawValue(vRow(), cidx());
									const displayValue = () => props.getDisplayValue(vRow(), cidx());
									const formattedText = () => {
										const formatValue = col().formatValue;
										return formatValue
											? formatValue(displayValue(), { row: rowIdx(), col: toNumber(cidx()) })
											: defaultFormatCellValue(displayValue());
									};
									const titleOverride = () =>
										col().getCellTitle?.(rawValue(), { row: rowIdx(), col: toNumber(cidx()) });
									const isEditing = () =>
										props.editingAddress?.row === vRow() &&
										props.editingAddress?.col === cidx();
									const isFocused = () =>
										props.selection.focus.row === vRow() &&
										props.selection.focus.col === cidx();
									const isSelected = () => selectionContains(props.selection, addr());
									const cellClass = () => customization?.getCellClass?.(rowIdx(), toNumber(cidx())) ?? "";
									const combinedClass = () => [customRowClass(), cellClass()].filter(Boolean).join(" ");

									return (
										<GridCell
											id={props.getCellId(addr())}
											rawValue={rawValue()}
											formattedText={formattedText()}
											row={vRow()}
											width={virtualColumn().size}
											height={rowHeight()}
											layoutLeft={props.rowGutterWidth + virtualColumn().start}
											colIndex={cidx()}
											readOnly={(props.readOnly ?? false) || col().editable === false}
											pinnedLeft={props.pinnedLeftOffsets?.[virtualColumn().index] ?? -1}
											isLastPinned={virtualColumn().index === props.lastPinnedIndex}
											searchMatch={props.searchMatchSet.has(`${rowIdx()},${toNumber(cidx())}`)}
											searchCurrent={addressMatchesCurrent(addr(), props.searchCurrentAddress)}
											isEditing={isEditing()}
											isFocused={isFocused()}
											isSelected={isSelected()}
											isActiveRow={containsFocus()}
											{...(titleOverride() !== undefined ? { title: titleOverride() as string } : {})}
											{...(col().renderCell ? { renderCell: col().renderCell } : {})}
											{...(combinedClass() ? { customClass: combinedClass() } : {})}
											{...(customization?.getCellStyle
												? (() => {
														const style = customization.getCellStyle(rowIdx(), toNumber(cidx()));
														return style ? { inlineStyle: style } : {};
													})()
												: {})}
											onMouseDown={(e) => props.onCellMouseDown(addr(), e)}
											onMouseEnter={(e) => props.onCellMouseEnter?.(addr(), e)}
											onDblClick={() => props.onCellDblClick(addr())}
										/>
									);
								}}
							</Index>
						</div>
					);
				}}
			</For>
		</div>
	);
}
