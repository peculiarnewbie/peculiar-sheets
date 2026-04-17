import { createMemo, For, Show } from "solid-js";
import type { ColumnDef, SortState } from "../types";
import { GROUP_HEADER_HEIGHT, HEADER_HEIGHT } from "../types";
import { getEffectiveColumnWidth } from "../core/sizing";
import { columnIndexToLetters } from "../formula/references";

interface GridHeaderProps {
	columns: ColumnDef[];
	columnWidths: Map<string, number>;
	totalWidth: number;
	sortState: SortState | null;
	showReferenceHeaders: boolean;
	rowGutterWidth: number;
	pinnedLeftOffsets: number[];
	lastPinnedIndex: number;
	activeResizeColumnId: string | null;
	onColumnResizeStart: (columnId: string, event: MouseEvent) => void;
	onColumnHeaderMouseDown?: (col: number, event: MouseEvent) => void;
}

interface ColumnGroup {
	groupId: string;
	label: string;
	startIdx: number;
	span: number;
}

interface GroupHeaderItem {
	type: "group" | "empty";
	width: number;
	label?: string | undefined;
}

function buildColumnGroups(columns: ColumnDef[]): ColumnGroup[] {
	const groups: ColumnGroup[] = [];
	let currentGroupId: string | null = null;
	let currentGroup: ColumnGroup | null = null;

	for (let i = 0; i < columns.length; i++) {
		const col = columns[i]!;
		if (col.groupId && col.groupId === currentGroupId && currentGroup) {
			currentGroup.span++;
		} else if (col.groupId) {
			currentGroup = {
				groupId: col.groupId,
				label: col.group ?? col.groupId,
				startIdx: i,
				span: 1,
			};
			groups.push(currentGroup);
			currentGroupId = col.groupId;
		} else {
			currentGroupId = null;
			currentGroup = null;
		}
	}

	return groups;
}

export default function GridHeader(props: GridHeaderProps) {
	const groups = () => buildColumnGroups(props.columns);
	const hasGroups = () => groups().length > 0;

	function getColWidth(col: ColumnDef): number {
		return getEffectiveColumnWidth(col, props.columnWidths);
	}

	function getGroupWidth(group: ColumnGroup): number {
		let width = 0;
		for (let i = group.startIdx; i < group.startIdx + group.span; i++) {
			const col = props.columns[i];
			if (col) width += getColWidth(col);
		}
		return width;
	}

	const groupHeaderItems = createMemo<GroupHeaderItem[]>(() => {
		const items: GroupHeaderItem[] = [];
		const allGroups = groups();
		let colIdx = 0;

		while (colIdx < props.columns.length) {
			const group = allGroups.find((entry) => entry.startIdx === colIdx);
			if (group) {
				items.push({
					type: "group",
					width: getGroupWidth(group),
					label: group.label,
				});
				colIdx += group.span;
			} else {
				const col = props.columns[colIdx]!;
				items.push({
					type: "empty",
					width: getColWidth(col),
				});
				colIdx++;
			}
		}

		return items;
	});

	function getSortIndicator(col: ColumnDef): string {
		if (!props.sortState || props.sortState.columnId !== col.id) return "";
		return props.sortState.direction === "asc" ? " \u25B2" : " \u25BC";
	}

	return (
		<div
			class="se-header"
			role="rowgroup"
			style={{
				position: "sticky",
				top: "0",
				"z-index": "10",
				"min-width": `${props.totalWidth}px`,
			}}
		>
			<Show when={props.showReferenceHeaders}>
				<div
					class="se-header-row se-header-row--references"
					role="row"
					style={{ height: `${HEADER_HEIGHT}px`, display: "flex" }}
				>
					<div
						class="se-header-corner"
						role="columnheader"
						style={{
							width: `${props.rowGutterWidth}px`,
							"min-width": `${props.rowGutterWidth}px`,
							height: `${HEADER_HEIGHT}px`,
						}}
					/>
					<For each={props.columns}>
						{(col, index) => {
							const isPinned = () => (props.pinnedLeftOffsets?.[index()] ?? -1) >= 0;
							return (
								<div
									class="se-header-ref-cell"
									classList={{
										"se-header-ref-cell--pinned": isPinned(),
										"se-header-ref-cell--pinned-last": index() === props.lastPinnedIndex,
									}}
									role="columnheader"
									aria-colindex={index() + 1}
									style={{
										width: `${getColWidth(col)}px`,
										"min-width": `${getColWidth(col)}px`,
										height: `${HEADER_HEIGHT}px`,
										left: isPinned() ? `${props.pinnedLeftOffsets?.[index()] ?? 0}px` : undefined,
									}}
									data-col-index={index()}
									onMouseDown={(e) => props.onColumnHeaderMouseDown?.(index(), e)}
								>
									{columnIndexToLetters(index())}
								</div>
							);
						}}
					</For>
				</div>
			</Show>

			<Show when={hasGroups()}>
				<div
					class="se-header-row se-header-row--groups"
					style={{ height: `${GROUP_HEADER_HEIGHT}px`, display: "flex" }}
				>
					<Show when={props.showReferenceHeaders}>
						<div
							class="se-header-gutter-spacer"
							style={{
								width: `${props.rowGutterWidth}px`,
								"min-width": `${props.rowGutterWidth}px`,
								height: `${GROUP_HEADER_HEIGHT}px`,
							}}
						/>
					</Show>
					<For each={groupHeaderItems()}>
						{(item) => (
							<div
								class="se-header-group"
								classList={{ "se-header-group--empty": item.type === "empty" }}
								style={{
									width: `${item.width}px`,
									"min-width": `${item.width}px`,
									height: `${GROUP_HEADER_HEIGHT}px`,
								}}
							>
								<Show when={item.label}>
									<span class="se-header-group__label">{item.label}</span>
								</Show>
							</div>
						)}
					</For>
				</div>
			</Show>

			<div
				class="se-header-row se-header-row--columns"
				role="row"
				style={{ height: `${HEADER_HEIGHT}px`, display: "flex" }}
			>
				<Show when={props.showReferenceHeaders}>
					<div
						class="se-header-gutter-spacer"
						role="columnheader"
						style={{
							width: `${props.rowGutterWidth}px`,
							"min-width": `${props.rowGutterWidth}px`,
							height: `${HEADER_HEIGHT}px`,
						}}
					/>
				</Show>
				<For each={props.columns}>
					{(col, index) => {
						const isPinned = () => (props.pinnedLeftOffsets?.[index()] ?? -1) >= 0;
						const isSortable = col.sortable !== false;
						const isResizing = () => props.activeResizeColumnId === col.id;
						return (
							<div
								class="se-header-cell"
								classList={{
									"se-header-cell--sortable": isSortable,
									"se-header-cell--pinned": isPinned(),
									"se-header-cell--pinned-last": index() === props.lastPinnedIndex,
									"se-header-cell--resizing": isResizing(),
								}}
								role="columnheader"
								aria-colindex={index() + 1}
								aria-sort={
									props.sortState?.columnId === col.id
										? props.sortState.direction === "asc" ? "ascending" : "descending"
										: undefined
								}
								style={{
									width: `${getColWidth(col)}px`,
									"min-width": `${getColWidth(col)}px`,
									height: `${HEADER_HEIGHT}px`,
									left: isPinned() ? `${props.pinnedLeftOffsets?.[index()] ?? 0}px` : undefined,
									cursor: isSortable ? "pointer" : undefined,
								}}
								data-col-index={index()}
								onMouseDown={(e) => props.onColumnHeaderMouseDown?.(index(), e)}
							>
								<span class="se-header-cell__label">
									{col.header}{getSortIndicator(col)}
								</span>
								<Show when={col.resizable !== false}>
									<div
										class="se-resize-handle"
										classList={{ "se-resize-handle--active": isResizing() }}
										onMouseDown={(e) => props.onColumnResizeStart(col.id, e)}
									/>
								</Show>
							</div>
						);
					}}
				</For>
			</div>
		</div>
	);
}
