import { createComputed, createEffect, createMemo, createSignal, createUniqueId, on, onCleanup, onMount, Show, untrack } from "solid-js";
import type { JSX } from "solid-js";
import { unwrap } from "solid-js/store";
import {
	Virtualizer,
	elementScroll,
	observeElementOffset,
	observeElementRect,
} from "@tanstack/solid-virtual";
import type { VirtualItem, VirtualizerOptions } from "@tanstack/solid-virtual";
import type {
	CellMutation,
	CellRange,
	CellValue,
	CellWrite,
	ColumnDef,
	PhysicalCellAddress,
	ResizeMode,
	ResizeSessionState,
	RowReorderMutation,
	Selection,
	SheetController,
	SheetProps,
	SortBehavior,
	SortDirection,
	SortState,
	VisualCellAddress,
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
import {
	coordinateBatchMutations,
	coordinateHistoryCommand,
	type FormulaSyncPort,
} from "./mutationCoordination";
import { getWorkbookCoordinatorInternals } from "../workbook/coordinator";
import GridHeader from "./GridHeader";
import GridBody from "./GridBody";
import CellEditor from "./CellEditor";
import FormulaBar from "./FormulaBar";
import SelectionOverlay from "./SelectionOverlay";
import ContextMenu, { type ContextMenuEntry } from "./ContextMenu";
import SearchBar from "./SearchBar";
import { createActiveSearchScanSource, createMatchSet, findMatchesChunked } from "../core/search";
import { buildRowMetrics } from "./rowMetrics";
import { buildIndexOrder, compareSortableEntries } from "./sort";
import type { WorkbookSheetBinding } from "../workbook/types";
import { type ColumnIndex, type PhysicalRowIndex, type RowId, type VisualRowIndex, columnIdx, physicalRow, rowId, toNumber, visualRow } from "../core/brands";

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
	onOperation?: SheetProps["onOperation"] | undefined;
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
	onCellPointerDown?: SheetProps["onCellPointerDown"] | undefined;
	onCellPointerMove?: SheetProps["onCellPointerMove"] | undefined;
	controllerRef?: SheetProps["ref"] | undefined;
	sortBehavior: SortBehavior;
	sortState?: SortState | null | undefined;
	defaultSortState: SortState | null;
	rootClass: string | undefined;
	ariaLabel: string;
	emptyState: JSX.Element | undefined;
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

type ContextMenuState =
	| { x: number; y: number; kind: "grid" }
	| { x: number; y: number; kind: "column-header"; col: ColumnIndex };

type VirtualItemSnapshot = Pick<VirtualItem, "index" | "start" | "size">;
type GridVirtualizer = Virtualizer<HTMLDivElement, HTMLElement>;

function snapshotVirtualItems<TScrollElement extends Element, TItemElement extends Element>(
	virtualizer: Virtualizer<TScrollElement, TItemElement>,
): VirtualItemSnapshot[] {
	return virtualizer.getVirtualItems().map((item) => ({
		index: item.index,
		start: item.start,
		size: item.size,
	}));
}

function hasUsableRect(rect: { width: number; height: number } | null): boolean {
	return Boolean(rect && rect.width > 0 && rect.height > 0);
}

export default function Grid(props: GridProps) {
	const customization = useSheetCustomization();
	const gridInstanceId = createUniqueId().replaceAll(":", "");
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
	const [mutationSortBaseOrder, setMutationSortBaseOrder] = createSignal<RowId[] | null>(null);
	const [contextMenu, setContextMenu] = createSignal<ContextMenuState | null>(null);
	const [clipboardRange, setClipboardRange] = createSignal<CellRange | null>(null);
	const [editorText, setEditorText] = createSignal("");
	const [editorSource, setEditorSource] = createSignal<"cell" | "formula-bar">("cell");
	const [editorCaret, setEditorCaret] = createSignal<CaretRange>({ start: 0, end: 0 });
	const [pendingCaret, setPendingCaret] = createSignal<CaretRange | null>(null);
	const [referenceRange, setReferenceRange] = createSignal<CellRange | null>(null);
	const [referenceInsertion, setReferenceInsertion] = createSignal<CaretRange | null>(null);
	const [isReferenceDragging, setIsReferenceDragging] = createSignal(false);
	const [referenceDragAnchor, setReferenceDragAnchor] = createSignal<VisualCellAddress | null>(null);
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
			? recordToMap<RowId>(props.rowSizing, (key) => rowId(key))
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

	const visualRowIds = createMemo<RowId[] | null>(() => {
		if (!isViewSortActive()) return null;

		const sort = currentSortState();
		if (!sort) return null;

		const columnIndex = props.columns.findIndex((column) => column.id === sort.columnId);
		if (columnIndex < 0) return null;

		const currentRowIds = props.store.rowIds();
		const nextOrder = currentRowIds.map((rowId, physical) => ({
			rowId,
			physicalRow: physicalRow(physical),
			value: getSortComparableValue(physicalRow(physical), columnIdx(columnIndex)),
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

	const rowMetrics = createMemo(() => {
		const heightOverrides = new Map<number, number>();
		for (const [id, height] of committedRowHeights()) {
			const visual = getVisualRowForRowId(id);
			if (visual === null) continue;
			heightOverrides.set(toNumber(visual), height);
		}
		return buildRowMetrics(props.store.rowCount(), props.rowHeight, heightOverrides);
	});
	// Keep explicit snapshots from the virtualizer callback. The Solid adapter's
	// proxied item store can miss an invalidation when a synchronous external
	// update (such as formula-engine initialization) interleaves with mounting.
	// TanStack still owns all measurement, range, and scroll calculations.
	const [virtualRows, setVirtualRows] = createSignal<VirtualItemSnapshot[]>([]);
	const [virtualColumnItems, setVirtualColumnItems] = createSignal<VirtualItemSnapshot[]>([]);

	function rowVirtualizerOptions(): VirtualizerOptions<HTMLDivElement, HTMLElement> {
		return {
			count: props.store.rowCount(),
			getScrollElement: () => viewportRef ?? null,
			estimateSize: (index) => rowMetrics().getRowHeight(visualRow(index)),
			observeElementRect,
			observeElementOffset,
			scrollToFn: elementScroll,
			overscan: 3,
			onChange: (instance) => {
				setVirtualRows(snapshotVirtualItems(instance));
			},
		};
	}

	function columnVirtualizerOptions(): VirtualizerOptions<HTMLDivElement, HTMLElement> {
		return {
			count: props.columns.length,
			getScrollElement: () => viewportRef ?? null,
			estimateSize: (index) => columnWidths()[index] ?? DEFAULT_COL_WIDTH,
			observeElementRect,
			observeElementOffset,
			scrollToFn: elementScroll,
			horizontal: true,
			overscan: 2,
			onChange: (instance) => {
				setVirtualColumnItems(snapshotVirtualItems(instance));
			},
		};
	}

	// Own the core virtualizer lifecycle at the Grid component boundary. The
	// Solid adapter registers its cleanup inside an onMount effect; lazy route
	// and Suspense lifecycles can dispose that effect while preserving the DOM
	// branch, leaving the core instance detached from its still-live viewport.
	const rowVirtualizer = new Virtualizer<HTMLDivElement, HTMLElement>(rowVirtualizerOptions());
	const columnVirtualizer = new Virtualizer<HTMLDivElement, HTMLElement>(columnVirtualizerOptions());
	const disposeRowVirtualizer = rowVirtualizer._didMount();
	const disposeColumnVirtualizer = columnVirtualizer._didMount();
	let viewportObserver: ResizeObserver | null = null;
	let virtualizerAttachTimer: ReturnType<typeof setTimeout> | undefined;

	createComputed(() => {
		rowVirtualizer.setOptions(rowVirtualizerOptions());
		rowVirtualizer._willUpdate();
		setVirtualRows(snapshotVirtualItems(rowVirtualizer));
	});
	createComputed(() => {
		columnVirtualizer.setOptions(columnVirtualizerOptions());
		columnVirtualizer._willUpdate();
		setVirtualColumnItems(snapshotVirtualItems(columnVirtualizer));
	});

	function attachVirtualizer(virtualizer: GridVirtualizer, viewport: HTMLDivElement): void {
		const expectedWindow = viewport.ownerDocument.defaultView;
		const viewportRect = viewport.getBoundingClientRect();
		const staleAttachment = virtualizer.scrollElement === viewport && (
			virtualizer.targetWindow !== expectedWindow
			|| (!hasUsableRect(virtualizer.scrollRect) && viewportRect.width > 0 && viewportRect.height > 0)
		);

		if (staleAttachment) {
			// _willUpdate only attaches when the element identity changes. Clear
			// the stale identity first so core reinstalls its window and observers.
			virtualizer._didMount()();
		}
		virtualizer._willUpdate();
	}

	function attachAndSnapshotVirtualizers(): void {
		if (!viewportRef) return;
		attachVirtualizer(rowVirtualizer, viewportRef);
		attachVirtualizer(columnVirtualizer, viewportRef);
		rowVirtualizer.measure();
		columnVirtualizer.measure();
		setVirtualRows(snapshotVirtualItems(rowVirtualizer));
		setVirtualColumnItems(snapshotVirtualItems(columnVirtualizer));
	}

	onMount(() => {
		if (!viewportRef) return;
		attachAndSnapshotVirtualizers();
		// A lazy route or Suspense owner can tear down TanStack's observation
		// after child mounts have run but before the browser reaches its next
		// task. Repeat attachment there so the final lifecycle state wins.
		virtualizerAttachTimer = setTimeout(attachAndSnapshotVirtualizers, 0);
		const targetWindow = viewportRef.ownerDocument.defaultView;
		if (targetWindow?.ResizeObserver) {
			viewportObserver = new targetWindow.ResizeObserver(attachAndSnapshotVirtualizers);
			viewportObserver.observe(viewportRef);
		}
	});

	onCleanup(() => {
		if (virtualizerAttachTimer !== undefined) {
			clearTimeout(virtualizerAttachTimer);
		}
		viewportObserver?.disconnect();
		disposeRowVirtualizer();
		disposeColumnVirtualizer();
	});

	createEffect(
		on(rowMetrics, () => {
			rowVirtualizer.measure();
		}),
	);
	createEffect(
		on(columnWidths, () => {
			columnVirtualizer.measure();
		}),
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

	function getPhysicalRowForVisualRow(visualRow: VisualRowIndex): PhysicalRowIndex {
		if (!isViewSortActive()) return physicalRow(toNumber(visualRow));
		const id = visualRowIds()?.[toNumber(visualRow)];
		if (id === undefined) return physicalRow(toNumber(visualRow));
		return props.store.getPhysicalRowForRowId(id) ?? physicalRow(toNumber(visualRow));
	}

	function getVisualRowForPhysicalRow(physicalRowIdx: PhysicalRowIndex): VisualRowIndex {
		if (!isViewSortActive()) return visualRow(toNumber(physicalRowIdx));
		const id = props.store.getRowIdAtPhysicalRow(physicalRowIdx);
		if (id === null) return visualRow(toNumber(physicalRowIdx));
		return getVisualRowForRowId(id) ?? visualRow(toNumber(physicalRowIdx));
	}

	function getRowIdAtVisualRow(visualRow: VisualRowIndex): RowId | null {
		if (!isViewSortActive()) return props.store.getRowIdAtPhysicalRow(physicalRow(toNumber(visualRow)));
		return visualRowIds()?.[toNumber(visualRow)] ?? null;
	}

	function getStableRowIdAtVisualRow(visualRowIndex: VisualRowIndex): RowId {
		const id = getRowIdAtVisualRow(visualRowIndex);
		if (id !== null) return id;

		// A virtual item can briefly outlive a row-count reconciliation. Keep that
		// render frame non-fatal; the tracked row-ID lookup re-runs as soon as the
		// store and virtualizer settle on the same row set.
		return rowId(String(toNumber(getPhysicalRowForVisualRow(visualRowIndex))));
	}

	function getCellId(address: VisualCellAddress): string {
		return `ps-${gridInstanceId}-cell-${toNumber(address.row)}-${toNumber(address.col)}`;
	}

	function getVisualRowForRowId(id: RowId): VisualRowIndex | null {
		const activeVisualRowIds = visualRowIds();
		if (!activeVisualRowIds) {
			const physical = props.store.getPhysicalRowForRowId(id);
			return physical !== null ? visualRow(toNumber(physical)) : null;
		}

		const visualIndex = activeVisualRowIds.indexOf(id);
		return visualIndex >= 0 ? visualRow(visualIndex) : null;
	}

	function getCommittedColumnWidth(columnId: string): number {
		return getColumnWidth(columnId, props.columns, committedColumnWidths());
	}

	function getCommittedRowHeight(id: RowId): number {
		return committedRowHeights().get(id) ?? props.rowHeight;
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

	function updateCommittedRowHeight(id: RowId, height: number) {
		if (props.rowSizing === undefined) {
			props.store.setRowHeight(id, height);
		}
		props.onRowSizingChange?.({
			...rowSizingRecord(),
			[id]: height,
		});
	}

	function commitColumnResize(columnId: string, width: number) {
		updateCommittedColumnWidth(columnId, width);
		props.onColumnResize?.(columnId, width);
	}

	function commitRowResize(id: RowId, height: number) {
		updateCommittedRowHeight(id, height);
		props.onRowResize?.(id, height);
	}

	function notifyColumnResizeState(columnId: string, width: number) {
		props.onColumnSizingChange?.(mapToRecord(props.store.columnWidths()));
		props.onColumnResize?.(columnId, width);
	}

	function notifyRowResizeState(id: RowId, height: number) {
		props.onRowSizingChange?.(mapToRecord(props.store.rowHeights()));
		props.onRowResize?.(id, height);
	}

	function getSortComparableValue(physicalRow: PhysicalRowIndex, col: ColumnIndex): string | number | boolean | null {
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
	const [searchMatches, setSearchMatches] = createSignal<PhysicalCellAddress[]>([]);

	createEffect(
		on(searchQuery, (query) => {
			const timeout = setTimeout(() => setDebouncedSearchQuery(query), 180);
			onCleanup(() => clearTimeout(timeout));
		}),
	);

	const activeSearchScan = createActiveSearchScanSource({
		query: debouncedSearchQuery,
		rowCount: () => props.store.rowCount(),
		colCount: () => props.store.colCount(),
		dataRevision: () => props.store.dataRevision(),
		formulaRevision: () => props.formulaBridge?.revision() ?? 0,
	});

	createEffect(
		on(activeSearchScan, (scan) => {
				if (!scan) {
					setSearchMatches((matches) => matches.length === 0 ? matches : []);
					return;
				}
				let cancelled = false;

				void findMatchesChunked(
					getDisplayCellValueForPhysicalRow,
					scan.rowCount,
					scan.colCount,
					scan.query,
					{ isCancelled: () => cancelled },
				).then((matches) => {
					if (!cancelled) setSearchMatches(matches);
				});

				onCleanup(() => {
					cancelled = true;
				});
			}),
	);
	const virtualColumns = createMemo(() => {
		const rendered = new Map<number, { index: number; start: number; size: number; column: ColumnDef }>();
		for (const item of virtualColumnItems()) {
			const column = props.columns[item.index];
			if (column) rendered.set(item.index, { index: item.index, start: item.start, size: item.size, column });
		}
		for (let index = 0; index < props.columns.length; index++) {
			const column = props.columns[index];
			if (!column || column.pinned !== "left" || rendered.has(index)) continue;
			rendered.set(index, {
				index,
				start: columnRightOffsets()[index - 1] ?? 0,
				size: columnWidths()[index] ?? DEFAULT_COL_WIDTH,
				column,
			});
		}
		return [...rendered.values()].sort((left, right) => left.index - right.index);
	});

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
		on(searchCurrentAddress, (physicalAddr) => {
			if (!physicalAddr || !viewportRef) return;
			const visualRow = getVisualRowForPhysicalRow(physicalAddr.row);
			const top = rowMetrics().getRowTop(visualRow);
			let left = 0;
			for (let c = 0; c < physicalAddr.col; c++) {
				left += untrack(columnWidths)[c] ?? DEFAULT_COL_WIDTH;
			}
			viewportRef.scrollTo({ top, left });
		}),
	);

	function scrollCellIntoView(addr: VisualCellAddress) {
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
		return session?.axis === "column" ? session.columnTargetId ?? null : null;
	});
	const activeResizeRow = createMemo(() => {
		const session = resizeSession();
		if (session?.axis !== "row") return null;
		const rowId = session.rowTargetId;
		if (rowId === undefined) return null;
		return getVisualRowForRowId(rowId);
	});
	const columnResizeGuideLeft = createMemo(() => {
		const session = resizeSession();
		if (session?.axis !== "column") return null;
		const columnId = session.columnTargetId;
		if (!columnId) return null;
		const columnIndex = props.columns.findIndex((column) => column.id === columnId);
		if (columnIndex < 0) return null;
		const left = columnLeftOffsets()[columnIndex] ?? rowGutterWidth();
		return left + session.previewSize;
	});
	const rowResizeGuideTop = createMemo(() => {
		const session = resizeSession();
		if (session?.axis !== "row") return null;
		const rowId = session.rowTargetId;
		if (rowId === undefined) return null;
		const visualRow = getVisualRowForRowId(rowId);
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
		return customization?.getAddressLabel?.(addr.row, addr.col) ?? addressToA1(selectedAddress());
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
		address: VisualCellAddress,
		oldOrder: RowId[],
		newOrder: RowId[],
	): VisualCellAddress | null {
		const id = oldOrder[toNumber(address.row)];
		if (id === undefined) return null;
		const nextRow = newOrder.indexOf(id);
		if (nextRow < 0) return null;
		return { row: visualRow(nextRow), col: address.col };
	}

	function remapSelectionForRowOrder(
		selection: Selection,
		oldOrder: RowId[],
		newOrder: RowId[],
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
		oldOrder: RowId[],
		newOrder: RowId[],
	): ReturnType<SheetStore["editMode"]> {
		if (!mode) return mode;
		const nextAddress = remapAddressForRowOrder(mode.address, oldOrder, newOrder);
		if (!nextAddress) return null;
		return {
			...mode,
			address: nextAddress,
		};
	}

	let previousRenderedRowOrder: RowId[] | null = null;

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
			} else if (nextRenderedOrder.length > 0 && props.columns.length > 0) {
				props.store.setSelection(selectCell({ row: visualRow(0), col: columnIdx(0) }));
			} else {
				props.store.setSelection(emptySelection());
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

	function getRawCellValueForPhysicalRow(row: PhysicalRowIndex, col: ColumnIndex): CellValue {
		// Subscribe to row/structural revisions instead of Solid deep-store cell paths.
		// Tracked `cells[r][c]` reads permanently allocate store $NODE signals for every
		// traversed cell (Solid store bookkeeping), which dominated scroll retention.
		props.store.structuralRevision();
		const id = untrack(() => props.store.getRowIdAtPhysicalRow(row));
		if (id !== null) {
			props.store.rowRevision(id);
		}
		return untrack(() => {
			const rawCells = unwrap(props.store.cells);
			return rawCells[toNumber(row)]?.[toNumber(col)] ?? null;
		});
	}

	function getDisplayCellValueForPhysicalRow(row: PhysicalRowIndex, col: ColumnIndex): CellValue {
		const rawValue = getRawCellValueForPhysicalRow(row, col);
		if (props.formulaBridge && typeof props.formulaBridge.revision === "function") {
			props.formulaBridge.revision();
		}
		return props.formulaBridge?.getDisplayValue(row, col, rawValue) ?? rawValue;
	}

	function getRawCellValue(row: VisualRowIndex, col: ColumnIndex): CellValue {
		return getRawCellValueForPhysicalRow(getPhysicalRowForVisualRow(row), col);
	}

	function getDisplayCellValue(row: VisualRowIndex, col: ColumnIndex): CellValue {
		return getDisplayCellValueForPhysicalRow(getPhysicalRowForVisualRow(row), col);
	}

	function markWorkbookEngineUnconfirmed() {
		const binding = props.workbook;
		if (!binding) return;
		getWorkbookCoordinatorInternals(binding.coordinator)
			.markEngineContentUnconfirmed(binding.sheetKey);
	}

	function didApplyFormulaBridgeOperation(
		result:
			| ReturnType<FormulaBridge["ensureSheet"]>
			| ReturnType<FormulaBridge["syncAll"]>
			| ReturnType<FormulaBridge["setCell"]>
			| ReturnType<FormulaBridge["setCells"]>
			| ReturnType<FormulaBridge["setRowOrder"]>
			| null
			| undefined,
	): boolean {
		if (!props.formulaBridge) return true;
		const applied = Boolean(result && Result.isOk(result) && isApplied(result.value));
		if (applied) {
			markWorkbookEngineUnconfirmed();
		}
		return applied;
	}

	function didApplyResult<T, Reason extends string, Error>(
		result: ResultLike<OperationOutcome<T, Reason>, Error>,
	): boolean {
		return Result.isOk(result) && isApplied(result.value);
	}

	function getFormulaSyncPort(): FormulaSyncPort | null {
		const bridge = props.formulaBridge;
		if (!bridge) return null;
		return {
			syncAll: (cells) => {
				const result = bridge.syncAll(cells);
				if (Result.isOk(result) && isApplied(result.value)) {
					markWorkbookEngineUnconfirmed();
				}
				return result;
			},
			setCells: (mutations) => {
				const result = bridge.setCells(mutations);
				if (Result.isOk(result) && isApplied(result.value)) {
					markWorkbookEngineUnconfirmed();
				}
				return result;
			},
			setRowOrder: (indexOrder) => {
				const result = bridge.setRowOrder(indexOrder);
				if (Result.isOk(result) && isApplied(result.value)) {
					markWorkbookEngineUnconfirmed();
				}
				return result;
			},
		};
	}

	function syncAllToFormulaEngine(): boolean {
		if (!props.formulaBridge) return true;
		return didApplyFormulaBridgeOperation(
			props.formulaBridge?.syncAll(props.store.cells),
		);
	}

	function syncRowOrderToFormulaEngine(indexOrder: PhysicalRowIndex[]): boolean {
		if (!props.formulaBridge) return true;
		return didApplyFormulaBridgeOperation(
			props.formulaBridge?.setRowOrder(indexOrder.map(toNumber)),
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

	function applyLocalHistoryCommand(direction: "undo" | "redo"): void {
		coordinateHistoryCommand({
			beginTransition: () =>
				direction === "undo" ? props.store.beginUndo() : props.store.beginRedo(),
			getCells: () => props.store.cells,
			emitOperation: (operation) => {
				props.onOperation?.(operation);
			},
			formula: getFormulaSyncPort(),
			...(props.columnSizing === undefined
				? {
						onColumnResize: (columnId: string, width: number) => {
							notifyColumnResizeState(columnId, width);
						},
					}
				: {}),
			...(props.rowSizing === undefined
				? {
						onRowResize: (id: RowId, height: number) => {
							notifyRowResizeState(id, height);
						},
					}
				: {}),
		});
	}

	function buildCellMutation(
		viewAddress: VisualCellAddress,
		newValue: CellValue,
		source: CellMutation["source"],
	): CellMutation | null {
		const column = props.columns[toNumber(viewAddress.col)];
		if (!column) return null;

		const physical = getPhysicalRowForVisualRow(viewAddress.row);
		const id = getRowIdAtVisualRow(viewAddress.row) ?? props.store.getRowIdAtPhysicalRow(physical);
		const oldValue = getRawCellValueForPhysicalRow(physical, viewAddress.col);

		if (oldValue === newValue) return null;

		return {
			address: { row: physical, col: viewAddress.col },
			viewAddress,
			...(id != null ? { rowId: id } : {}),
			columnId: column.id,
			oldValue,
			newValue,
			source,
		};
	}

	function applyBatchMutations(mutations: CellMutation[]) {
		coordinateBatchMutations(
			{
				applyMutations: (batch) => applyMutations(props.store, batch),
				emitOperation: (operation) => {
					props.onOperation?.(operation);
				},
				formula: getFormulaSyncPort(),
			},
			mutations,
		);
	}

	function buildExternalBatchMutations(writes: readonly CellWrite[]): CellMutation[] {
		const latestWrites = new Map<string, CellWrite>();
		for (const write of writes) {
			latestWrites.set(`${write.row},${write.col}`, write);
		}

		const mutations: CellMutation[] = [];
		for (const write of latestWrites.values()) {
			const mutation = buildCellMutation(
				{ row: visualRow(write.row), col: columnIdx(write.col) },
				write.value,
				"external",
			);
			if (mutation) mutations.push(mutation);
		}
		return mutations;
	}

	function setEditorSelection(start: number, end: number = start) {
		setEditorCaret({ start, end });
	}

	function setEditorSelectionAndFocus(start: number, end: number = start) {
		setEditorCaret({ start, end });
		setPendingCaret({ start, end });
	}

	function startEditing(
		addr: VisualCellAddress,
		options?: {
			initialText?: string;
			source?: "cell" | "formula-bar";
			selectAll?: boolean;
		},
	) {
		if (props.readOnly) return;
		const colDef = props.columns[toNumber(addr.col)];
		if (colDef?.editable === false) return;

		const rawValue = getRawCellValue(addr.row, addr.col);
		warnIfFormatValueWithoutParseValue(colDef);
		const seedText = colDef?.formatValue
			? colDef.formatValue(rawValue, { row: toNumber(addr.row), col: toNumber(addr.col) })
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

		insertReferenceText(rangeToA1(normalized), normalized);
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

	function focusGridAfterNavigate() {
		queueMicrotask(() => {
			gridRef?.focus();
		});
	}

	function focusOutsideGrid(backwards: boolean) {
		const grid = gridRef;
		if (!grid) return;

		const selector = [
			'a[href]',
			'button:not([disabled])',
			'input:not([disabled])',
			'select:not([disabled])',
			'textarea:not([disabled])',
			'[tabindex]:not([tabindex="-1"])',
		].join(',');
		const candidates = Array.from(document.querySelectorAll<HTMLElement>(selector))
			.filter((element) => !grid.contains(element) && element.getClientRects().length > 0);
		const ordered = backwards ? candidates.reverse() : candidates;
		const relation = backwards
			? Node.DOCUMENT_POSITION_PRECEDING
			: Node.DOCUMENT_POSITION_FOLLOWING;
		const target = ordered.find((element) => Boolean(grid.compareDocumentPosition(element) & relation));

		if (target) {
			target.focus();
		} else {
			grid.blur();
		}
	}

	function canNavigateSelection(direction: "up" | "down" | "left" | "right"): boolean {
		const current = props.store.selection();
		const next = moveSelection(current, direction, false, false, {
			rowCount: props.store.rowCount(),
			colCount: props.store.colCount(),
		});
		return next.anchor.row !== current.anchor.row || next.anchor.col !== current.anchor.col;
	}

	function handleEditorCommit(options?: { refocus?: boolean }) {
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
			props.onOperation?.({ type: "cell-edit", mutation });
		}

		if (options?.refocus !== false) {
			focusGrid();
		}
	}

	function handleEditCancel() {
		props.store.setEditMode(null);
		setReferenceInsertion(null);
		setReferenceRange(null);
		focusGrid();
	}

	function handleEditTab(shift: boolean) {
		const direction = shift ? "left" : "right";
		if (!canNavigateSelection(direction)) {
			queueMicrotask(() => focusOutsideGrid(shift));
			return;
		}
		handleNavigateAfterEdit(direction);
		focusGridAfterNavigate();
	}

	function handleEditEnter(shift: boolean) {
		handleNavigateAfterEdit(shift ? "up" : "down");
		focusGridAfterNavigate();
	}

	function handleEditArrowNav(direction: "up" | "down" | "left" | "right") {
		handleNavigateAfterEdit(direction);
		focusGridAfterNavigate();
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

	function handleCellDblClick(addr: VisualCellAddress) {
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

	function getGridAddressFromViewportEvent(event: MouseEvent): VisualCellAddress | null {
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
		return { row: visualRow(row), col: columnIdx(col) };
	}

	function handleCellMouseDown(addr: VisualCellAddress, event: MouseEvent) {
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

		focusGrid();
	}

	function handleCellMouseEnter(addr: VisualCellAddress, event: MouseEvent) {
		props.onCellPointerMove?.(addr, event);
	}

	function handleRowHeaderMouseDown(row: VisualRowIndex, event: MouseEvent) {
		if (event.button !== 2) {
			event.preventDefault();
		}
		if (isReferenceSelectionMode() || props.store.colCount() === 0) return;
		if (props.store.editMode()) handleEditorCommit();
		props.store.setSelection({
			ranges: [{
				start: { row, col: columnIdx(0) },
				end: { row, col: columnIdx(props.store.colCount() - 1) },
			}],
			anchor: { row, col: columnIdx(0) },
			focus: { row, col: columnIdx(props.store.colCount() - 1) },
			editing: null,
		});
		focusGrid();
	}

	function handleColumnHeaderMouseDown(col: ColumnIndex, event: MouseEvent) {
		if (event.button !== 2) {
			event.preventDefault();
		}
		if (isReferenceSelectionMode() || props.store.rowCount() === 0) return;
		if (props.store.editMode()) handleEditorCommit();
		props.store.setSelection({
			ranges: [{
				start: { row: visualRow(0), col },
				end: { row: visualRow(props.store.rowCount() - 1), col },
			}],
			anchor: { row: visualRow(0), col },
			focus: { row: visualRow(props.store.rowCount() - 1), col },
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
		props.store.setSelection(extendSelection(sel.anchor, { row: visualRow(row), col: columnIdx(col) }));
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
			for (let r = normalized.start.row; r <= normalized.end.row; r++) {
				for (let c = normalized.start.col; c <= normalized.end.col; c++) {
					const column = props.columns[toNumber(c)];
					if (!column || column.editable === false) continue;

					const mutation = buildCellMutation({ row: visualRow(toNumber(r)), col: columnIdx(toNumber(c)) }, null, "delete");
					if (mutation) mutations.push(mutation);
				}
			}
		}

		return mutations;
	}

	function buildPasteMutationsForSelection(
		parsed: CellValue[][],
		target: VisualCellAddress,
	): CellMutation[] {
		const mutations: CellMutation[] = [];

		for (let r = 0; r < parsed.length; r++) {
			const pasteRow = parsed[r];
			if (!pasteRow) continue;

			for (let c = 0; c < pasteRow.length; c++) {
				const viewAddress: VisualCellAddress = { row: visualRow(toNumber(target.row) + r), col: columnIdx(toNumber(target.col) + c) };
				const column = props.columns[toNumber(viewAddress.col)];
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
				(_, rowOffset) => getRawCellValue(visualRow(toNumber(source.start.row) + rowOffset), columnIdx(col)),
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
				const sourceValue = getRawCellValue(visualRow(sourceRow), columnIdx(col));
				const columnState = columnStates[col - source.start.col]!;
				let nextValue: CellValue;

				switch (columnState.mode) {
					case "formula-copy":
						if (typeof sourceValue === "string" && isFormulaValue(sourceValue)) {
							nextValue = shiftFormulaByDelta(
								sourceValue,
								getPhysicalRowForVisualRow(visualRow(row)) - getPhysicalRowForVisualRow(visualRow(sourceRow)),
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
				col: columnIdx(columnIndex),
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
			const coordinator = workbookCoordinator();
			if (!coordinator) return;
			const change = coordinator.insertRows(sheetKey, physicalRow(atIndex), count);
			if (didApplyResult(change)) {
				props.onOperation?.({ type: "row-insert", atIndex, count });
			}
			focusGrid();
			return;
		}
		const selBefore = props.store.selection();
		const cellsBefore = props.store.cells.map((row) => [...row]);
		const rowIdsBefore = [...props.store.rowIds()];
		props.store.insertRows(physicalRow(atIndex), count);
		if (!syncAllToFormulaEngine()) {
			props.store.restoreSnapshot(cellsBefore, rowIdsBefore);
			return;
		}
		props.store.pushRowOperation(
			{ type: "insertRows", atIndex, count },
			selBefore,
			props.store.selection(),
		);
		props.onOperation?.({ type: "row-insert", atIndex, count });
		focusGrid();
	}

	function handleDeleteRows(atIndex: number, count: number) {
		if (isViewSortActive() && count !== 1) return;

		const physicalAtIndex = getPhysicalRowForVisualRow(visualRow(atIndex));
		if (props.workbook) {
			const sheetKey = workbookSheetKey();
			if (!sheetKey) return;
			const coordinator = workbookCoordinator();
			if (!coordinator) return;
			const change = coordinator.deleteRows(sheetKey, physicalAtIndex, count);
			if (didApplyResult(change)) {
				props.onOperation?.({ type: "row-delete", atIndex: physicalAtIndex, count });
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
				selectCell({ row: visualRow(clampedRow), col: selBefore.anchor.col }),
			);
		}

		props.store.pushRowOperation(
			{ type: "deleteRows", atIndex: physicalAtIndex, count, removedData, previousCells },
			selBefore,
			props.store.selection(),
		);
		props.onOperation?.({ type: "row-delete", atIndex: physicalAtIndex, count });
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
					void navigator.clipboard.readText().then(
						(text) => handlePaste(text),
						() => {
							// Clipboard access denied — silently fail as per security best practices
							// This is expected in secure contexts and sandboxed environments
						},
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
		nextOrder: RowId[],
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
			const coordinator = workbookCoordinator();
			if (!coordinator) return;
			const change = coordinator.setRowOrder(sheetKey, reorderEvent.indexOrder);
			if (!didApplyResult(change)) return;
			props.onOperation?.({ type: "row-reorder", mutation: reorderEvent });
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
		props.onOperation?.({ type: "row-reorder", mutation: reorderEvent });
	}

	function applyMutationSort(sort: SortState | null, options?: { baseOrder?: RowId[] | null }) {
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
			.map((rowId, physicalIdx) => ({
				rowId,
				physicalRow: physicalRow(physicalIdx),
				value: getSortComparableValue(physicalRow(physicalIdx), columnIdx(columnIndex)),
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
		if (command.type === "editCommit" && !canNavigateSelection(command.direction)) {
			event.preventDefault();
			focusOutsideGrid(command.direction === "left");
			return;
		}

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
				focusGridAfterNavigate();
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
				if (props.workbook && workbookCoordinator()?.canUndo()) {
					workbookCoordinator()?.undo();
					break;
				}
				applyLocalHistoryCommand("undo");
				break;
			}

			case "redo": {
				if (props.workbook && workbookCoordinator()?.canRedo()) {
					workbookCoordinator()?.redo();
					break;
				}
				applyLocalHistoryCommand("redo");
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
			columnTargetId: columnId,
			startPointerOffset: event.clientX,
			startSize,
			currentDelta: 0,
			previewSize: startSize,
			isActive: true,
		});
	}

	function handleRowResizeStart(vRow: number, event: MouseEvent) {
		if (event.button !== 0) return;
		const id = getRowIdAtVisualRow(visualRow(vRow));
		if (id === null) return;

		setContextMenu(null);
		captureViewportRect();
		const startSize = getCommittedRowHeight(id);
		setResizeSession({
			axis: "row",
			rowTargetId: id,
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
			const columnId = session.columnTargetId;
			if (!columnId) return false;
			const column = props.columns.find((entry) => entry.id === columnId);
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

		const id = session.rowTargetId;
		if (id === undefined) return false;
		const delta = event.clientY - session.startPointerOffset;
		const previewSize = Math.max(props.rowHeight, session.startSize + delta);
		setResizeSession({
			...session,
			currentDelta: delta,
			previewSize,
		});

		if (props.resizeMode === "onChange") {
			updateCommittedRowHeight(id, previewSize);
		}
		return true;
	}

	function finalizeResizeSession() {
		const session = resizeSession();
		if (!session?.isActive) return;
		const selection = props.store.selection();

		if (session.previewSize !== session.startSize) {
			if (session.axis === "column") {
				const columnId = session.columnTargetId;
				if (!columnId) return;
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
				const id = session.rowTargetId;
				if (id === undefined) return;
				if (props.rowSizing === undefined) {
					props.store.pushRowResize(
						{ rowId: id, oldHeight: session.startSize, newHeight: session.previewSize },
						selection,
						selection,
					);
				}
				if (props.resizeMode === "onEnd") {
					commitRowResize(id, session.previewSize);
				} else {
					props.onRowResize?.(id, session.previewSize);
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
			const el = gridRef;
			el.addEventListener("paste", onPaste);
			onCleanup(() => el.removeEventListener("paste", onPaste));
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
					const stickyTop = headerTotalHeight();
					const top = Math.max(0, rowMetrics().getRowTop(visualRow(row)) - stickyTop);

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
				startEditing: (row, col) => startEditing({ row: visualRow(row), col: columnIdx(col) }),
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
						const mutation = buildCellMutation({ row: visualRow(row), col: columnIdx(col) }, value, "external");
						if (!mutation) return;
						if (!syncMutationToFormulaEngine(mutation)) return;
						applyMutations(props.store, [mutation]);
						props.onOperation?.({ type: "cell-edit", mutation });
					},
					setCellValues: (writes) => {
						applyBatchMutations(buildExternalBatchMutations(writes));
					},
				getColumnMeta: (columnId) =>
					props.columns.find((column) => column.id === columnId)?.meta,
				undo: () => {
					if (props.workbook && workbookCoordinator()?.canUndo()) {
						workbookCoordinator()?.undo();
						return;
					}
					applyLocalHistoryCommand("undo");
				},
				redo: () => {
					if (props.workbook && workbookCoordinator()?.canRedo()) {
						workbookCoordinator()?.redo();
						return;
					}
					applyLocalHistoryCommand("redo");
				},
				insertRows: (atIndex, count) => handleInsertRows(atIndex, count),
				deleteRows: (atIndex, count) => handleDeleteRows(atIndex, count),
				canUndo: () => Boolean(props.workbook && workbookCoordinator()?.canUndo()) || props.store.canUndo(),
				canRedo: () => Boolean(props.workbook && workbookCoordinator()?.canRedo()) || props.store.canRedo(),
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
			class={`se-grid${props.rootClass ? ` ${props.rootClass}` : ""}`}
			role="grid"
			aria-label={props.ariaLabel}
			aria-rowcount={props.store.rowCount()}
			aria-colcount={props.store.colCount()}
			aria-readonly={props.readOnly || undefined}
			aria-activedescendant={
				props.store.rowCount() > 0 && props.store.colCount() > 0
					? getCellId(props.store.selection().focus)
					: undefined
			}
			tabIndex={0}
			onKeyDown={handleKeyDown}
			onContextMenu={handleContextMenu}
		>
			<Show when={props.showFormulaBar && hasFormulaEngine()}>
				<FormulaBar
					address={formulaBarAddress()}
					value={formulaBarValue()}
					readOnly={props.readOnly}
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
					onTab={handleEditTab}
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
								{props.emptyState ?? <span>No data</span>}
							</div>
						}
					>
						<GridBody
							columns={props.columns}
							rowMetrics={rowMetrics()}
							rowGutterWidth={rowGutterWidth()}
							showReferenceHeaders={props.showReferenceHeaders}
							getRowHeaderIndex={(visualRow) => getPhysicalRowForVisualRow(visualRow)}
							getRowId={getStableRowIdAtVisualRow}
							getCellId={getCellId}
							getRowHeaderTooltip={(visualRow) =>
								isViewSortActive() ? `View row ${visualRow + 1}` : null
							}
							onRowResizeStart={handleRowResizeStart}
							activeResizeRow={activeResizeRow()}
							virtualRows={virtualRows()}
							virtualColumns={virtualColumns()}
							totalHeight={rowMetrics().getTotalHeight()}
							getDisplayValue={getDisplayCellValue}
							getRawValue={getRawCellValue}
							editingAddress={props.store.editMode()?.address ?? null}
							selection={props.store.selection()}
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

						<Show when={columnResizeGuideLeft()}>
							{(left) => (
								<div
									class="se-resize-guide se-resize-guide--column"
									style={{ left: `${left}px` }}
								/>
							)}
						</Show>

						<Show when={rowResizeGuideTop()}>
							{(top) => (
								<div
									class="se-resize-guide se-resize-guide--row"
									style={{ top: `${top}px`, left: `${rowGutterWidth()}px` }}
								/>
							)}
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

						<Show when={editCellRect()}>
							{(r) => (
								<CellEditor
									value={editorText()}
									ariaLabel={`Edit ${addressToA1(props.store.editMode()?.address ?? selectedAddress())}`}
									inputRef={(element) => {
										cellEditorInputRef = element;
									}}
									left={r().left}
									top={r().top}
									width={r().width}
									height={r().height}
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
