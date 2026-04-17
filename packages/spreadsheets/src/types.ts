import type { JSX } from "solid-js";
import type { WorkbookSheetBinding } from "./workbook/types";

// ── Cell Primitives ──────────────────────────────────────────────────────────

export type CellValue = string | number | boolean | null;

export interface CellAddress {
	row: number;
	col: number;
}

export interface CellRange {
	start: CellAddress;
	end: CellAddress;
}

// ── Selection ────────────────────────────────────────────────────────────────

export interface Selection {
	/** All selected ranges (supports multi-range via ctrl+click). */
	ranges: CellRange[];
	/** Where selection started. */
	anchor: CellAddress;
	/** Where selection ends (for shift-extend). */
	focus: CellAddress;
	/** Cell currently in edit mode, if any. */
	editing: CellAddress | null;
}

// ── Sorting ──────────────────────────────────────────────────────────────────

export type SortBehavior = "external" | "view" | "mutation";

export type SortDirection = "asc" | "desc";

export interface SortState {
	columnId: string;
	direction: SortDirection;
}

// ── Column Definitions ───────────────────────────────────────────────────────

/**
 * Base context passed to every column-level hook.
 * `row` is the physical (post-sort) row index; `col` is the column index.
 */
export interface CellContext {
	row: number;
	col: number;
}

/** Context for `ColumnDef.parseValue`. */
export interface ParseValueContext extends CellContext {
	/** The raw cell value immediately before this commit — read fresh from the store. */
	previousValue: CellValue;
}

/** Context for `ColumnDef.renderCell`. */
export interface CellRenderContext extends CellContext {
	/** Raw stored value (pre-format, pre-formula-eval for non-formula cells). */
	value: CellValue;
	/** Result of `formatValue` (or the default stringifier) — always available. */
	formattedText: string;
	/** True when this column / sheet is read-only. */
	readOnly: boolean;
	/**
	 * True while the CellEditor is overlaying this cell (z-index 20). Heavy
	 * renderers should return `null` or a cheap fallback here; the editor input
	 * obscures the cell content, so expensive work would be wasted.
	 */
	isEditing: boolean;
}

export interface ColumnDef {
	id: string;
	header: string;
	width?: number;
	minWidth?: number;
	maxWidth?: number;
	resizable?: boolean;
	editable?: boolean;
	pinned?: "left" | undefined;
	/** Visual group header label (displayed as a spanning row above grouped columns). */
	group?: string;
	/** Logical group ID — columns sharing this get a spanning header. */
	groupId?: string;
	/** App-specific metadata (e.g. mapped, sourceColumn, structField). */
	meta?: Record<string, unknown>;
	sortable?: boolean;
	sortAccessor?: (
		value: CellValue,
		modelRow: number,
		columnId: string,
	) => string | number | boolean | null;

	// ── Custom rendering / value transforms ──────────────────────────────────
	// All optional. See docs/custom-cells.md or README for end-to-end examples.

	/**
	 * Transform a raw CellValue into text for cell rendering AND editor seeding.
	 * Does NOT affect the formula bar, search matching, sort keys, or clipboard
	 * output — those continue to operate on raw/display values.
	 *
	 * Example: strip `NSLOCTEXT("area","id","Save")` down to `"Save"` for display.
	 */
	formatValue?: (value: CellValue, ctx: CellContext) => string;

	/**
	 * Commit-time parser for editor input. Receives the raw editor text plus the
	 * previous raw cell value, so structural metadata (e.g., an NSLOCTEXT
	 * wrapper) can be preserved across edits.
	 *
	 * Only runs on editor commit — NOT on paste, autofill, delete, or external
	 * writes. Those keep writing literal values.
	 *
	 * Should be idempotent: committing an unchanged formatted text should
	 * return a value `===`-equal to `ctx.previousValue` so the no-op
	 * short-circuit in `commitCellEdit` engages.
	 *
	 * **Required when `formatValue` is set** — without it, committing unchanged
	 * formatted text would overwrite the raw wrapper. A development-mode
	 * console warning fires if this invariant is violated.
	 */
	parseValue?: (text: string, ctx: ParseValueContext) => CellValue;

	/**
	 * Replace the inner `<span class="se-cell__text">` with custom JSX. The
	 * outer `<div class="se-cell">` — which owns selection, pinning, search
	 * highlight, aria, and mouse events — is always preserved, so custom
	 * content cannot break grid invariants.
	 *
	 * The returned JSX inherits the cell's CSS (flex centering, `overflow:
	 * hidden; white-space: nowrap; padding: 0 6px`). Override as needed.
	 *
	 * For expensive content, check `ctx.isEditing` and return `null` when the
	 * editor overlay is active.
	 */
	renderCell?: (ctx: CellRenderContext) => JSX.Element;

	/**
	 * Override the cell's `title` tooltip.
	 * - `undefined` → fall back to the formatted text (current default behaviour)
	 * - `""` → suppress the tooltip entirely
	 * - any other string → use it verbatim
	 */
	getCellTitle?: (value: CellValue, ctx: CellContext) => string | undefined;
}

// ── Events ───────────────────────────────────────────────────────────────────

export interface CellMutation {
	address: CellAddress;
	viewAddress?: CellAddress;
	rowId?: number;
	columnId: string;
	oldValue: CellValue;
	newValue: CellValue;
	source: "user" | "paste" | "delete" | "formula" | "external" | "fill";
}

export interface RowReorderMutation {
	columnId: string;
	direction: SortDirection | null;
	oldOrder: number[];
	newOrder: number[];
	indexOrder: number[];
	source: "sort" | "undo" | "redo";
}

export type FillAxis = "vertical";

export type AutoFillMode = "copy" | "linear-series" | "formula-copy";

export interface FillPreview {
	axis: FillAxis;
	source: CellRange;
	extension: CellRange;
	direction: "up" | "down";
}

export interface FillDragState {
	axis: FillAxis;
	source: CellRange;
	handle: "bottom-right";
	origin: CellAddress;
	current: CellAddress;
	preview: FillPreview | null;
}

export interface EditModeState {
	address: CellAddress;
	initialValue: CellValue;
}

export interface ClipboardPayload {
	action: "copy" | "cut" | "paste";
	range: CellRange;
	text: string;
	cells: CellValue[][];
}

export interface ScrollPosition {
	top: number;
	left: number;
	visibleRowRange: [number, number];
	visibleColRange: [number, number];
}

// ── Sizing ───────────────────────────────────────────────────────────────────

export interface SheetSizingState {
	columnWidths: Map<string, number>;
	rowHeights: Map<number, number>;
}

export type ResizeAxis = "column" | "row";

export type ResizeMode = "onEnd" | "onChange";

export interface ResizeSessionState {
	axis: ResizeAxis;
	targetId: string | number;
	startPointerOffset: number;
	startSize: number;
	currentDelta: number;
	previewSize: number;
	isActive: boolean;
}

// ── Sheet Customization ─────────────────────────────────────────────────────
// Provided via SolidJS context so inner components can consume directly
// without prop drilling through Sheet → Grid → GridBody → GridCell.

export interface SheetCustomization {
	/** Custom row header label. Return a string to override the default row number. */
	getRowHeaderLabel?: (rowIndex: number) => string;
	/** Optional sublabel shown smaller above the primary row header label. */
	getRowHeaderSublabel?: (rowIndex: number) => string | null;
	/** CSS class applied to the row header cell at the given row index. */
	getRowHeaderClass?: (rowIndex: number) => string;
	/** CSS class applied to each data cell at the given position. */
	getCellClass?: (row: number, col: number) => string;
	/** Override the address label shown in the formula bar (e.g., "A1"). */
	getAddressLabel?: (row: number, col: number) => string;
	/**
	 * Override the reference text inserted when clicking a cell during formula
	 * editing. Receives the editing cell address and the clicked cell address.
	 * Return `null` to use the default behavior (bare A1 reference).
	 */
	getReferenceText?: (editingAddress: CellAddress, clickedAddress: CellAddress) => string | null;
	/**
	 * Translate a formula string for display in the formula bar.
	 * Called when showing the formula of the selected cell.
	 * Use this to convert internal/composite references to user-friendly form.
	 */
	translateFormulaForDisplay?: (formula: string, cellRow: number, cellCol: number) => string;
}

// ── Component Props ──────────────────────────────────────────────────────────

export interface SheetProps {
	/** 2D array of cell values [row][col]. */
	data: CellValue[][];
	/** Column definitions in display order. */
	columns: ColumnDef[];
	/** Override row count (for rows beyond data). */
	rowCount?: number;
	/** Row height in px (default 28). */
	rowHeight?: number;
	/** Resize commit timing (`onEnd` by default). */
	resizeMode?: ResizeMode;
	/** When true, no cell editing is allowed. */
	readOnly?: boolean;
	/** Optional HyperFormula integration. */
	formulaEngine?: FormulaEngineConfig;
	/** Optional headless workbook binding for cross-sheet coordination. */
	workbook?: WorkbookSheetBinding;
	/** When true, renders a formula bar for the selected cell. */
	showFormulaBar?: boolean;
	/** When true, renders spreadsheet-style row/column reference headers. */
	showReferenceHeaders?: boolean;

	// Event callbacks
	onSelectionChange?: (selection: Selection) => void;
	onCellEdit?: (mutation: CellMutation) => void;
	onBatchEdit?: (mutations: CellMutation[]) => void;
	onEditModeChange?: (state: EditModeState | null) => void;
	onClipboard?: (payload: ClipboardPayload) => void;
	onScroll?: (position: ScrollPosition) => void;
	columnSizing?: Record<string, number>;
	onColumnSizingChange?: (next: Record<string, number>) => void;
	rowSizing?: Record<number, number>;
	onRowSizingChange?: (next: Record<number, number>) => void;
	onColumnResize?: (columnId: string, width: number) => void;
	onRowResize?: (rowId: number, height: number) => void;
	onSort?: (columnId: string, direction: SortDirection | null) => void;
	onSortChange?: (state: SortState | null) => void;
	/** Called when rows are inserted. The host should update its data array accordingly. */
	onRowInsert?: (atIndex: number, count: number) => void;
	/** Called when rows are deleted. The host should update its data array accordingly. */
	onRowDelete?: (atIndex: number, count: number) => void;
	onRowReorder?: (mutation: RowReorderMutation) => void;

	sortBehavior?: SortBehavior;
	sortState?: SortState | null;
	defaultSortState?: SortState | null;

	/**
	 * Visual and formula-display customization hooks.
	 * Delivered via context — inner grid components consume directly.
	 */
	customization?: SheetCustomization;

	/**
	 * Called before default mousedown handling in Grid.
	 * Return `true` to suppress default behavior (selection, edit commit, etc.).
	 */
	onCellPointerDown?: (address: CellAddress, event: MouseEvent) => boolean;

	/**
	 * Called during mousemove when the mouse is over a cell.
	 * Return `true` to suppress default behavior.
	 */
	onCellPointerMove?: (address: CellAddress, event: MouseEvent) => boolean;

	/** Imperative handle callback — receives the controller on mount. */
	ref?: (controller: SheetController) => void;

	class?: string;
}

// ── Imperative API ───────────────────────────────────────────────────────────

export interface SheetController {
	getSelection(): Selection;
	setSelection(ranges: CellRange[]): void;
	clearSelection(): void;
	scrollToCell(row: number, col: number): void;
	startEditing(row: number, col: number): void;
	stopEditing(commit?: boolean): void;
	getRawCellValue(row: number, col: number): CellValue;
	getDisplayCellValue(row: number, col: number): CellValue;
	getEditorText(): string | null;
	canInsertReference(): boolean;
	insertReferenceText(text: string): void;
	/**
	 * Set (or clear) a cross-sheet reference highlight on this sheet's grid.
	 * Used by composite views to highlight cells in a *different* sheet when the
	 * active editor references them (e.g., typing `=Scratch!A1` in the Data sheet
	 * highlights A1 in the Scratch sheet).
	 */
	setReferenceHighlight(range: CellRange | null): void;
	setActiveEditorValue(value: string): void;
	commitActiveEditor(): void;
	cancelActiveEditor(): void;
	/** Legacy alias for getRawCellValue. */
	getCellValue(row: number, col: number): CellValue;
	setCellValue(row: number, col: number, value: CellValue): void;
	/** Insert empty rows at the given index, shifting existing data down. */
	insertRows(atIndex: number, count: number): void;
	/** Delete rows at the given index, shifting existing data up. */
	deleteRows(atIndex: number, count: number): void;
	getColumnMeta(columnId: string): Record<string, unknown> | undefined;
	undo(): void;
	redo(): void;
	canUndo(): boolean;
	canRedo(): boolean;
	/** Returns the inner canvas element (`.se-canvas`) for overlay positioning. */
	getCanvasElement(): HTMLElement | null;
}

// ── Formula ──────────────────────────────────────────────────────────────────

export interface FormulaEngineConfig {
	/** HyperFormula instance (typed as unknown to avoid hard dependency). */
	instance: unknown;
	sheetId?: number;
	sheetName?: string;
}

// ── Internal Helpers ─────────────────────────────────────────────────────────

export const DEFAULT_ROW_HEIGHT = 28;
export const DEFAULT_COL_WIDTH = 120;
export const DEFAULT_MIN_COL_WIDTH = 50;
export const HEADER_HEIGHT = 32;
export const GROUP_HEADER_HEIGHT = 24;
