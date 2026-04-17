import { For, Show } from "solid-js";
import type { CellAddress, CellValue, ColumnDef } from "../types";
import { useSheetCustomization } from "../customization";
import { getEffectiveColumnWidth } from "../core/sizing";
import { defaultFormatCellValue } from "../core/formatting";
import GridCell from "./GridCell";
import type { RowMetrics } from "./rowMetrics";

function addressMatchesCurrent(addr: CellAddress, current: CellAddress | null): boolean {
	if (!current) return false;
	return current.row === addr.row && current.col === addr.col;
}

interface GridBodyProps {
	columns: ColumnDef[];
	columnWidths: Map<string, number>;
	rowMetrics: RowMetrics;
	rowGutterWidth: number;
	showReferenceHeaders: boolean;
	getRowHeaderIndex: (visualRow: number) => number;
	getRowHeaderTooltip?: (visualRow: number, backingRow: number) => string | null;
	onRowResizeStart?: (row: number, event: MouseEvent) => void;
	activeResizeRow?: number | null;
	/** Visible rows from the virtualizer. */
	virtualRows: Array<{ index: number; start: number; size: number }>;
	/** Total rendered height for sizing. */
	totalHeight: number;
	getDisplayValue: (row: number, col: number) => CellValue;
	/** Raw cell value (pre-formula-eval, pre-formatValue). Used for renderCell + title hooks. */
	getRawValue: (row: number, col: number) => CellValue;
	/** Visual address of the currently-editing cell (if any). Used to set `isEditing` on custom renderers. */
	editingAddress: CellAddress | null;
	onCellMouseDown: (addr: CellAddress, event: MouseEvent) => void;
	onCellMouseEnter?: (addr: CellAddress, event: MouseEvent) => void;
	onRowHeaderMouseDown?: (row: number, event: MouseEvent) => void;
	onCellDblClick: (addr: CellAddress) => void;
	pinnedLeftOffsets: number[];
	lastPinnedIndex: number;
	readOnly?: boolean;
	searchMatchSet: Set<string>;
	searchCurrentAddress: CellAddress | null;
}

export default function GridBody(props: GridBodyProps) {
	const customization = useSheetCustomization();

	function getColWidth(col: ColumnDef): number {
		return getEffectiveColumnWidth(col, props.columnWidths);
	}

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
					const rowIdx = () => virtualRow.index;
					const rowHeight = () => virtualRow.size;
					const rowTop = () => virtualRow.start;
					const rowHeaderIndex = () => props.getRowHeaderIndex(rowIdx());
					const rowHeaderTooltip = () => props.getRowHeaderTooltip?.(rowIdx(), rowHeaderIndex()) ?? null;
					return (
						<div
							class="se-row"
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
									class={`se-row-header-cell${customization?.getRowHeaderClass ? ` ${customization.getRowHeaderClass(rowHeaderIndex())}` : ""}`}
									classList={{
										"se-row-header-cell--resizing": props.activeResizeRow === rowIdx(),
									}}
									role="rowheader"
									style={{
										width: `${props.rowGutterWidth}px`,
										"min-width": `${props.rowGutterWidth}px`,
										height: `${rowHeight()}px`,
									}}
									title={rowHeaderTooltip() ?? undefined}
									onMouseDown={(e) => props.onRowHeaderMouseDown?.(rowIdx(), e)}
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
												props.onRowResizeStart?.(rowIdx(), e);
											}}
										/>
									</Show>
								</div>
							</Show>
							<For each={props.columns}>
								{(col, colIdx) => {
									const addr = (): CellAddress => ({ row: rowIdx(), col: colIdx() });
									const rawValue = () => props.getRawValue(rowIdx(), colIdx());
									const displayValue = () => props.getDisplayValue(rowIdx(), colIdx());
									const formattedText = () =>
										col.formatValue
											? col.formatValue(displayValue(), { row: rowIdx(), col: colIdx() })
											: defaultFormatCellValue(displayValue());
									const titleOverride = () =>
										col.getCellTitle?.(rawValue(), { row: rowIdx(), col: colIdx() });
									const isEditing = () =>
										props.editingAddress?.row === rowIdx() &&
										props.editingAddress?.col === colIdx();

									return (
										<GridCell
											rawValue={rawValue()}
											formattedText={formattedText()}
											row={rowIdx()}
											width={getColWidth(col)}
											height={rowHeight()}
											colIndex={colIdx()}
											readOnly={props.readOnly ?? false}
											pinnedLeft={props.pinnedLeftOffsets?.[colIdx()] ?? -1}
											isLastPinned={colIdx() === props.lastPinnedIndex}
											searchMatch={props.searchMatchSet.has(`${rowIdx()},${colIdx()}`)}
											searchCurrent={addressMatchesCurrent(addr(), props.searchCurrentAddress)}
											isEditing={isEditing()}
											{...(titleOverride() !== undefined ? { title: titleOverride() as string } : {})}
											{...(col.renderCell ? { renderCell: col.renderCell } : {})}
											{...(customization?.getCellClass ? { customClass: customization.getCellClass(rowIdx, colIdx()) } : {})}
											onMouseDown={(e) => props.onCellMouseDown(addr(), e)}
											onMouseEnter={(e) => props.onCellMouseEnter?.(addr(), e)}
											onDblClick={() => props.onCellDblClick(addr())}
										/>
									);
								}}
							</For>
						</div>
					);
				}}
			</For>
		</div>
	);
}
