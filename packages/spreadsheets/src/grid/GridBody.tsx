import { For, Show } from "solid-js";
import type { CellAddress, CellRange, CellValue, ColumnDef, Selection } from "../types";
import { addressEquals, selectionContains } from "../core/selection";
import { useSheetCustomization } from "../customization";
import GridCell from "./GridCell";

function addressMatchesCurrent(addr: CellAddress, current: CellAddress | null): boolean {
	if (!current) return false;
	return current.row === addr.row && current.col === addr.col;
}

interface GridBodyProps {
	columns: ColumnDef[];
	columnWidths: Map<string, number>;
	rowHeight: number;
	selection: Selection;
	clipboardRange: CellRange | null;
	rowGutterWidth: number;
	showReferenceHeaders: boolean;
	/** Indices of visible rows from the virtualizer. */
	visibleRows: number[];
	/** Total row count for sizing. */
	totalRows: number;
	getDisplayValue: (row: number, col: number) => CellValue;
	onCellMouseDown: (addr: CellAddress, event: MouseEvent) => void;
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
		return props.columnWidths.get(col.id) ?? col.width ?? 120;
	}

	return (
		<div
			class="se-body"
			role="rowgroup"
			style={{
				position: "relative",
				height: `${props.totalRows * props.rowHeight}px`,
			}}
		>
			<For each={props.visibleRows}>
				{(rowIdx) => {
					return (
						<div
							class="se-row"
							role="row"
							aria-rowindex={rowIdx + 1}
							style={{
								position: "absolute",
								top: `${rowIdx * props.rowHeight}px`,
								display: "flex",
								height: `${props.rowHeight}px`,
							}}
						>
							<Show when={props.showReferenceHeaders}>
								<div
									class={`se-row-header-cell${customization?.getRowHeaderClass ? ` ${customization.getRowHeaderClass(rowIdx)}` : ""}`}
									role="rowheader"
									style={{
										width: `${props.rowGutterWidth}px`,
										"min-width": `${props.rowGutterWidth}px`,
										height: `${props.rowHeight}px`,
									}}
									onMouseDown={(e) => props.onRowHeaderMouseDown?.(rowIdx, e)}
								>
									<Show when={customization?.getRowHeaderSublabel?.(rowIdx)}>
										{(sub) => <span class="se-row-header-sublabel">{sub()}</span>}
									</Show>
									{customization?.getRowHeaderLabel?.(rowIdx) ?? String(rowIdx + 1)}
								</div>
							</Show>
							<For each={props.columns}>
								{(col, colIdx) => {
									const addr = (): CellAddress => ({ row: rowIdx, col: colIdx() });
									const isSelected = () => selectionContains(props.selection, addr());
									const isAnchor = () => addressEquals(props.selection.anchor, addr());

									return (
										<GridCell
											displayValue={props.getDisplayValue(rowIdx, colIdx())}
											width={getColWidth(col)}
											height={props.rowHeight}
											selected={isAnchor()}
											rangeSelected={isSelected() && !isAnchor()}
											isFocus={isAnchor()}
											colIndex={colIdx()}
											readOnly={props.readOnly ?? false}
											pinnedLeft={props.pinnedLeftOffsets?.[colIdx()] ?? -1}
											isLastPinned={colIdx() === props.lastPinnedIndex}
											searchMatch={props.searchMatchSet.has(`${rowIdx},${colIdx()}`)}
											searchCurrent={addressMatchesCurrent(addr(), props.searchCurrentAddress)}
											{...(customization?.getCellClass ? { customClass: customization.getCellClass(rowIdx, colIdx()) } : {})}
											onMouseDown={(e) => props.onCellMouseDown(addr(), e)}
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
