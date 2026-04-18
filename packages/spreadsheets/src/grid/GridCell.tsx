import { Show } from "solid-js";
import type { JSX } from "solid-js";
import type { CellRenderContext, CellStyle, CellValue } from "../types";

interface GridCellProps {
	/** Raw cell value (pre-format). Passed to renderCell / title hooks. */
	rawValue: CellValue;
	/** Text to render in the default inner span (already passed through formatValue or the default). */
	formattedText: string;
	/** Physical row index (post-sort). */
	row: number;
	width: number;
	height: number;
	colIndex: number;
	readOnly?: boolean;
	pinnedLeft?: number;
	isLastPinned?: boolean;
	searchMatch?: boolean;
	searchCurrent?: boolean;
	customClass?: string;
	/**
	 * Optional inline style for the cell container. Merged with the grid's own
	 * layout style — width/height/min-width/left always win to preserve layout.
	 */
	inlineStyle?: CellStyle;
	/**
	 * Optional title override.
	 * - `undefined` → default to `formattedText || undefined`
	 * - `""` → suppress title
	 * - any other string → use verbatim
	 */
	title?: string;
	/** Optional custom cell-content renderer. Replaces only the inner span. */
	renderCell?: (ctx: CellRenderContext) => JSX.Element;
	/** True while the CellEditor overlays this cell. */
	isEditing?: boolean;
	onMouseDown: (event: MouseEvent) => void;
	onMouseEnter?: (event: MouseEvent) => void;
	onDblClick: () => void;
}

function resolveTitle(title: string | undefined, formattedText: string): string | undefined {
	if (title === undefined) return formattedText || undefined;
	if (title === "") return undefined;
	return title;
}

export default function GridCell(props: GridCellProps) {
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
			title={resolveTitle(props.title, props.formattedText)}
			style={{
				// Host-provided styles first so the grid's layout overrides win.
				...(props.inlineStyle ?? {}),
				width: `${props.width}px`,
				height: `${props.height}px`,
				"min-width": `${props.width}px`,
				left: isPinned() ? `${props.pinnedLeft}px` : undefined,
			}}
			onMouseDown={props.onMouseDown}
			onMouseEnter={(event) => props.onMouseEnter?.(event)}
			onDblClick={props.onDblClick}
		>
			<Show
				when={props.renderCell}
				fallback={<span class="se-cell__text">{props.formattedText}</span>}
			>
				{props.renderCell!({
					value: props.rawValue,
					formattedText: props.formattedText,
					row: props.row,
					col: props.colIndex,
					readOnly: props.readOnly ?? false,
					isEditing: props.isEditing ?? false,
				})}
			</Show>
		</div>
	);
}
