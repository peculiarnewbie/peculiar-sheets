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

// ── Column Definitions ───────────────────────────────────────────────────────

export interface ColumnDef {
	id: string;
	header: string;
	width?: number;
	minWidth?: number;
	resizable?: boolean;
	editable?: boolean;
	pinned?: "left" | undefined;
	/** Visual group header label (displayed as a spanning row above grouped columns). */
	group?: string;
	/** Logical group ID — columns sharing this get a spanning header. */
	groupId?: string;
	/** App-specific metadata (e.g. mapped, sourceColumn, structField). */
	meta?: Record<string, unknown>;
}

// ── Events ───────────────────────────────────────────────────────────────────

export interface CellMutation {
	address: CellAddress;
	columnId: string;
	oldValue: CellValue;
	newValue: CellValue;
	source: "user" | "paste" | "delete" | "formula" | "external" | "fill";
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
	/** When true, no cell editing is allowed. */
	readOnly?: boolean;
	/** Optional HyperFormula integration. */
	formulaEngine?: FormulaEngineConfig;
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
	onColumnResize?: (columnId: string, width: number) => void;
	onSort?: (columnId: string, direction: "asc" | "desc") => void;

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
	setActiveEditorValue(value: string): void;
	commitActiveEditor(): void;
	cancelActiveEditor(): void;
	/** Legacy alias for getRawCellValue. */
	getCellValue(row: number, col: number): CellValue;
	setCellValue(row: number, col: number, value: CellValue): void;
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
