import type { CellValue } from "../types";

interface GridCellProps {
	displayValue: CellValue;
	width: number;
	height: number;
	colIndex: number;
	readOnly?: boolean;
	pinnedLeft?: number;
	isLastPinned?: boolean;
	searchMatch?: boolean;
	searchCurrent?: boolean;
	customClass?: string;
	onMouseDown: (event: MouseEvent) => void;
	onDblClick: () => void;
}

function formatCellValue(value: CellValue): string {
	if (value === null || value === undefined) return "";
	if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
	return String(value);
}

export default function GridCell(props: GridCellProps) {
	const text = () => formatCellValue(props.displayValue);
	const isPinned = () => props.pinnedLeft != null && props.pinnedLeft >= 0;

	return (
		<div
			class={`se-cell${props.customClass ? ` ${props.customClass}` : ""}`}
			classList={{
				"se-cell--pinned": isPinned(),
				"se-cell--pinned-last": !!props.isLastPinned,
				"se-cell--search-match": !!props.searchMatch,
				"se-cell--search-current": !!props.searchCurrent,
			}}
			role="gridcell"
			aria-colindex={props.colIndex + 1}
			aria-readonly={props.readOnly || undefined}
			title={text() || undefined}
			style={{
				width: `${props.width}px`,
				height: `${props.height}px`,
				"min-width": `${props.width}px`,
				left: isPinned() ? `${props.pinnedLeft}px` : undefined,
			}}
			onMouseDown={props.onMouseDown}
			onDblClick={props.onDblClick}
		>
			<span class="se-cell__text">{text()}</span>
		</div>
	);
}
