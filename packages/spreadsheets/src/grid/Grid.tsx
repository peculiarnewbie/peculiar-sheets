import { createEffect, createMemo, createSignal, on, onCleanup, onMount, Show, untrack } from "solid-js";
import { createVirtualizer } from "@tanstack/solid-virtual";
import type {
	CellAddress,
	CellMutation,
	CellRange,
	CellValue,
	ColumnDef,
	ResizeMode,
	ResizeSessionState,
	RowReorderMutation,
	Selection,
	SheetController,
	SheetProps,
	SortBehavior,
	SortDirection,
	SortState,
} from "../types";
import { DEFAULT_COL_WIDTH, GROUP_HEADER_HEIGHT, HEADER_HEIGHT } from "../types";
import { useSheetCustomization } from "../customization";
import type { SheetStore } from "../core/state";
import { clampColumnWidth, getColumnWidth, getEffectiveColumnWidth, mapToRecord, recordToMap } from "../core/sizing";
import {
	emptySelection,
	extendSelection,
	moveSelection,
	normalizeRange,
	primaryRange,
	selectAll,
	selectCell,
	selectionContains,
} from "../core/selection";
import {
	computeFillPreview,
	getAutoFillSourceRange,
	resolveAutoFillMode,
} from "../core/autofill";
import { mapKeyToCommand, shouldPreventDefault } from "../core/keys";
import { parseTSV } from "../core/clipboard";
import { applyMutations } from "../core/commands";
import type { FormulaBridge } from "../formula/bridge";
import { addressToA1, isFormulaText, isFormulaValue, rangeToA1, shiftFormulaByDelta } from "../formula/references";
import { Result, isApplied, type OperationOutcome, type ResultLike } from "../internal/result";
import GridHeader from "./GridHeader";
import GridBody from "./GridBody";
import CellEditor from "./CellEditor";
import FormulaBar from "./FormulaBar";
import SelectionOverlay from "./SelectionOverlay";
import ContextMenu, { type ContextMenuEntry } from "./ContextMenu";
import SearchBar from "./SearchBar";
import { createMatchSet, findMatchesChunked } from "../core/search";
import { buildRowMetrics } from "./rowMetrics";
import type { WorkbookSheetBinding } from "../workbook/types";

const ROW_GUTTER_WIDTH = 48;

interface GridProps {
	store: SheetStore;
	columns: ColumnDef[];
	rowHeight: number;
	readOnly: boolean;
	formulaBridge?: FormulaBridge | null;
	workbook?: WorkbookSheetBinding | undefined;
	showFormulaBar: boolean;
	showReferenceHeaders: boolean;
	onSelectionChange?: SheetProps["onSelectionChange"] | undefined;
	onCellEdit?: SheetProps["onCellEdit"] | undefined;
	onBatchEdit?: SheetProps["onBatchEdit"] | undefined;
	onEditModeChange?: SheetProps["onEditModeChange"] | undefined;
	onClipboard?: SheetProps["onClipboard"] | undefined;
	resizeMode: ResizeMode;
	columnSizing?: Record<string, number> | undefined;
	onColumnSizingChange?: ((next: Record<string, number>) => void) | undefined;
	rowSizing?: Record<number, number> | undefined;
	onRowSizingChange?: ((next: Record<number, number>) => void) | undefined;
	onColumnResize?: SheetProps["onColumnResize"] | undefined;
	onRowResize?: SheetProps["onRowResize"] | undefined;
	onSort?: SheetProps["onSort"] | undefined;
	onSortChange?: SheetProps["onSortChange"] | undefined;
	onRowInsert?: SheetProps["onRowInsert"] | undefined;
	onRowDelete?: SheetProps["onRowDelete"] | undefined;
	onRowReorder?: SheetProps["onRowReorder"] | undefined;
	onCellPointerDown?: SheetProps["onCellPointerDown"] | undefined;
	onCellPointerMove?: SheetProps["onCellPointerMove"] | undefined;
	controllerRef?: SheetProps["ref"] | undefined;
	sortBehavior: SortBehavior;
	sortState?: SortState | null | undefined;
	defaultSortState: SortState | null;
}

interface CaretRange {
	start: number;
	end: number;
}

function cellValueToEditorText(value: CellValue): string {
	if (value === null) return "";
	return String(value);
}

/**
 * Development-only warning: when a column sets `formatValue` but not
 * `parseValue`, the editor will seed with formatted text (e.g. `"Save"`) and
 * the commit path will coerce that text via default type inference —
 * overwriting any structural wrapper stored in the raw cell value (e.g.
 * `NSLOCTEXT(...)`). Warn once per column to catch this at dev time.
 */
const formatValueWarned = new WeakSet<ColumnDef>();
function isProductionEnv(): boolean {
	const proc = (globalThis as { process?: { env?: { NODE_ENV?: string } } })
		.process;
	return proc?.env?.NODE_ENV === "production";
}
function warnIfFormatValueWithoutParseValue(col: ColumnDef | undefined): void {
	if (!col || !col.formatValue || col.parseValue) return;
	if (formatValueWarned.has(col)) return;
	formatValueWarned.add(col);
	if (isProductionEnv()) return;
	// eslint-disable-next-line no-console
	console.warn(
		`[spreadsheets] Column "${col.id}" sets \`formatValue\` without \`parseValue\`. ` +
			`Committing unchanged formatted text will overwrite the raw value. ` +
			`Add a matching \`parseValue\` hook to preserve structural metadata.`,
	);
}

function normalizeFormulaText(text: string): string {
	const trimmed = text.trim();
	if (!trimmed.startsWith("=")) return trimmed;

	let rest = trimmed.slice(1);
	while (rest.startsWith("=")) {
		rest = rest.slice(1);
	}

	return `=${rest}`;
}

function parseEditValue(original: CellValue, text: string): CellValue {
	const trimmed = text.trim();
	if (trimmed === "") return null;

	if (isFormulaText(trimmed)) return normalizeFormulaText(trimmed);

	if (typeof original === "number" || original === null) {
		const num = Number(trimmed);
		if (!Number.isNaN(num)) return num;
	}

	if (typeof original === "boolean") {
		if (trimmed.toLowerCase() === "true") return true;
		if (trimmed.toLowerCase() === "false") return false;
	}

	const num = Number(trimmed);
	if (!Number.isNaN(num)) return num;

	return text;
}

function canInsertReferenceAtCaret(
	text: string,
	caret: CaretRange,
): boolean {
	if (!isFormulaText(text)) return false;
	if (caret.start !== caret.end) return false;

	const position = caret.start;
	if (position < 1 || position > text.length) return false;

	let index = position - 1;
	while (index >= 0 && text[index] === " ") {
		index -= 1;
	}

	if (index < 0) return false;

	const previous = text[index];
	if (!previous) return false;

	return "=+-*/^(,:&<>".includes(previous);
}

const SORT_COLLATOR = new Intl.Collator(undefined, {
	numeric: true,
	sensitivity: "base",
});

function buildIndexOrder(oldOrder: number[], newOrder: number[]): number[] {
	const nextIndexByRowId = new Map<number, number>();
	for (let i = 0; i < newOrder.length; i++) {
		nextIndexByRowId.set(newOrder[i]!, i);
	}

	return oldOrder.map((rowId) => nextIndexByRowId.get(rowId) ?? -1);
}

function isBlankSortValue(value: string | number | boolean | null): boolean {
	return value === null || value === "";
}

function getSortTypeOrder(value: string | number | boolean | null): number {
	if (typeof value === "number") return 0;
	if (typeof value === "string") return 1;
	if (typeof value === "boolean") return 2;
	return 3;
}

function compareSortValues(
	left: string | number | boolean | null,
	right: string | number | boolean | null,
): number {
	if (typeof left === "number" && typeof right === "number") {
		return left - right;
	}

	if (typeof left === "string" && typeof right === "string") {
		return SORT_COLLATOR.compare(left, right);
	}

	if (typeof left === "boolean" && typeof right === "boolean") {
		if (left === right) return 0;
		return left ? 1 : -1;
	}

	return getSortTypeOrder(left) - getSortTypeOrder(right);
}

function compareSortableEntries(
	left: string | number | boolean | null,
	right: string | number | boolean | null,
	direction: SortDirection,
): number {
	const leftBlank = isBlankSortValue(left);
	const rightBlank = isBlankSortValue(right);

	if (leftBlank && rightBlank) return 0;
	if (leftBlank) return 1;
	if (rightBlank) return -1;

	const comparison = compareSortValues(left, right);
	return direction === "asc" ? comparison : -comparison;
}

type ContextMenuState =
	| { x: number; y: number; kind: "grid" }
	| { x: number; y: number; kind: "column-header"; col: number };

export default function Grid(props: GridProps) {
	const customization = useSheetCustomization();
	const workbookCoordinator = () => props.workbook?.coordinator ?? null;
	const workbookSheetKey = () => props.workbook?.sheetKey ?? null;

	let gridRef: HTMLDivElement | undefined;
	let viewportRef: HTMLDivElement | undefined;
	let cellEditorInputRef: HTMLInputElement | undefined;
	let formulaBarInputRef: HTMLInputElement | undefined;
	let dragViewportRect: DOMRect | null = null;
	let pendingMouseMoveEvent: MouseEvent | null = null;
	let mouseMoveFrame: number | null = null;

	const [isDraggingSelection, setIsDraggingSelection] = createSignal(false);
	const [internalSortState, setInternalSortState] = createSignal<SortState | null>(
		props.defaultSortState,
	);
	const [mutationSortBaseOrder, setMutationSortBaseOrder] = createSignal<number[] | null>(null);
	const [contextMenu, setContextMenu] = createSignal<ContextMenuState | null>(null);
	const [clipboardRange, setClipboardRange] = createSignal<CellRange | null>(null);
	const [editorText, setEditorText] = createSignal("");
	const [editorSource, setEditorSource] = createSignal<"cell" | "formula-bar">("cell");
	const [editorCaret, setEditorCaret] = createSignal<CaretRange>({ start: 0, end: 0 });
	const [pendingCaret, setPendingCaret] = createSignal<CaretRange | null>(null);
	const [referenceRange, setReferenceRange] = createSignal<CellRange | null>(null);
	const [referenceInsertion, setReferenceInsertion] = createSignal<CaretRange | null>(null);
	const [isReferenceDragging, setIsReferenceDragging] = createSignal(false);
	const [referenceDragAnchor, setReferenceDragAnchor] = createSignal<CellAddress | null>(null);
	const [externalReferenceRange, setExternalReferenceRange] = createSignal<CellRange | null>(null);
	const [fillDragState, setFillDragState] = createSignal<{
		source: CellRange;
		preview: ReturnType<typeof computeFillPreview>;
	} | null>(null);
	const [searchOpen, setSearchOpen] = createSignal(false);
	const [searchQuery, setSearchQuery] = createSignal("");
	const [searchCurrentIndex, setSearchCurrentIndex] = createSignal(-1);
	const [resizeSession, setResizeSession] = createSignal<ResizeSessionState | null>(null);

	const hasFormulaEngine = () => Boolean(props.formulaBridge);
	const rowGutterWidth = () => props.showReferenceHeaders ? ROW_GUTTER_WIDTH : 0;
	const currentSortState = createMemo(() =>
		props.sortState !== undefined ? props.sortState ?? null : internalSortState(),
	);
	const isViewSortActive = createMemo(() =>
		props.sortBehavior === "view" && currentSortState() !== null,
	);

	const committedColumnWidths = createMemo(() =>
		props.columnSizing
			? recordToMap<string>(props.columnSizing)
			: props.store.columnWidths(),
	);
	const committedRowHeights = createMemo(() =>
		props.rowSizing
			? recordToMap<number>(props.rowSizing, (key) => Number(key))
			: props.store.rowHeights(),
	);
	const columnSizingRecord = createMemo(() =>
		props.columnSizing ?? mapToRecord(props.store.columnWidths()),
	);
	const rowSizingRecord = createMemo(() =>
		props.rowSizing ?? mapToRecord(props.store.rowHeights()),
	);

	const columnWidths = createMemo(() =>
		props.columns.map((col) => getEffectiveColumnWidth(col, committedColumnWidths())),
	);
	const columnLeftOffsets = createMemo(() => {
		const offsets: number[] = [];
		let left = rowGutterWidth();
		for (let index = 0; index < props.columns.length; index++) {
			offsets.push(left);
			left += columnWidths()[index] ?? DEFAULT_COL_WIDTH;
		}
		return offsets;
	});
	const columnRightOffsets = createMemo(() => {
		const offsets: number[] = [];
		let right = 0;
		for (let index = 0; index < props.columns.length; index++) {
			right += columnWidths()[index] ?? DEFAULT_COL_WIDTH;
			offsets.push(right);
		}
		return offsets;
	});
	const columnBoundaryOffsets = createMemo(() => [0, ...columnRightOffsets()]);

	const pinnedLeftOffsets = createMemo(() => {
		const offsets: number[] = [];
		let left = rowGutterWidth();
		for (let i = 0; i < props.columns.length; i++) {
			if (props.columns[i]!.pinned === "left") {
				offsets.push(left);
				left += columnWidths()[i] ?? DEFAULT_COL_WIDTH;
			} else {
				offsets.push(-1);
			}
		}
		return offsets;
	});

	const lastPinnedIndex = createMemo(() => {
		for (let i = props.columns.length - 1; i >= 0; i--) {
			if (props.columns[i]!.pinned === "left") return i;
		}
		return -1;
	});

	const visualRowIds = createMemo<number[] | null>(() => {
		if (!isViewSortActive()) return null;

		const sort = currentSortState();
		if (!sort) return null;

		const columnIndex = props.columns.findIndex((column) => column.id === sort.columnId);
		if (columnIndex < 0) return null;

		const currentRowIds = props.store.rowIds();
		const nextOrder = currentRowIds.map((rowId, physicalRow) => ({
			rowId,
			physicalRow,
			value: getSortComparableValue(physicalRow, columnIndex),
		}));

		nextOrder.sort((left, right) => {
			const comparison = compareSortableEntries(left.value, right.value, sort.direction);
			if (comparison !== 0) {
				return comparison;
			}
			return left.physicalRow - right.physicalRow;
		});

		return nextOrder.map((entry) => entry.rowId);
	});

	const rowMetrics = createMemo(() =>
		buildRowMetrics(
			props.store.rowCount(),
			props.rowHeight,
			(visualRow) => {
				const rowId = getRowIdAtVisualRow(visualRow);
				if (rowId === null) return undefined;
				return committedRowHeights().get(rowId);
			},
		),
	);

	const rowVirtualizer = createVirtualizer({
		get count() {
			return props.store.rowCount();
		},
		getScrollElement: () => viewportRef ?? null,
		estimateSize: (index) => rowMetrics().getRowHeight(index),
		overscan: 3,
	});

	createEffect(
		on(rowMetrics, () => {
			rowVirtualizer.measure();
		}),
	);

	const virtualRows = createMemo(() =>
		rowVirtualizer.getVirtualItems().map((item) => ({
			index: item.index,
			start: item.start,
			size: item.size,
		})),
	);

	const totalWidth = createMemo(() =>
		columnWidths().reduce((sum, width) => sum + width, 0) + rowGutterWidth(),
	);

	const hasGroups = createMemo(() =>
		props.columns.some((column) => column.groupId),
	);

	const headerTotalHeight = createMemo(() => {
		let height = HEADER_HEIGHT;
		if (props.showReferenceHeaders) height += HEADER_HEIGHT;
		if (hasGroups()) height += GROUP_HEADER_HEIGHT;
		return height;
	});

	function getPhysicalRowForVisualRow(visualRow: number): number {
		if (!isViewSortActive()) return visualRow;
		const rowId = visualRowIds()?.[visualRow];
		if (rowId === undefined) return visualRow;
		return props.store.getPhysicalRowForRowId(rowId) ?? visualRow;
	}

	function getRowIdAtVisualRow(visualRow: number): number | null {
		if (!isViewSortActive()) return props.store.getRowIdAtPhysicalRow(visualRow);
		return visualRowIds()?.[visualRow] ?? null;
	}

	function getVisualRowForRowId(rowId: number): number | null {
		const activeVisualRowIds = visualRowIds();
		if (!activeVisualRowIds) {
			return props.store.getPhysicalRowForRowId(rowId);
		}

		const visualIndex = activeVisualRowIds.indexOf(rowId);
		return visualIndex >= 0 ? visualIndex : null;
	}

	function getCommittedColumnWidth(columnId: string): number {
		return getColumnWidth(columnId, props.columns, committedColumnWidths());
	}

	function getCommittedRowHeight(rowId: number): number {
		return committedRowHeights().get(rowId) ?? props.rowHeight;
	}

	function updateCommittedColumnWidth(columnId: string, width: number) {
		if (props.columnSizing === undefined) {
			props.store.setColumnWidth(columnId, width);
		}
		props.onColumnSizingChange?.({
			...columnSizingRecord(),
			[columnId]: width,
		});
	}

	function updateCommittedRowHeight(rowId: number, height: number) {
		if (props.rowSizing === undefined) {
			props.store.setRowHeight(rowId, height);
		}
		props.onRowSizingChange?.({
			...rowSizingRecord(),
			[rowId]: height,
		});
	}

	function commitColumnResize(columnId: string, width: number) {
		updateCommittedColumnWidth(columnId, width);
		props.onColumnResize?.(columnId, width);
	}

	function commitRowResize(rowId: number, height: number) {
		updateCommittedRowHeight(rowId, height);
		props.onRowResize?.(rowId, height);
	}

	function notifyColumnResizeState(columnId: string, width: number) {
		props.onColumnSizingChange?.(mapToRecord(props.store.columnWidths()));
		props.onColumnResize?.(columnId, width);
	}

	function notifyRowResizeState(rowId: number, height: number) {
		props.onRowSizingChange?.(mapToRecord(props.store.rowHeights()));
		props.onRowResize?.(rowId, height);
	}

	function mapModelToVisualAddress(address: CellAddress): CellAddress | null {
		const rowId = props.store.getRowIdAtPhysicalRow(address.row);
		if (rowId === null) return null;
		const visualRow = getVisualRowForRowId(rowId);
		if (visualRow === null) return null;
		return { row: visualRow, col: address.col };
	}

	function getSortComparableValue(physicalRow: number, col: number): string | number | boolean | null {
		const column = props.columns[col];
		if (!column) return null;

		const baseValue = hasFormulaEngine()
			? getDisplayCellValueForPhysicalRow(physicalRow, col)
			: getRawCellValueForPhysicalRow(physicalRow, col);

		const accessed = column.sortAccessor
			? column.sortAccessor(baseValue, physicalRow, column.id)
			: baseValue;

		return accessed === undefined ? null : accessed;
	}

	// ── Search ────────────────────────────────────────────────────────────

	const [debouncedSearchQuery, setDebouncedSearchQuery] = createSignal("");
	const [searchMatches, setSearchMatches] = createSignal<CellAddress[]>([]);

	createEffect(
		on(searchQuery, (query) => {
			const timeout = setTimeout(() => setDebouncedSearchQuery(query), 180);
			onCleanup(() => clearTimeout(timeout));
		}),
	);

	createEffect(
		on(
			[
				debouncedSearchQuery,
				() => props.store.rowCount(),
				() => props.store.colCount(),
				() => props.store.dataRevision(),
				() => props.formulaBridge?.revision() ?? 0,
			],
			([query, rowCount, colCount]) => {
				let cancelled = false;
				if (!query) {
					setSearchMatches([]);
					return;
				}

				void findMatchesChunked(
					getDisplayCellValue,
					rowCount,
					colCount,
					query,
					{ isCancelled: () => cancelled },
				).then((matches) => {
					if (!cancelled) setSearchMatches(matches);
				});

				onCleanup(() => {
					cancelled = true;
				});
			},
		),
	);

	const searchMatchSet = createMemo(() => createMatchSet(searchMatches()));

	const searchCurrentAddress = createMemo(() => {
		const matches = searchMatches();
		const idx = searchCurrentIndex();
		if (idx < 0 || idx >= matches.length) return null;
		return matches[idx]!;
	});

	createEffect(
		on(searchMatches, (matches) => {
			if (matches.length > 0) {
				setSearchCurrentIndex(0);
			} else {
				setSearchCurrentIndex(-1);
			}
		}),
	);

	createEffect(
		on(searchCurrentAddress, (addr) => {
			if (!addr || !viewportRef) return;
			const top = rowMetrics().getRowTop(addr.row);
			let left = 0;
			for (let c = 0; c < addr.col; c++) {
				left += untrack(columnWidths)[c] ?? DEFAULT_COL_WIDTH;
			}
			viewportRef.scrollTo({ top, left });
		}),
	);

	function scrollCellIntoView(addr: CellAddress) {
		const viewport = viewportRef;
		if (!viewport) return;

		const widths = untrack(columnWidths);
		const { row, col } = addr;

		// Cell bounds within the scrollable canvas. Use rowMetrics so variable
		// row heights (resized rows above `row`) are accounted for — otherwise
		// the bottom edge is underestimated and the cell lands just off the
		// viewport after arrow-down navigation.
		const metrics = rowMetrics();
		const cellTop = metrics.getRowTop(row);
		const cellBottom = cellTop + metrics.getRowHeight(row);

		let cellLeft = rowGutterWidth();
		for (let c = 0; c < col; c++) {
			cellLeft += widths[c] ?? DEFAULT_COL_WIDTH;
		}
		const cellRight = cellLeft + (widths[col] ?? DEFAULT_COL_WIDTH);

		// Space covered by sticky overlays (header on top, gutter + pinned cols on left).
		const stickyTop = headerTotalHeight();
		let stickyLeft = rowGutterWidth();
		for (let c = 0; c < props.columns.length; c++) {
			if (props.columns[c]?.pinned === "left") {
				stickyLeft += widths[c] ?? DEFAULT_COL_WIDTH;
			}
		}

		// Pinned cells are always visible; only scroll vertically for them.
		const isColPinned = props.columns[col]?.pinned === "left";

		const scrollTop = viewport.scrollTop;
		const scrollLeft = viewport.scrollLeft;
		const viewHeight = viewport.clientHeight;
		const viewWidth = viewport.clientWidth;

		let nextTop = scrollTop;
		let nextLeft = scrollLeft;

		if (cellTop < scrollTop + stickyTop) {
			nextTop = cellTop - stickyTop;
		} else if (cellBottom > scrollTop + viewHeight) {
			nextTop = cellBottom - viewHeight;
		}

		if (!isColPinned) {
			if (cellLeft < scrollLeft + stickyLeft) {
				nextLeft = cellLeft - stickyLeft;
			} else if (cellRight > scrollLeft + viewWidth) {
				nextLeft = cellRight - viewWidth;
			}
		}

		nextTop = Math.max(0, nextTop);
		nextLeft = Math.max(0, nextLeft);

		if (nextTop !== scrollTop || nextLeft !== scrollLeft) {
			viewport.scrollTo({ top: nextTop, left: nextLeft });
		}
	}

	// Keep the focused cell in view when selection moves (arrows, tab, shift+arrow, etc.).
	createEffect(
		on(
			() => props.store.selection().focus,
			(addr) => scrollCellIntoView(addr),
			{ defer: true },
		),
	);

	const editCellRect = createMemo(() => {
		const editMode = props.store.editMode();
		if (!editMode || editorSource() !== "cell") return null;

		return {
			left: columnLeftOffsets()[editMode.address.col] ?? rowGutterWidth(),
			top: rowMetrics().getRowTop(editMode.address.row),
			width: columnWidths()[editMode.address.col] ?? DEFAULT_COL_WIDTH,
			height: rowMetrics().getRowHeight(editMode.address.row),
		};
	});
	const activeResizeColumnId = createMemo(() => {
		const session = resizeSession();
		return session?.axis === "column" ? String(session.targetId) : null;
	});
	const activeResizeRow = createMemo(() => {
		const session = resizeSession();
		if (session?.axis !== "row") return null;
		return getVisualRowForRowId(Number(session.targetId));
	});
	const columnResizeGuideLeft = createMemo(() => {
		const session = resizeSession();
		if (session?.axis !== "column") return null;
		const columnIndex = props.columns.findIndex((column) => column.id === session.targetId);
		if (columnIndex < 0) return null;
		const left = columnLeftOffsets()[columnIndex] ?? rowGutterWidth();
		return left + session.previewSize;
	});
	const rowResizeGuideTop = createMemo(() => {
		const session = resizeSession();
		if (session?.axis !== "row") return null;
		const visualRow = getVisualRowForRowId(Number(session.targetId));
		if (visualRow === null) return null;
		return rowMetrics().getRowTop(visualRow) + session.previewSize;
	});

	const selectedAddress = createMemo(() => props.store.selection().anchor);
	const selectedPhysicalAddress = createMemo(() => {
		const addr = selectedAddress();
		return {
			row: getPhysicalRowForVisualRow(addr.row),
			col: addr.col,
		};
	});

	const selectedRawValue = createMemo(() => {
		const addr = selectedAddress();
		return getRawCellValue(addr.row, addr.col);
	});

	const formulaBarValue = createMemo(() => {
		const editMode = props.store.editMode();
		if (editMode) return editorText();
		const raw = cellValueToEditorText(selectedRawValue());
		if (customization?.translateFormulaForDisplay && typeof raw === "string" && raw.startsWith("=")) {
			const addr = selectedPhysicalAddress();
			return customization.translateFormulaForDisplay(raw, addr.row, addr.col);
		}
		return raw;
	});

	const formulaBarAddress = createMemo(() => {
		const addr = selectedAddress();
		return customization?.getAddressLabel?.(addr.row, addr.col) ?? addressToA1(addr);
	});
	const isReferenceSelectionMode = createMemo(() =>
		hasFormulaEngine() &&
		Boolean(props.store.editMode()) &&
		canInsertReferenceAtCaret(editorText(), editorCaret()),
	);

	const activeInput = () =>
		editorSource() === "formula-bar" ? formulaBarInputRef : cellEditorInputRef;
	const autoFillSourceRange = createMemo(() =>
		getAutoFillSourceRange(props.store.selection()),
	);
	const showFillHandle = createMemo(() =>
		!props.readOnly &&
		!props.store.editMode() &&
		autoFillSourceRange() !== null,
	);

	createEffect(() => {
		const next = pendingCaret();
		const input = activeInput();
		if (!next || !input) return;

		queueMicrotask(() => {
			if (pendingCaret() !== next) return;
			const active = activeInput();
			if (!active) return;

			active.focus();
			active.setSelectionRange(next.start, next.end);
			setEditorCaret(next);
			setPendingCaret(null);
		});
	});

	createEffect(
		on(
			() => props.store.selection(),
			(selection) => {
				props.onSelectionChange?.(selection);
				if (!props.store.editMode()) {
					setReferenceRange(null);
					setReferenceInsertion(null);
				}
			},
		),
	);

	createEffect(
		on(
			() => props.store.editMode(),
			(mode) => {
				props.onEditModeChange?.(mode);
				if (!mode) {
					setEditorText("");
					setReferenceInsertion(null);
					setReferenceRange(null);
					setExternalReferenceRange(null);
					setPendingCaret(null);
				}
			},
		),
	);

	function remapAddressForRowOrder(
		address: CellAddress,
		oldOrder: number[],
		newOrder: number[],
	): CellAddress | null {
		const rowId = oldOrder[address.row];
		if (rowId === undefined) return null;
		const nextRow = newOrder.indexOf(rowId);
		if (nextRow < 0) return null;
		return { row: nextRow, col: address.col };
	}

	function remapSelectionForRowOrder(
		selection: Selection,
		oldOrder: number[],
		newOrder: number[],
	): Selection | null {
		const nextRanges = selection.ranges
			.map((range) => {
				const start = remapAddressForRowOrder(range.start, oldOrder, newOrder);
				const end = remapAddressForRowOrder(range.end, oldOrder, newOrder);
				if (!start || !end) return null;
				return { start, end };
			})
			.filter((range): range is CellRange => range !== null);
		const nextAnchor = remapAddressForRowOrder(selection.anchor, oldOrder, newOrder);
		const nextFocus = remapAddressForRowOrder(selection.focus, oldOrder, newOrder);

		if (nextRanges.length !== selection.ranges.length || !nextAnchor || !nextFocus) {
			return null;
		}

		return {
			ranges: nextRanges,
			anchor: nextAnchor,
			focus: nextFocus,
			editing: selection.editing
				? remapAddressForRowOrder(selection.editing, oldOrder, newOrder)
				: null,
		};
	}

	function remapEditModeForRowOrder(
		mode: ReturnType<SheetStore["editMode"]>,
		oldOrder: number[],
		newOrder: number[],
	): ReturnType<SheetStore["editMode"]> {
		if (!mode) return mode;
		const nextAddress = remapAddressForRowOrder(mode.address, oldOrder, newOrder);
		if (!nextAddress) return null;
		return {
			...mode,
			address: nextAddress,
		};
	}

	let previousRenderedRowOrder: number[] | null = null;

	createEffect(() => {
		const nextRenderedOrder = [...(visualRowIds() ?? props.store.rowIds())];

		if (
			previousRenderedRowOrder &&
			(previousRenderedRowOrder.length !== nextRenderedOrder.length ||
				previousRenderedRowOrder.some((rowId, index) => rowId !== nextRenderedOrder[index]))
		) {
			const remappedSelection = remapSelectionForRowOrder(
				untrack(() => props.store.selection()),
				previousRenderedRowOrder,
				nextRenderedOrder,
			);
			if (remappedSelection) {
				props.store.setSelection(remappedSelection);
			}

			const currentEditMode = untrack(() => props.store.editMode());
			const remappedEditMode = remapEditModeForRowOrder(
				currentEditMode,
				previousRenderedRowOrder,
				nextRenderedOrder,
			);
			if (
				currentEditMode &&
				(!remappedEditMode ||
					remappedEditMode.address.row !== currentEditMode.address.row ||
					remappedEditMode.address.col !== currentEditMode.address.col)
			) {
				props.store.setEditMode(remappedEditMode);
			}
		}

		previousRenderedRowOrder = nextRenderedOrder;
	});

	function getRawCellValueForPhysicalRow(row: number, col: number): CellValue {
		return props.store.cells[row]?.[col] ?? null;
	}

	function getDisplayCellValueForPhysicalRow(row: number, col: number): CellValue {
		const rawValue = getRawCellValueForPhysicalRow(row, col);
		if (props.formulaBridge && typeof props.formulaBridge.revision === "function") {
			props.formulaBridge.revision();
		}
		return props.formulaBridge?.getDisplayValue(row, col, rawValue) ?? rawValue;
	}

	function getRawCellValue(row: number, col: number): CellValue {
		return getRawCellValueForPhysicalRow(getPhysicalRowForVisualRow(row), col);
	}

	function getDisplayCellValue(row: number, col: number): CellValue {
		return getDisplayCellValueForPhysicalRow(getPhysicalRowForVisualRow(row), col);
	}

	function didApplyFormulaBridgeOperation(
		result:
			| ReturnType<FormulaBridge["ensureSheet"]>
			| ReturnType<FormulaBridge["syncAll"]>
			| ReturnType<FormulaBridge["setCell"]>
			| ReturnType<FormulaBridge["setRowOrder"]>
			| null
			| undefined,
	): boolean {
		if (!props.formulaBridge) return true;
		return Boolean(result && Result.isOk(result) && isApplied(result.value));
	}

	function didApplyResult<T, Reason extends string, Error>(
		result: ResultLike<OperationOutcome<T, Reason>, Error>,
	): boolean {
		return Result.isOk(result) && isApplied(result.value);
	}

	function syncAllToFormulaEngine(): boolean {
		if (!props.formulaBridge) return true;
		return didApplyFormulaBridgeOperation(
			props.formulaBridge?.syncAll(props.store.cells),
		);
	}

	function syncRowOrderToFormulaEngine(indexOrder: number[]): boolean {
		if (!props.formulaBridge) return true;
		return didApplyFormulaBridgeOperation(
			props.formulaBridge?.setRowOrder(indexOrder),
		);
	}

	function syncMutationToFormulaEngine(mutation: CellMutation): boolean {
		if (!props.formulaBridge) return true;
		return didApplyFormulaBridgeOperation(props.formulaBridge?.setCell(
			mutation.address.row,
			mutation.address.col,
			mutation.newValue,
		));
	}

	function buildCellsAfterMutations(mutations: CellMutation[]): CellValue[][] {
		const nextCells = props.store.cells.map((row) => [...row]);
		for (const mutation of mutations) {
			while (nextCells.length <= mutation.address.row) {
				nextCells.push(new Array(props.store.colCount()).fill(null) as CellValue[]);
			}
			const row = nextCells[mutation.address.row]!;
			while (row.length <= mutation.address.col) {
				row.push(null);
			}
			row[mutation.address.col] = mutation.newValue;
		}
		return nextCells;
	}

	function syncMutationsToFormulaEngine(mutations: CellMutation[]): boolean {
		if (!props.formulaBridge || mutations.length === 0) return true;

		return didApplyFormulaBridgeOperation(
			props.formulaBridge.syncAll(buildCellsAfterMutations(mutations)),
		);
	}

	function syncAlreadyAppliedMutationsToFormulaEngine(mutations: CellMutation[]): boolean {
		if (!props.formulaBridge || mutations.length === 0) return true;

		return didApplyFormulaBridgeOperation(
			props.formulaBridge.syncAll(props.store.cells),
		);
	}

	function buildCellMutation(
		viewAddress: CellAddress,
		newValue: CellValue,
		source: CellMutation["source"],
	): CellMutation | null {
		const column = props.columns[viewAddress.col];
		if (!column) return null;

		const physicalRow = getPhysicalRowForVisualRow(viewAddress.row);
		const rowId = getRowIdAtVisualRow(viewAddress.row) ?? props.store.getRowIdAtPhysicalRow(physicalRow);
		const oldValue = getRawCellValueForPhysicalRow(physicalRow, viewAddress.col);

		if (oldValue === newValue) return null;

		return {
			address: { row: physicalRow, col: viewAddress.col },
			viewAddress,
			rowId: rowId ?? undefined,
			columnId: column.id,
			oldValue,
			newValue,
			source,
		};
	}

	function applyBatchMutations(mutations: CellMutation[]) {
		if (mutations.length === 0) return;
		if (!syncMutationsToFormulaEngine(mutations)) return;
		applyMutations(props.store, mutations);
		props.onBatchEdit?.(mutations);
	}

	function setEditorSelection(start: number, end: number = start) {
		setEditorCaret({ start, end });
	}

	function setEditorSelectionAndFocus(start: number, end: number = start) {
		setEditorCaret({ start, end });
		setPendingCaret({ start, end });
	}

	function startEditing(
		addr: CellAddress,
		options?: {
			initialText?: string;
			source?: "cell" | "formula-bar";
			selectAll?: boolean;
		},
	) {
		const colDef = props.columns[addr.col];
		if (colDef?.editable === false) return;

		const rawValue = getRawCellValue(addr.row, addr.col);
		warnIfFormatValueWithoutParseValue(colDef);
		const seedText = colDef?.formatValue
			? colDef.formatValue(rawValue, { row: addr.row, col: addr.col })
			: cellValueToEditorText(rawValue);
		const nextText = options?.initialText ?? seedText;
		props.store.setEditMode({ address: addr, initialValue: rawValue });
		setEditorText(nextText);
		setEditorSource(options?.source ?? "cell");
		setReferenceRange(null);
		setReferenceInsertion(null);
		setReferenceDragAnchor(null);

		if (options?.selectAll) {
			setEditorSelectionAndFocus(0, nextText.length);
		} else {
			setEditorSelectionAndFocus(nextText.length, nextText.length);
		}
	}

	function updateEditorText(nextText: string) {
		setEditorText(nextText);
		if (!props.store.editMode()) return;

		// Always clear referenceInsertion when the user manually types.
		// This signal tracks the "replaceable" region during click/drag reference
		// selection — once the user types new characters the previous insertion is
		// finalised and the next reference click should insert at the caret.
		setReferenceInsertion(null);

		if (!isFormulaText(nextText)) {
			setReferenceRange(null);
		}
	}

	function insertReference(range: CellRange) {
		const editState = props.store.editMode();
		if (!editState) return;

		const normalized = normalizeRange(range);
		const modelRange = {
			start: {
				row: getPhysicalRowForVisualRow(normalized.start.row),
				col: normalized.start.col,
			},
			end: {
				row: getPhysicalRowForVisualRow(normalized.end.row),
				col: normalized.end.col,
			},
		};
		const modelEditAddress = {
			row: getPhysicalRowForVisualRow(editState.address.row),
			col: editState.address.col,
		};

		// Check if a custom reference text override is provided
		if (customization?.getReferenceText) {
			const customText = customization.getReferenceText(modelEditAddress, modelRange.start);
			if (customText !== null) {
				insertReferenceText(customText, normalized);
				return;
			}
		}

		insertReferenceText(rangeToA1(modelRange), normalized);
	}

	function insertReferenceText(text: string, nextReferenceRange?: CellRange | null) {
		if (!props.store.editMode()) return;

		const replacement = referenceInsertion() ?? editorCaret();
		const currentText = editorText();
		const nextText =
			currentText.slice(0, replacement.start) +
			text +
			currentText.slice(replacement.end);
		const nextEnd = replacement.start + text.length;

		setEditorText(nextText);
		setReferenceInsertion({ start: replacement.start, end: nextEnd });
		setReferenceRange(nextReferenceRange ?? null);
		setEditorSelectionAndFocus(nextEnd, nextEnd);
	}

	function focusGrid() {
		queueMicrotask(() => {
			// Only refocus if nothing else claimed focus (e.g. formula bar, external element)
			if (document.activeElement && document.activeElement !== document.body) return;
			gridRef?.focus();
		});
	}

	function handleEditorCommit() {
		const editMode = props.store.editMode();
		if (!editMode) return;
		const physicalRow = getPhysicalRowForVisualRow(editMode.address.row);
		const colDef = props.columns[editMode.address.col];
		const previousValue =
			props.store.cells[physicalRow]?.[editMode.address.col] ?? null;
		const nextValue = colDef?.parseValue
			? colDef.parseValue(editorText(), {
					previousValue,
					row: physicalRow,
					col: editMode.address.col,
				})
			: parseEditValue(editMode.initialValue, editorText());

		const mutation = buildCellMutation(editMode.address, nextValue, "user");
		if (mutation && !syncMutationToFormulaEngine(mutation)) {
			return;
		}

		props.store.setEditMode(null);

		if (mutation) {
			applyMutations(props.store, [mutation]);
			props.onCellEdit?.(mutation);
		}

		focusGrid();
	}

	function handleEditCancel() {
		props.store.setEditMode(null);
		setReferenceInsertion(null);
		setReferenceRange(null);
		focusGrid();
	}

	function handleEditTab(shift: boolean) {
		handleNavigateAfterEdit(shift ? "left" : "right");
	}

	function handleEditEnter(shift: boolean) {
		if (isFormulaText(editorText())) {
			return;
		}
		handleNavigateAfterEdit(shift ? "up" : "down");
	}

	function handleEditArrowNav(direction: "up" | "down" | "left" | "right") {
		handleNavigateAfterEdit(direction);
	}

	function handleNavigateAfterEdit(direction: "up" | "down" | "left" | "right") {
		const sel = props.store.selection();
		const next = moveSelection(sel, direction, false, false, {
			rowCount: props.store.rowCount(),
			colCount: props.store.colCount(),
		});
		props.store.setSelection(next);
	}

	function handleFormulaBarFocus() {
		setEditorSource("formula-bar");
		if (!props.store.editMode()) {
			startEditing(selectedAddress(), { source: "formula-bar" });
		}
	}

	function handleFormulaBarBlur() {
		if (isReferenceDragging()) return;
		if (editorSource() === "formula-bar") {
			handleEditorCommit();
		}
	}

	function handleCellDblClick(addr: CellAddress) {
		if (props.readOnly) return;
		startEditing(addr, {
			source: "cell",
			selectAll: true,
		});
	}

	function getColumnIndexFromOffset(offsetX: number): number {
		const rights = columnRightOffsets();
		if (rights.length === 0) return 0;

		let low = 0;
		let high = rights.length - 1;
		while (low <= high) {
			const mid = Math.floor((low + high) / 2);
			if (offsetX < rights[mid]!) {
				high = mid - 1;
			} else {
				low = mid + 1;
			}
		}

		return Math.max(0, Math.min(low, rights.length - 1));
	}

	function getViewportRect(): DOMRect | null {
		if (!viewportRef) return null;
		return dragViewportRect ?? viewportRef.getBoundingClientRect();
	}

	function captureViewportRect() {
		dragViewportRect = viewportRef?.getBoundingClientRect() ?? null;
	}

	function getGridAddressFromViewportEvent(event: MouseEvent): CellAddress | null {
		if (!viewportRef) return null;

		const rect = getViewportRect();
		if (!rect) return null;
		const scrollTop = viewportRef.scrollTop;
		const scrollLeft = viewportRef.scrollLeft;
		const x = event.clientX - rect.left + scrollLeft - rowGutterWidth();
		const y = event.clientY - rect.top + scrollTop - headerTotalHeight();

		if (x < 0 || y < 0) return null;

		const row = Math.max(0, Math.min(
			props.store.rowCount() - 1,
			rowMetrics().getVisualRowAtOffset(y),
		));
		const col = getColumnIndexFromOffset(x);
		return { row, col };
	}

	function handleCellMouseDown(addr: CellAddress, event: MouseEvent) {
		setContextMenu(null);
		if (props.onCellPointerDown?.(addr, event)) return;

		if (event.button === 2) {
			if (!selectionContains(props.store.selection(), addr)) {
				props.store.setSelection(selectCell(addr));
			}
			return;
		}

		if (isReferenceSelectionMode()) {
			event.preventDefault();
			event.stopPropagation();
			captureViewportRect();
			setIsReferenceDragging(true);
			setReferenceDragAnchor(addr);
			insertReference({ start: addr, end: addr });
			return;
		}

		if (props.store.editMode()) {
			handleEditorCommit();
		}

		if (event.shiftKey) {
			const sel = props.store.selection();
			props.store.setSelection(extendSelection(sel.anchor, addr));
		} else if (event.ctrlKey || event.metaKey) {
			props.store.setSelection(selectCell(addr));
		} else {
			props.store.setSelection(selectCell(addr));
			captureViewportRect();
			setIsDraggingSelection(true);
		}
	}

	function handleCellMouseEnter(addr: CellAddress, event: MouseEvent) {
		props.onCellPointerMove?.(addr, event);
	}

	function handleRowHeaderMouseDown(row: number, event: MouseEvent) {
		if (event.button !== 2) {
			event.preventDefault();
		}
		if (isReferenceSelectionMode() || props.store.colCount() === 0) return;
		if (props.store.editMode()) handleEditorCommit();
		props.store.setSelection({
			ranges: [{
				start: { row, col: 0 },
				end: { row, col: props.store.colCount() - 1 },
			}],
			anchor: { row, col: 0 },
			focus: { row, col: props.store.colCount() - 1 },
			editing: null,
		});
		focusGrid();
	}

	function handleColumnHeaderMouseDown(col: number, event: MouseEvent) {
		if (event.button !== 2) {
			event.preventDefault();
		}
		if (isReferenceSelectionMode() || props.store.rowCount() === 0) return;
		if (props.store.editMode()) handleEditorCommit();
		props.store.setSelection({
			ranges: [{
				start: { row: 0, col },
				end: { row: props.store.rowCount() - 1, col },
			}],
			anchor: { row: 0, col },
			focus: { row: props.store.rowCount() - 1, col },
			editing: null,
		});
		focusGrid();
	}

	function handleMouseMove(event: MouseEvent) {
		if (handleResizeSessionMove(event)) {
			return;
		}

		// Fire external pointer-move callback if provided
		if (props.onCellPointerMove) {
			const target = getGridAddressFromViewportEvent(event);
			if (target) {
				if (props.onCellPointerMove(target, event)) return;
			}
		}

		const activeFillDrag = fillDragState();
		if (activeFillDrag) {
			const target = getGridAddressFromViewportEvent(event);
			if (!target) {
				setFillDragState({
					...activeFillDrag,
					preview: null,
				});
				return;
			}

			setFillDragState({
				...activeFillDrag,
				preview: computeFillPreview(activeFillDrag.source, target, "vertical"),
			});
			return;
		}

		if (isReferenceDragging() && isReferenceSelectionMode()) {
			const target = getGridAddressFromViewportEvent(event);
			const anchor = referenceDragAnchor();
			if (!target || !anchor) return;
			insertReference({
				start: anchor,
				end: target,
			});
			return;
		}

		if (!isDraggingSelection() || !viewportRef) return;

		const rect = getViewportRect();
		if (!rect) return;
		const scrollTop = viewportRef.scrollTop;
		const scrollLeft = viewportRef.scrollLeft;
		const x = event.clientX - rect.left + scrollLeft - rowGutterWidth();
		const y = event.clientY - rect.top + scrollTop - headerTotalHeight();

		const row = Math.max(0, Math.min(
			props.store.rowCount() - 1,
			rowMetrics().getVisualRowAtOffset(y),
		));
		const col = getColumnIndexFromOffset(Math.max(0, x));

		const sel = props.store.selection();
		props.store.setSelection(extendSelection(sel.anchor, { row, col }));
	}

	function scheduleMouseMove(event: MouseEvent) {
		pendingMouseMoveEvent = event;
		if (mouseMoveFrame !== null) return;

		mouseMoveFrame = requestAnimationFrame(() => {
			const nextEvent = pendingMouseMoveEvent;
			pendingMouseMoveEvent = null;
			mouseMoveFrame = null;
			if (nextEvent) handleMouseMove(nextEvent);
		});
	}

	function stringifyClipboardValue(value: CellValue): string {
		if (value === null || value === undefined) return "";
		return String(value);
	}

	function serializeSelectionRange(range: CellRange): string {
		const normalized = normalizeRange(range);
		const lines: string[] = [];

		for (let row = normalized.start.row; row <= normalized.end.row; row++) {
			const rowValues: string[] = [];
			for (let col = normalized.start.col; col <= normalized.end.col; col++) {
				rowValues.push(stringifyClipboardValue(getRawCellValue(row, col)));
			}
			lines.push(rowValues.join("\t"));
		}

		return lines.join("\n");
	}

	function buildDeleteMutationsFromSelection(selection: Selection = props.store.selection()): CellMutation[] {
		const mutations: CellMutation[] = [];

		for (const range of selection.ranges) {
			const normalized = normalizeRange(range);
			for (let row = normalized.start.row; row <= normalized.end.row; row++) {
				for (let col = normalized.start.col; col <= normalized.end.col; col++) {
					const column = props.columns[col];
					if (!column || column.editable === false) continue;

					const mutation = buildCellMutation({ row, col }, null, "delete");
					if (mutation) mutations.push(mutation);
				}
			}
		}

		return mutations;
	}

	function buildPasteMutationsForSelection(
		parsed: CellValue[][],
		target: CellAddress,
	): CellMutation[] {
		const mutations: CellMutation[] = [];

		for (let r = 0; r < parsed.length; r++) {
			const pasteRow = parsed[r];
			if (!pasteRow) continue;

			for (let c = 0; c < pasteRow.length; c++) {
				const viewAddress = { row: target.row + r, col: target.col + c };
				const column = props.columns[viewAddress.col];
				if (!column || column.editable === false) continue;

				const mutation = buildCellMutation(
					viewAddress,
					pasteRow[c] ?? null,
					"paste",
				);
				if (mutation) mutations.push(mutation);
			}
		}

		return mutations;
	}

	function mapDestinationRowToSourceRow(
		source: CellRange,
		preview: NonNullable<ReturnType<typeof computeFillPreview>>,
		destinationRow: number,
	): number {
		const height = source.end.row - source.start.row + 1;
		if (preview.direction === "down") {
			const offset = destinationRow - (source.end.row + 1);
			return source.start.row + modulo(offset, height);
		}

		const offset = (source.start.row - 1) - destinationRow;
		return source.end.row - modulo(offset, height);
	}

	function computeLinearSeriesValue(
		seedValues: CellValue[],
		source: CellRange,
		preview: NonNullable<ReturnType<typeof computeFillPreview>>,
		destinationRow: number,
	): CellValue {
		const numericSeed = seedValues as number[];
		const lastSeed = numericSeed[numericSeed.length - 1]!;
		const previousSeed = numericSeed[numericSeed.length - 2]!;
		const step = lastSeed - previousSeed;

		if (preview.direction === "down") {
			const distance = destinationRow - source.end.row;
			return lastSeed + step * distance;
		}

		const firstSeed = numericSeed[0]!;
		const distance = source.start.row - destinationRow;
		return firstSeed - step * distance;
	}

	function modulo(value: number, divisor: number): number {
		return ((value % divisor) + divisor) % divisor;
	}

	function buildFillMutations(
		sourceRange: CellRange,
		preview: NonNullable<ReturnType<typeof computeFillPreview>> | null,
	): CellMutation[] {
		if (!preview || preview.axis !== "vertical") return [];

		const source = normalizeRange(sourceRange);
		const extension = normalizeRange(preview.extension);
		const width = source.end.col - source.start.col + 1;
		const height = source.end.row - source.start.row + 1;

		if (
			extension.start.col !== source.start.col ||
			extension.end.col !== source.end.col ||
			width <= 0 ||
			height <= 0
		) {
			return [];
		}

		const columnStates = Array.from({ length: width }, (_, offset) => {
			const col = source.start.col + offset;
			const seedValues = Array.from(
				{ length: height },
				(_, rowOffset) => getRawCellValue(source.start.row + rowOffset, col),
			);

			return {
				mode: resolveAutoFillMode(seedValues),
				seedValues,
			};
		});

		const mutations: CellMutation[] = [];

		for (let row = extension.start.row; row <= extension.end.row; row++) {
			for (let col = extension.start.col; col <= extension.end.col; col++) {
				const column = props.columns[col];
				if (!column || column.editable === false) continue;

				const sourceRow = mapDestinationRowToSourceRow(source, preview, row);
				const sourceValue = getRawCellValue(sourceRow, col);
				const columnState = columnStates[col - source.start.col]!;
				let nextValue: CellValue;

				switch (columnState.mode) {
					case "formula-copy":
						if (typeof sourceValue === "string" && isFormulaValue(sourceValue)) {
							nextValue = shiftFormulaByDelta(
								sourceValue,
								getPhysicalRowForVisualRow(row) - getPhysicalRowForVisualRow(sourceRow),
								0,
							);
						} else {
							nextValue = sourceValue;
						}
						break;

					case "linear-series":
						nextValue = computeLinearSeriesValue(
							columnState.seedValues,
							source,
							preview,
							row,
						);
						break;

					case "copy":
					default:
						nextValue = sourceValue;
						break;
				}

				const mutation = buildCellMutation({ row, col }, nextValue, "fill");
				if (mutation) mutations.push(mutation);
			}
		}

		return mutations;
	}

	function handleMouseUp() {
		if (mouseMoveFrame !== null) {
			cancelAnimationFrame(mouseMoveFrame);
			mouseMoveFrame = null;
			pendingMouseMoveEvent = null;
		}
		finalizeResizeSession();

		const activeFillDrag = fillDragState();
		if (activeFillDrag) {
			const mutations = buildFillMutations(
				activeFillDrag.source,
				activeFillDrag.preview,
			);
			setFillDragState(null);
			applyBatchMutations(mutations);
		}

		setIsDraggingSelection(false);
		setIsReferenceDragging(false);
		setReferenceInsertion(null);
		setReferenceDragAnchor(null);
		dragViewportRect = null;
	}

	function handleContextMenu(event: MouseEvent) {
		event.preventDefault();
		const headerElement = (event.target as HTMLElement | null)?.closest<HTMLElement>(
			".se-header-cell[data-col-index], .se-header-ref-cell[data-col-index]",
		);
		const columnIndexText = headerElement?.dataset.colIndex;
		const columnIndex = columnIndexText === undefined ? NaN : Number(columnIndexText);
		if (Number.isInteger(columnIndex) && columnIndex >= 0) {
			setContextMenu({
				x: event.clientX,
				y: event.clientY,
				kind: "column-header",
				col: columnIndex,
			});
			return;
		}
		setContextMenu({ x: event.clientX, y: event.clientY, kind: "grid" });
	}

	function handleInsertRows(atIndex: number, count: number) {
		if (isViewSortActive()) return;
		if (props.workbook) {
			const sheetKey = workbookSheetKey();
			if (!sheetKey) return;
			const change = workbookCoordinator()!.insertRows(sheetKey, atIndex, count);
			if (didApplyResult(change)) {
				props.onRowInsert?.(atIndex, count);
			}
			focusGrid();
			return;
		}
		const selBefore = props.store.selection();
		const cellsBefore = props.store.cells.map((row) => [...row]);
		const rowIdsBefore = [...props.store.rowIds()];
		props.store.insertRows(atIndex, count);
		if (!syncAllToFormulaEngine()) {
			props.store.restoreSnapshot(cellsBefore, rowIdsBefore);
			return;
		}
		props.store.pushRowOperation(
			{ type: "insertRows", atIndex, count },
			selBefore,
			props.store.selection(),
		);
		props.onRowInsert?.(atIndex, count);
		focusGrid();
	}

	function handleDeleteRows(atIndex: number, count: number) {
		if (isViewSortActive() && count !== 1) return;

		const physicalAtIndex = getPhysicalRowForVisualRow(atIndex);
		if (props.workbook) {
			const sheetKey = workbookSheetKey();
			if (!sheetKey) return;
			const change = workbookCoordinator()!.deleteRows(sheetKey, physicalAtIndex, count);
			if (didApplyResult(change)) {
				props.onRowDelete?.(physicalAtIndex, count);
			}
			focusGrid();
			return;
		}
		const selBefore = props.store.selection();
		const previousCells = props.store.cells.map((row) => [...row]);
		const rowIdsBefore = [...props.store.rowIds()];
		const removedData = props.store.deleteRows(physicalAtIndex, count);
		if (!syncAllToFormulaEngine()) {
			props.store.restoreSnapshot(previousCells, rowIdsBefore);
			return;
		}

		// Clamp selection if it's now beyond the last row
		const newRowCount = props.store.rowCount();
		if (newRowCount > 0) {
			const clampedRow = Math.min(selBefore.anchor.row, newRowCount - 1);
			props.store.setSelection(
				selectCell({ row: clampedRow, col: selBefore.anchor.col }),
			);
		}

		props.store.pushRowOperation(
			{ type: "deleteRows", atIndex: physicalAtIndex, count, removedData, previousCells },
			selBefore,
			props.store.selection(),
		);
		props.onRowDelete?.(physicalAtIndex, count);
		focusGrid();
	}

	const contextMenuItems = createMemo<ContextMenuEntry[]>(() => {
		const menu = contextMenu();
		if (menu?.kind === "column-header") {
			const column = props.columns[menu.col];
			const isSortable = column?.sortable !== false;
			const isCurrentColumnSorted = currentSortState()?.columnId === column?.id;
			return [
				{
					label: "Sort A-Z",
					disabled: !column || !isSortable,
					action: () => {
						if (!column) return;
						handleSort(column.id, "asc");
					},
				},
				{
					label: "Sort Z-A",
					disabled: !column || !isSortable,
					action: () => {
						if (!column) return;
						handleSort(column.id, "desc");
					},
				},
				{ type: "separator" },
				{
					label: "Clear sort",
					disabled: !column || !isCurrentColumnSorted,
					action: () => {
						if (!column) return;
						handleSort(column.id, null);
					},
				},
			];
		}

		const isReadOnly = props.readOnly;
		const sel = props.store.selection();
		const anchorRow = sel.anchor.row;
		return [
			{
				label: "Cut",
				shortcut: "Ctrl+X",
				disabled: isReadOnly,
				action: () => handleCut(),
			},
			{
				label: "Copy",
				shortcut: "Ctrl+C",
				action: () => handleCopy(),
			},
			{
				label: "Paste",
				shortcut: "Ctrl+V",
				disabled: isReadOnly,
				action: () => {
					navigator.clipboard.readText().then(
						(text) => handlePaste(text),
						() => { /* clipboard access denied */ },
					);
				},
			},
				{
					label: "Delete",
					shortcut: "Del",
					disabled: isReadOnly,
					action: () => {
						const mutations = buildDeleteMutationsFromSelection();
						applyBatchMutations(mutations);
					},
				},
			{ type: "separator" as const },
				{
					label: "Insert row above",
					disabled: isReadOnly || isViewSortActive(),
					action: () => handleInsertRows(anchorRow, 1),
				},
				{
					label: "Insert row below",
					disabled: isReadOnly || isViewSortActive(),
					action: () => handleInsertRows(anchorRow + 1, 1),
				},
			{
				label: "Delete row",
				disabled: isReadOnly || props.store.rowCount() <= 1,
				action: () => handleDeleteRows(anchorRow, 1),
			},
			];
		});

	function updateSortState(nextState: SortState | null) {
		if (props.sortState === undefined) {
			setInternalSortState(nextState);
		}
		props.onSortChange?.(nextState);
	}

	function commitRowReorder(
		columnId: string,
		direction: SortDirection | null,
		nextOrder: number[],
	) {
		const oldOrder = [...props.store.rowIds()];
		if (oldOrder.every((rowId, index) => rowId === nextOrder[index])) {
			return;
		}

		const reorderEvent: RowReorderMutation = {
			columnId,
			direction,
			oldOrder,
			newOrder: nextOrder,
			indexOrder: buildIndexOrder(oldOrder, nextOrder),
			source: "sort",
		};

		if (props.workbook) {
			const sheetKey = workbookSheetKey();
			if (!sheetKey) return;
			const change = workbookCoordinator()!.setRowOrder(sheetKey, reorderEvent.indexOrder);
			if (!didApplyResult(change)) return;
			props.onRowReorder?.(reorderEvent);
			return;
		}

		if (props.formulaBridge && !syncRowOrderToFormulaEngine(reorderEvent.indexOrder)) {
			return;
		}

		const selectionBefore = props.store.selection();
		props.store.reorderRows(nextOrder);

		const remappedSelection = remapSelectionForRowOrder(selectionBefore, oldOrder, nextOrder);
		if (remappedSelection) {
			props.store.setSelection(remappedSelection);
		}

		const remappedEditMode = remapEditModeForRowOrder(props.store.editMode(), oldOrder, nextOrder);
		if (props.store.editMode()) {
			props.store.setEditMode(remappedEditMode);
		}

		props.store.pushRowReorder(
			{
				columnId,
				direction,
				oldOrder,
				newOrder: nextOrder,
			},
			selectionBefore,
			props.store.selection(),
		);
		props.onRowReorder?.(reorderEvent);
	}

	function applyMutationSort(sort: SortState | null, options?: { baseOrder?: number[] | null }) {
		if (!sort) {
			const baseOrder = options?.baseOrder ?? mutationSortBaseOrder();
			if (!baseOrder) return;
			commitRowReorder(currentSortState()?.columnId ?? "", null, baseOrder);
			setMutationSortBaseOrder(null);
			return;
		}

		const columnIndex = props.columns.findIndex((column) => column.id === sort.columnId);
		if (columnIndex < 0) return;

		const oldOrder = [...props.store.rowIds()];
		const nextOrder = oldOrder
			.map((rowId, physicalRow) => ({
				rowId,
				physicalRow,
				value: getSortComparableValue(physicalRow, columnIndex),
			}))
			.sort((left, right) => {
				const comparison = compareSortableEntries(left.value, right.value, sort.direction);
				if (comparison !== 0) {
					return comparison;
				}
				return left.physicalRow - right.physicalRow;
			})
			.map((entry) => entry.rowId);

		commitRowReorder(sort.columnId, sort.direction, nextOrder);
	}

	function handleSort(columnId: string, requestedDirection?: SortDirection | null) {
		if (props.store.editMode()) {
			handleEditorCommit();
		}

		const column = props.columns.find((entry) => entry.id === columnId);
		if (!column || column.sortable === false) return;

		const current = currentSortState();
		let nextState: SortState | null;
		if (requestedDirection !== undefined) {
			nextState = requestedDirection === null
				? null
				: { columnId, direction: requestedDirection };
		} else if (!current || current.columnId !== columnId) {
			nextState = { columnId, direction: "asc" };
		} else if (current.direction === "asc") {
			nextState = { columnId, direction: "desc" };
		} else {
			nextState = null;
		}

		const previousOrderForMutation = props.sortBehavior === "mutation"
			? [...props.store.rowIds()]
			: null;

		if (props.sortBehavior === "mutation") {
			if (!current || current.columnId !== columnId) {
				setMutationSortBaseOrder(previousOrderForMutation);
			}
			if (nextState === null) {
				applyMutationSort(null, { baseOrder: mutationSortBaseOrder() ?? previousOrderForMutation });
				setMutationSortBaseOrder(null);
			} else {
				applyMutationSort(nextState);
			}
		}

		updateSortState(nextState);
		props.onSort?.(columnId, nextState?.direction ?? null);
	}

	function handleSearchNext() {
		const matches = searchMatches();
		if (matches.length === 0) return;
		setSearchCurrentIndex((prev) => (prev + 1) % matches.length);
	}

	function handleSearchPrev() {
		const matches = searchMatches();
		if (matches.length === 0) return;
		setSearchCurrentIndex((prev) => (prev - 1 + matches.length) % matches.length);
	}

	function handleSearchClose() {
		setSearchOpen(false);
		setSearchQuery("");
		setSearchCurrentIndex(-1);
		gridRef?.focus();
	}

	function handleKeyDown(event: KeyboardEvent) {
		setContextMenu(null);

		if (event.key === "Escape" && fillDragState()) {
			event.preventDefault();
			setFillDragState(null);
			return;
		}

		if (props.store.editMode()) return;

		const command = mapKeyToCommand(event);
		if (!command) return;

		if (shouldPreventDefault(command)) {
			event.preventDefault();
		}

		switch (command.type) {
			case "move": {
				const next = moveSelection(
					props.store.selection(),
					command.direction,
					command.shift,
					command.ctrl,
					{ rowCount: props.store.rowCount(), colCount: props.store.colCount() },
				);
				props.store.setSelection(next);
				break;
			}

			case "editStart": {
				if (props.readOnly) break;
				event.stopPropagation();
				const sel = props.store.selection();
				const options: {
					initialText?: string;
					source?: "cell" | "formula-bar";
				} = {
					source: "cell",
				};
				if (command.initialChar !== undefined) {
					options.initialText = command.initialChar;
				}
				startEditing(sel.anchor, options);
				break;
			}

			case "editCommit": {
				const next = moveSelection(
					props.store.selection(),
					command.direction,
					false,
					false,
					{ rowCount: props.store.rowCount(), colCount: props.store.colCount() },
				);
				props.store.setSelection(next);
				break;
			}

			case "editCancel": {
				if (clipboardRange()) {
					setClipboardRange(null);
				} else {
					const grid = (event.target as HTMLElement)?.closest(".se-grid");
					if (grid instanceof HTMLElement) grid.blur();
				}
				break;
			}

				case "delete": {
					if (props.readOnly) break;
					const mutations = buildDeleteMutationsFromSelection();
					applyBatchMutations(mutations);
					break;
				}

			case "selectAll":
				props.store.setSelection(
					selectAll(props.store.rowCount(), props.store.colCount()),
				);
				break;

			case "copy":
				handleCopy();
				break;

			case "cut":
				handleCut();
				break;

			case "undo": {
				if (props.workbook && workbookCoordinator()!.canUndo()) {
					workbookCoordinator()!.undo();
					break;
				}
				const undoResult = props.store.undo();
				if (undoResult) {
					if (undoResult.mutations.length > 0) {
						if (!syncAlreadyAppliedMutationsToFormulaEngine(undoResult.mutations)) break;
						props.onBatchEdit?.(undoResult.mutations);
					}
					if (undoResult.rowChange) {
						if (!syncAllToFormulaEngine()) break;
						if (undoResult.rowChange.type === "insertRows") {
							props.onRowInsert?.(undoResult.rowChange.atIndex, undoResult.rowChange.count);
						} else {
							props.onRowDelete?.(undoResult.rowChange.atIndex, undoResult.rowChange.count);
						}
					}
					if (undoResult.rowReorder) {
						if (!syncRowOrderToFormulaEngine(undoResult.rowReorder.indexOrder)) break;
						props.onRowReorder?.(undoResult.rowReorder);
					}
					if (undoResult.columnResize && props.columnSizing === undefined) {
						notifyColumnResizeState(undoResult.columnResize.columnId, undoResult.columnResize.width);
					}
					if (undoResult.rowResize && props.rowSizing === undefined) {
						notifyRowResizeState(undoResult.rowResize.rowId, undoResult.rowResize.height);
					}
				}
				break;
			}

			case "redo": {
				if (props.workbook && workbookCoordinator()!.canRedo()) {
					workbookCoordinator()!.redo();
					break;
				}
				const redoResult = props.store.redo();
				if (redoResult) {
					if (redoResult.mutations.length > 0) {
						if (!syncAlreadyAppliedMutationsToFormulaEngine(redoResult.mutations)) break;
						props.onBatchEdit?.(redoResult.mutations);
					}
					if (redoResult.rowChange) {
						if (!syncAllToFormulaEngine()) break;
						if (redoResult.rowChange.type === "insertRows") {
							props.onRowInsert?.(redoResult.rowChange.atIndex, redoResult.rowChange.count);
						} else {
							props.onRowDelete?.(redoResult.rowChange.atIndex, redoResult.rowChange.count);
						}
					}
					if (redoResult.rowReorder) {
						if (!syncRowOrderToFormulaEngine(redoResult.rowReorder.indexOrder)) break;
						props.onRowReorder?.(redoResult.rowReorder);
					}
					if (redoResult.columnResize && props.columnSizing === undefined) {
						notifyColumnResizeState(redoResult.columnResize.columnId, redoResult.columnResize.width);
					}
					if (redoResult.rowResize && props.rowSizing === undefined) {
						notifyRowResizeState(redoResult.rowResize.rowId, redoResult.rowResize.height);
					}
				}
				break;
			}

			case "search": {
				setSearchOpen(true);
				break;
			}
		}
	}

	function handleCopy() {
		const sel = props.store.selection();
		const range = primaryRange(sel);
		if (!range) return;

		const tsv = serializeSelectionRange(range);
		void navigator.clipboard.writeText(tsv);
		setClipboardRange({ ...range });

		props.onClipboard?.({
			action: "copy",
			range,
			text: tsv,
			cells: parseTSV(tsv),
		});
	}

	function handleCut() {
		if (props.readOnly) return;

		const sel = props.store.selection();
		const range = primaryRange(sel);
		if (!range) return;

		const tsv = serializeSelectionRange(range);
		void navigator.clipboard.writeText(tsv);
		setClipboardRange({ ...range });

		props.onClipboard?.({
			action: "cut",
			range,
			text: tsv,
			cells: parseTSV(tsv),
		});

		const mutations = buildDeleteMutationsFromSelection(sel);
		applyBatchMutations(mutations);
	}

	function handlePaste(text: string) {
		if (props.readOnly) return;
		const parsed = parseTSV(text);
		if (parsed.length === 0) return;

		const sel = props.store.selection();
		const target = sel.anchor;
		const mutations = buildPasteMutationsForSelection(parsed, target);

		applyBatchMutations(mutations);
		setClipboardRange(null);

		const range = primaryRange(sel);
		if (range) {
			props.onClipboard?.({
				action: "paste",
				range,
				text,
				cells: parsed,
			});
		}
	}

	function handleColumnResizeStart(columnId: string, event: MouseEvent) {
		if (event.button !== 0) return;
		const column = props.columns.find((entry) => entry.id === columnId);
		if (!column || column.resizable === false) return;

		event.preventDefault();
		event.stopPropagation();
		setContextMenu(null);
		captureViewportRect();

		const startSize = getCommittedColumnWidth(columnId);
		setResizeSession({
			axis: "column",
			targetId: columnId,
			startPointerOffset: event.clientX,
			startSize,
			currentDelta: 0,
			previewSize: startSize,
			isActive: true,
		});
	}

	function handleRowResizeStart(visualRow: number, event: MouseEvent) {
		if (event.button !== 0) return;
		const rowId = getRowIdAtVisualRow(visualRow);
		if (rowId === null) return;

		setContextMenu(null);
		captureViewportRect();
		const startSize = getCommittedRowHeight(rowId);
		setResizeSession({
			axis: "row",
			targetId: rowId,
			startPointerOffset: event.clientY,
			startSize,
			currentDelta: 0,
			previewSize: startSize,
			isActive: true,
		});
	}

	function handleResizeSessionMove(event: MouseEvent): boolean {
		const session = resizeSession();
		if (!session?.isActive) return false;

		if (session.axis === "column") {
			const column = props.columns.find((entry) => entry.id === session.targetId);
			if (!column) return false;

			const delta = event.clientX - session.startPointerOffset;
			const previewSize = clampColumnWidth(column, session.startSize + delta);
			setResizeSession({
				...session,
				currentDelta: delta,
				previewSize,
			});

			if (props.resizeMode === "onChange") {
				updateCommittedColumnWidth(column.id, previewSize);
			}
			return true;
		}

		const rowId = Number(session.targetId);
		const delta = event.clientY - session.startPointerOffset;
		const previewSize = Math.max(props.rowHeight, session.startSize + delta);
		setResizeSession({
			...session,
			currentDelta: delta,
			previewSize,
		});

		if (props.resizeMode === "onChange") {
			updateCommittedRowHeight(rowId, previewSize);
		}
		return true;
	}

	function finalizeResizeSession() {
		const session = resizeSession();
		if (!session?.isActive) return;
		const selection = props.store.selection();

		if (session.previewSize !== session.startSize) {
			if (session.axis === "column") {
				const columnId = String(session.targetId);
				if (props.columnSizing === undefined) {
					props.store.pushColumnResize(
						{ columnId, oldWidth: session.startSize, newWidth: session.previewSize },
						selection,
						selection,
					);
				}
				if (props.resizeMode === "onEnd") {
					commitColumnResize(columnId, session.previewSize);
				} else {
					props.onColumnResize?.(columnId, session.previewSize);
				}
			} else {
				const rowId = Number(session.targetId);
				if (props.rowSizing === undefined) {
					props.store.pushRowResize(
						{ rowId, oldHeight: session.startSize, newHeight: session.previewSize },
						selection,
						selection,
					);
				}
				if (props.resizeMode === "onEnd") {
					commitRowResize(rowId, session.previewSize);
				} else {
					props.onRowResize?.(rowId, session.previewSize);
				}
			}
		}

		setResizeSession(null);
	}

	function handleFillHandleMouseDown(event: MouseEvent) {
		event.preventDefault();
		event.stopPropagation();

		const source = autoFillSourceRange();
		if (!source || props.readOnly || props.store.editMode()) return;

		setContextMenu(null);
		captureViewportRect();
		setFillDragState({
			source,
			preview: null,
		});
	}

	createEffect(() => {
		if (!isDraggingSelection() && !isReferenceDragging() && !fillDragState() && !resizeSession()) return;

		document.addEventListener("mousemove", scheduleMouseMove);
		document.addEventListener("mouseup", handleMouseUp);

		onCleanup(() => {
			document.removeEventListener("mousemove", scheduleMouseMove);
			document.removeEventListener("mouseup", handleMouseUp);
		});
	});

	onMount(() => {
		// Attach native paste listener — Solid.js doesn't delegate paste events
		if (gridRef) {
			const onPaste = (e: ClipboardEvent) => {
				if (props.store.editMode()) return; // let the cell editor handle it
				const text = e.clipboardData?.getData("text/plain");
				if (text) {
					e.preventDefault();
					handlePaste(text);
				}
			};
			gridRef.addEventListener("paste", onPaste);
			onCleanup(() => gridRef!.removeEventListener("paste", onPaste));
		}

		if (props.controllerRef) {
			const controller: SheetController = {
				getSelection: () => props.store.selection(),
				setSelection: (ranges) => {
					if (ranges.length === 0) {
						props.store.setSelection(emptySelection());
						return;
					}

					const first = ranges[0]!;
					props.store.setSelection({
						ranges,
						anchor: first.start,
						focus: first.end,
						editing: null,
					});
				},
				clearSelection: () => props.store.setSelection(emptySelection()),
				scrollToCell: (row, col) => {
					if (!viewportRef) return;
					// Land the cell just below the sticky header / right of the sticky
					// row gutter + pinned columns so it's fully visible. Without this
					// offset, the cell ends up hidden under the sticky overlays and
					// the `scrollCellIntoView` effect would re-scroll on the next
					// click — which breaks synthesized double-clicks whose two
					// events fire at stale coordinates.
					const stickyTop = headerTotalHeight();
					const top = Math.max(0, rowMetrics().getRowTop(row) - stickyTop);

					const widths = columnWidths();
					const isColPinned = props.columns[col]?.pinned === "left";
					let left = viewportRef.scrollLeft;
					if (!isColPinned) {
						let stickyLeft = rowGutterWidth();
						for (let c = 0; c < props.columns.length; c++) {
							if (props.columns[c]?.pinned === "left") {
								stickyLeft += widths[c] ?? DEFAULT_COL_WIDTH;
							} else {
								break;
							}
						}
						const cellLeft = columnLeftOffsets()[col] ?? rowGutterWidth();
						left = Math.max(0, cellLeft - stickyLeft);
					}

					viewportRef.scrollTo({ top, left });
				},
				startEditing: (row, col) => startEditing({ row, col }),
				stopEditing: (commit = true) => {
					if (commit) {
						handleEditorCommit();
					} else {
						handleEditCancel();
					}
				},
				getRawCellValue,
				getDisplayCellValue,
				getEditorText: () => props.store.editMode() ? editorText() : null,
				canInsertReference: () => isReferenceSelectionMode(),
				insertReferenceText: (text) => insertReferenceText(text),
				setReferenceHighlight: (range) => setExternalReferenceRange(range),
				setActiveEditorValue: (value) => {
					if (!props.store.editMode()) {
						startEditing(selectedAddress(), {
							initialText: value,
							source: "formula-bar",
						});
						return;
					}
					updateEditorText(value);
					setEditorSelectionAndFocus(value.length, value.length);
				},
					commitActiveEditor: () => handleEditorCommit(),
					cancelActiveEditor: () => handleEditCancel(),
					getCellValue: getRawCellValue,
					setCellValue: (row, col, value) => {
						const mutation = buildCellMutation({ row, col }, value, "external");
						if (!mutation) return;
						if (!syncMutationToFormulaEngine(mutation)) return;
						applyMutations(props.store, [mutation]);
						props.onCellEdit?.(mutation);
				},
				getColumnMeta: (columnId) =>
					props.columns.find((column) => column.id === columnId)?.meta,
				undo: () => {
					if (props.workbook && workbookCoordinator()!.canUndo()) {
						workbookCoordinator()!.undo();
						return;
					}
					const result = props.store.undo();
					if (result) {
						if (result.mutations.length > 0) {
							if (!syncAlreadyAppliedMutationsToFormulaEngine(result.mutations)) return;
							props.onBatchEdit?.(result.mutations);
						}
							if (result.rowChange) {
								if (!syncAllToFormulaEngine()) return;
								if (result.rowChange.type === "insertRows") {
									props.onRowInsert?.(result.rowChange.atIndex, result.rowChange.count);
								} else {
									props.onRowDelete?.(result.rowChange.atIndex, result.rowChange.count);
								}
							}
							if (result.rowReorder) {
								if (!syncRowOrderToFormulaEngine(result.rowReorder.indexOrder)) return;
								props.onRowReorder?.(result.rowReorder);
							}
							if (result.columnResize && props.columnSizing === undefined) {
								notifyColumnResizeState(result.columnResize.columnId, result.columnResize.width);
							}
							if (result.rowResize && props.rowSizing === undefined) {
								notifyRowResizeState(result.rowResize.rowId, result.rowResize.height);
							}
						}
					},
				redo: () => {
					if (props.workbook && workbookCoordinator()!.canRedo()) {
						workbookCoordinator()!.redo();
						return;
					}
					const result = props.store.redo();
					if (result) {
						if (result.mutations.length > 0) {
							if (!syncAlreadyAppliedMutationsToFormulaEngine(result.mutations)) return;
							props.onBatchEdit?.(result.mutations);
						}
							if (result.rowChange) {
								if (!syncAllToFormulaEngine()) return;
								if (result.rowChange.type === "insertRows") {
									props.onRowInsert?.(result.rowChange.atIndex, result.rowChange.count);
								} else {
									props.onRowDelete?.(result.rowChange.atIndex, result.rowChange.count);
								}
							}
							if (result.rowReorder) {
								if (!syncRowOrderToFormulaEngine(result.rowReorder.indexOrder)) return;
								props.onRowReorder?.(result.rowReorder);
							}
							if (result.columnResize && props.columnSizing === undefined) {
								notifyColumnResizeState(result.columnResize.columnId, result.columnResize.width);
							}
							if (result.rowResize && props.rowSizing === undefined) {
								notifyRowResizeState(result.rowResize.rowId, result.rowResize.height);
							}
						}
					},
				insertRows: (atIndex, count) => handleInsertRows(atIndex, count),
				deleteRows: (atIndex, count) => handleDeleteRows(atIndex, count),
				canUndo: () => Boolean(props.workbook && workbookCoordinator()!.canUndo()) || props.store.canUndo(),
				canRedo: () => Boolean(props.workbook && workbookCoordinator()!.canRedo()) || props.store.canRedo(),
				getCanvasElement: () => {
					return viewportRef?.querySelector(".se-canvas") as HTMLElement | null ?? null;
				},
			};
			props.controllerRef(controller);
		}
	});

	onCleanup(() => {
		document.removeEventListener("mousemove", scheduleMouseMove);
		document.removeEventListener("mouseup", handleMouseUp);
		if (mouseMoveFrame !== null) {
			cancelAnimationFrame(mouseMoveFrame);
		}
	});

	return (
		<div
			ref={gridRef}
			class="se-grid"
			role="grid"
			aria-label="Spreadsheet"
			aria-rowcount={props.store.rowCount()}
			aria-colcount={props.store.colCount()}
			tabIndex={0}
			onKeyDown={handleKeyDown}
			onContextMenu={handleContextMenu}
		>
			<Show when={props.showFormulaBar && hasFormulaEngine()}>
				<FormulaBar
					address={formulaBarAddress()}
					value={formulaBarValue()}
					inputRef={(element) => {
						formulaBarInputRef = element;
					}}
					onInput={(value) => {
						if (!props.store.editMode()) {
							startEditing(selectedAddress(), {
								initialText: value,
								source: "formula-bar",
							});
							return;
						}
						setEditorSource("formula-bar");
						updateEditorText(value);
					}}
					onFocus={handleFormulaBarFocus}
					onBlur={handleFormulaBarBlur}
					onCommit={handleEditorCommit}
					onCancel={handleEditCancel}
					onSelectionChange={(start, end) => setEditorSelection(start, end)}
				/>
			</Show>

			<div
				ref={viewportRef}
				class="se-viewport"
				data-manual-wheel-scroll="off"
				style={{
					overflow: "auto",
					position: "relative",
				}}
			>
					<GridHeader
						columns={props.columns}
						columnWidths={committedColumnWidths()}
						totalWidth={totalWidth()}
						sortState={currentSortState()}
						showReferenceHeaders={props.showReferenceHeaders}
						rowGutterWidth={rowGutterWidth()}
						pinnedLeftOffsets={pinnedLeftOffsets()}
						lastPinnedIndex={lastPinnedIndex()}
						activeResizeColumnId={activeResizeColumnId()}
						onColumnResizeStart={handleColumnResizeStart}
						onColumnHeaderMouseDown={handleColumnHeaderMouseDown}
					/>

				<div
					class="se-canvas"
					style={{
						width: `${totalWidth()}px`,
						position: "relative",
					}}
				>
					<Show
						when={props.store.rowCount() > 0}
						fallback={
							<div class="se-empty-state" role="status">
								<span>No data</span>
							</div>
						}
					>
						<GridBody
							columns={props.columns}
							columnWidths={committedColumnWidths()}
							rowMetrics={rowMetrics()}
							rowGutterWidth={rowGutterWidth()}
							showReferenceHeaders={props.showReferenceHeaders}
							getRowHeaderIndex={(visualRow) => getPhysicalRowForVisualRow(visualRow)}
							getRowHeaderTooltip={(visualRow) =>
								isViewSortActive() ? `View row ${visualRow + 1}` : null
							}
							onRowResizeStart={handleRowResizeStart}
							activeResizeRow={activeResizeRow()}
							virtualRows={virtualRows()}
							totalHeight={rowMetrics().getTotalHeight()}
							getDisplayValue={getDisplayCellValue}
							getRawValue={getRawCellValue}
							editingAddress={props.store.editMode()?.address ?? null}
							onCellMouseDown={handleCellMouseDown}
							onCellMouseEnter={handleCellMouseEnter}
							onRowHeaderMouseDown={handleRowHeaderMouseDown}
							onCellDblClick={handleCellDblClick}
							pinnedLeftOffsets={pinnedLeftOffsets()}
							lastPinnedIndex={lastPinnedIndex()}
							readOnly={props.readOnly}
							searchMatchSet={searchMatchSet()}
							searchCurrentAddress={searchCurrentAddress()}
						/>

						<Show when={columnResizeGuideLeft() !== null}>
							<div
								class="se-resize-guide se-resize-guide--column"
								style={{ left: `${columnResizeGuideLeft()!}px` }}
							/>
						</Show>

						<Show when={rowResizeGuideTop() !== null}>
							<div
								class="se-resize-guide se-resize-guide--row"
								style={{ top: `${rowResizeGuideTop()!}px`, left: `${rowGutterWidth()}px` }}
							/>
						</Show>

						<SelectionOverlay
							selection={props.store.selection()}
							clipboardRange={clipboardRange()}
							referenceRange={referenceRange()}
							externalReferenceRange={externalReferenceRange()}
							fillPreview={fillDragState()?.preview ?? null}
							showFillHandle={showFillHandle()}
							columnOffsets={columnBoundaryOffsets()}
							rowMetrics={rowMetrics()}
							scrollLeft={0}
							scrollTop={0}
							leftOffset={rowGutterWidth()}
							onFillHandleMouseDown={handleFillHandleMouseDown}
						/>

						<Show when={props.store.editMode() && editCellRect()}>
							{(_rect) => (
								<CellEditor
									value={editorText()}
									inputRef={(element) => {
										cellEditorInputRef = element;
									}}
									left={editCellRect()!.left}
									top={editCellRect()!.top}
									width={editCellRect()!.width}
									height={editCellRect()!.height}
									onInput={updateEditorText}
									onSelectionChange={(start, end) => setEditorSelection(start, end)}
									onCommit={handleEditorCommit}
									onCancel={handleEditCancel}
									onTab={handleEditTab}
									onEnter={handleEditEnter}
									onArrowNav={handleEditArrowNav}
								/>
							)}
						</Show>
					</Show>
				</div>
			</div>

			<Show when={searchOpen()}>
				<SearchBar
					query={searchQuery()}
					matchCount={searchMatches().length}
					currentMatchIndex={searchCurrentIndex()}
					onQueryChange={(q) => setSearchQuery(q)}
					onNext={handleSearchNext}
					onPrev={handleSearchPrev}
					onClose={handleSearchClose}
				/>
			</Show>

			<Show when={contextMenu()}>
				{(pos) => (
					<ContextMenu
						x={pos().x}
						y={pos().y}
						items={contextMenuItems()}
						onClose={() => setContextMenu(null)}
					/>
				)}
			</Show>
		</div>
	);
}
