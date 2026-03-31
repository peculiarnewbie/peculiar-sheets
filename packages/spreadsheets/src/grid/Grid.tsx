import { createEffect, createMemo, createSignal, on, onCleanup, onMount, Show, untrack } from "solid-js";
import { createVirtualizer } from "@tanstack/solid-virtual";
import type {
	CellAddress,
	CellMutation,
	CellRange,
	CellValue,
	ColumnDef,
	Selection,
	SheetController,
} from "../types";
import { DEFAULT_COL_WIDTH, GROUP_HEADER_HEIGHT, HEADER_HEIGHT } from "../types";
import { useSheetCustomization } from "../customization";
import type { SheetStore } from "../core/state";
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
	buildVerticalFillMutations,
	computeFillPreview,
	getAutoFillSourceRange,
} from "../core/autofill";
import { mapKeyToCommand, shouldPreventDefault } from "../core/keys";
import { buildPasteMutations, parseTSV, serializeToTSV } from "../core/clipboard";
import { applyMutations, commitCellEdit, deleteSelectedCells } from "../core/commands";
import type { FormulaBridge } from "../formula/bridge";
import { addressToA1, isFormulaText, rangeToA1 } from "../formula/references";
import GridHeader, { type SortState } from "./GridHeader";
import GridBody from "./GridBody";
import CellEditor from "./CellEditor";
import FormulaBar from "./FormulaBar";
import SelectionOverlay from "./SelectionOverlay";
import ContextMenu, { type ContextMenuItem } from "./ContextMenu";
import SearchBar from "./SearchBar";
import { createMatchSet, findMatches } from "../core/search";

const ROW_GUTTER_WIDTH = 48;

interface GridProps {
	store: SheetStore;
	columns: ColumnDef[];
	rowHeight: number;
	readOnly: boolean;
	formulaBridge?: FormulaBridge | null;
	showFormulaBar: boolean;
	showReferenceHeaders: boolean;
	onSelectionChange?: ((selection: Selection) => void) | undefined;
	onCellEdit?: ((mutation: CellMutation) => void) | undefined;
	onBatchEdit?: ((mutations: CellMutation[]) => void) | undefined;
	onEditModeChange?: ((state: { address: CellAddress; initialValue: CellValue } | null) => void) | undefined;
	onClipboard?: ((payload: {
		action: "copy" | "cut" | "paste";
		range: { start: CellAddress; end: CellAddress };
		text: string;
		cells: CellValue[][];
	}) => void) | undefined;
	onColumnResize?: ((columnId: string, width: number) => void) | undefined;
	onSort?: ((columnId: string, direction: "asc" | "desc") => void) | undefined;
	onCellPointerDown?: ((address: CellAddress, event: MouseEvent) => boolean) | undefined;
	onCellPointerMove?: ((address: CellAddress, event: MouseEvent) => boolean) | undefined;
	controllerRef?: ((controller: SheetController) => void) | undefined;
}

interface CaretRange {
	start: number;
	end: number;
}

function cellValueToEditorText(value: CellValue): string {
	if (value === null) return "";
	return String(value);
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

export default function Grid(props: GridProps) {
	const customization = useSheetCustomization();

	let viewportRef: HTMLDivElement | undefined;
	let cellEditorInputRef: HTMLInputElement | undefined;
	let formulaBarInputRef: HTMLInputElement | undefined;

	const [isDraggingSelection, setIsDraggingSelection] = createSignal(false);
	const [sortState, setSortState] = createSignal<SortState | null>(null);
	const [contextMenu, setContextMenu] = createSignal<{ x: number; y: number } | null>(null);
	const [clipboardRange, setClipboardRange] = createSignal<CellRange | null>(null);
	const [editorText, setEditorText] = createSignal("");
	const [editorSource, setEditorSource] = createSignal<"cell" | "formula-bar">("cell");
	const [editorCaret, setEditorCaret] = createSignal<CaretRange>({ start: 0, end: 0 });
	const [pendingCaret, setPendingCaret] = createSignal<CaretRange | null>(null);
	const [referenceRange, setReferenceRange] = createSignal<CellRange | null>(null);
	const [referenceInsertion, setReferenceInsertion] = createSignal<CaretRange | null>(null);
	const [isReferenceDragging, setIsReferenceDragging] = createSignal(false);
	const [referenceDragAnchor, setReferenceDragAnchor] = createSignal<CellAddress | null>(null);
	const [fillDragState, setFillDragState] = createSignal<{
		source: CellRange;
		preview: ReturnType<typeof computeFillPreview>;
	} | null>(null);
	const [searchOpen, setSearchOpen] = createSignal(false);
	const [searchQuery, setSearchQuery] = createSignal("");
	const [searchCurrentIndex, setSearchCurrentIndex] = createSignal(-1);

	const hasFormulaEngine = () => Boolean(props.formulaBridge);
	const rowGutterWidth = () => props.showReferenceHeaders ? ROW_GUTTER_WIDTH : 0;

	const columnWidths = createMemo(() =>
		props.columns.map(
			(col) => props.store.columnWidths().get(col.id) ?? col.width ?? DEFAULT_COL_WIDTH,
		),
	);

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

	const rowVirtualizer = createVirtualizer({
		get count() {
			return props.store.rowCount();
		},
		getScrollElement: () => viewportRef ?? null,
		estimateSize: () => props.rowHeight,
		overscan: 10,
	});

	const visibleRows = createMemo(() =>
		rowVirtualizer.getVirtualItems().map((item) => item.index),
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

	// ── Search ────────────────────────────────────────────────────────────

	const searchMatches = createMemo(() => {
		const query = searchQuery();
		if (!query) return [];
		return findMatches(
			getDisplayCellValue,
			props.store.rowCount(),
			props.store.colCount(),
			query,
		);
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
		on(searchCurrentAddress, (addr) => {
			if (!addr || !viewportRef) return;
			const top = addr.row * props.rowHeight;
			let left = 0;
			for (let c = 0; c < addr.col; c++) {
				left += untrack(columnWidths)[c] ?? DEFAULT_COL_WIDTH;
			}
			viewportRef.scrollTo({ top, left, behavior: "smooth" });
		}),
	);

	const editCellRect = createMemo(() => {
		const editMode = props.store.editMode();
		if (!editMode || editorSource() !== "cell") return null;

		let left = rowGutterWidth();
		for (let col = 0; col < editMode.address.col; col++) {
			left += columnWidths()[col] ?? DEFAULT_COL_WIDTH;
		}

		return {
			left,
			top: editMode.address.row * props.rowHeight,
			width: columnWidths()[editMode.address.col] ?? DEFAULT_COL_WIDTH,
			height: props.rowHeight,
		};
	});

	const selectedAddress = createMemo(() => props.store.selection().anchor);

	const selectedRawValue = createMemo(() => {
		const addr = selectedAddress();
		return props.store.cells[addr.row]?.[addr.col] ?? null;
	});

	const formulaBarValue = createMemo(() => {
		const editMode = props.store.editMode();
		if (editMode) return editorText();
		const raw = cellValueToEditorText(selectedRawValue());
		if (customization?.translateFormulaForDisplay && typeof raw === "string" && raw.startsWith("=")) {
			const addr = selectedAddress();
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
					setPendingCaret(null);
				}
			},
		),
	);

	function getRawCellValue(row: number, col: number): CellValue {
		return props.store.cells[row]?.[col] ?? null;
	}

	function getDisplayCellValue(row: number, col: number): CellValue {
		const rawValue = getRawCellValue(row, col);
		if (props.formulaBridge && typeof props.formulaBridge.revision === "function") {
			props.formulaBridge.revision();
		}
		return props.formulaBridge?.getDisplayValue(row, col, rawValue) ?? rawValue;
	}

	function syncMutationToFormulaEngine(mutation: CellMutation) {
		props.formulaBridge?.setCell(
			mutation.address.row,
			mutation.address.col,
			mutation.newValue,
		);
	}

	function syncMutationsToFormulaEngine(mutations: CellMutation[]) {
		for (const mutation of mutations) {
			syncMutationToFormulaEngine(mutation);
		}
	}

	function applyBatchMutations(mutations: CellMutation[]) {
		if (mutations.length === 0) return;
		applyMutations(props.store, mutations);
		syncMutationsToFormulaEngine(mutations);
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
		const nextText = options?.initialText ?? cellValueToEditorText(rawValue);
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

		if (!isFormulaText(nextText)) {
			setReferenceInsertion(null);
			setReferenceRange(null);
		}
	}

	function insertReference(range: CellRange) {
		const editState = props.store.editMode();
		if (!editState) return;

		const normalized = normalizeRange(range);

		// Check if a custom reference text override is provided
		if (customization?.getReferenceText) {
			const customText = customization.getReferenceText(editState.address, normalized.start);
			if (customText !== null) {
				insertReferenceText(customText, normalized);
				return;
			}
		}

		insertReferenceText(rangeToA1(range), normalized);
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

	function handleEditorCommit() {
		const editMode = props.store.editMode();
		if (!editMode) return;
		const nextValue = parseEditValue(editMode.initialValue, editorText());

		props.store.setEditMode(null);

		const mutation = commitCellEdit(
			props.store,
			editMode.address.row,
			editMode.address.col,
			nextValue,
			props.columns,
		);

		if (mutation) {
			syncMutationToFormulaEngine(mutation);
			props.onCellEdit?.(mutation);
		}
	}

	function handleEditCancel() {
		props.store.setEditMode(null);
		setReferenceInsertion(null);
		setReferenceRange(null);
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
		let running = 0;
		for (let col = 0; col < props.columns.length; col++) {
			running += columnWidths()[col] ?? DEFAULT_COL_WIDTH;
			if (offsetX < running) return col;
		}
		return Math.max(0, props.columns.length - 1);
	}

	function getGridAddressFromViewportEvent(event: MouseEvent): CellAddress | null {
		if (!viewportRef) return null;

		const rect = viewportRef.getBoundingClientRect();
		const scrollTop = viewportRef.scrollTop;
		const scrollLeft = viewportRef.scrollLeft;
		const x = event.clientX - rect.left + scrollLeft - rowGutterWidth();
		const y = event.clientY - rect.top + scrollTop - headerTotalHeight();

		if (x < 0 || y < 0) return null;

		const row = Math.max(
			0,
			Math.min(props.store.rowCount() - 1, Math.floor(y / props.rowHeight)),
		);
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
			setIsDraggingSelection(true);
		}
	}

	function handleRowHeaderMouseDown(row: number, event: MouseEvent) {
		event.preventDefault();
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
	}

	function handleColumnHeaderMouseDown(col: number, event: MouseEvent) {
		event.preventDefault();
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
	}

	function handleMouseMove(event: MouseEvent) {
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

		const rect = viewportRef.getBoundingClientRect();
		const scrollTop = viewportRef.scrollTop;
		const scrollLeft = viewportRef.scrollLeft;
		const x = event.clientX - rect.left + scrollLeft - rowGutterWidth();
		const y = event.clientY - rect.top + scrollTop - headerTotalHeight();

		const row = Math.max(0, Math.min(
			props.store.rowCount() - 1,
			Math.floor(y / props.rowHeight),
		));
		const col = getColumnIndexFromOffset(Math.max(0, x));

		const sel = props.store.selection();
		props.store.setSelection(extendSelection(sel.anchor, { row, col }));
	}

	function handleMouseUp() {
		const activeFillDrag = fillDragState();
		if (activeFillDrag) {
			const mutations = buildVerticalFillMutations(
				activeFillDrag.source,
				activeFillDrag.preview,
				props.store.cells,
				props.columns,
			);
			setFillDragState(null);
			applyBatchMutations(mutations);
		}

		setIsDraggingSelection(false);
		setIsReferenceDragging(false);
		setReferenceInsertion(null);
		setReferenceDragAnchor(null);
	}

	function handleWheel(event: WheelEvent) {
		if (event.shiftKey && viewportRef) {
			event.preventDefault();
			const horizontalDelta = event.deltaX !== 0 ? event.deltaX : event.deltaY;
			viewportRef.scrollLeft += horizontalDelta;
		}
	}

	function handleContextMenu(event: MouseEvent) {
		event.preventDefault();
		setContextMenu({ x: event.clientX, y: event.clientY });
	}

	const contextMenuItems = createMemo<ContextMenuItem[]>(() => {
		const isReadOnly = props.readOnly;
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
				action: () => void handlePaste(),
			},
			{
				label: "Delete",
				shortcut: "Del",
				disabled: isReadOnly,
				action: () => {
					const mutations = deleteSelectedCells(props.store, props.columns);
					applyBatchMutations(mutations);
				},
			},
		];
	});

	function handleSort(columnId: string) {
		const current = sortState();
		let newDirection: "asc" | "desc";
		if (current && current.columnId === columnId) {
			newDirection = current.direction === "asc" ? "desc" : "asc";
		} else {
			newDirection = "asc";
		}
		setSortState({ columnId, direction: newDirection });
		props.onSort?.(columnId, newDirection);
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
		const grid = viewportRef?.closest(".se-grid");
		if (grid instanceof HTMLElement) grid.focus();
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
				const mutations = deleteSelectedCells(props.store, props.columns);
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

			case "paste":
				void handlePaste();
				break;

			case "undo": {
				const undoMutations = props.store.undo();
				if (undoMutations) {
					syncMutationsToFormulaEngine(undoMutations);
					props.onBatchEdit?.(undoMutations);
				}
				break;
			}

			case "redo": {
				const redoMutations = props.store.redo();
				if (redoMutations) {
					syncMutationsToFormulaEngine(redoMutations);
					props.onBatchEdit?.(redoMutations);
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

		const tsv = serializeToTSV(props.store.cells, range);
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

		const tsv = serializeToTSV(props.store.cells, range);
		void navigator.clipboard.writeText(tsv);
		setClipboardRange({ ...range });

		props.onClipboard?.({
			action: "cut",
			range,
			text: tsv,
			cells: parseTSV(tsv),
		});

		const mutations = deleteSelectedCells(props.store, props.columns);
		applyBatchMutations(mutations);
	}

	async function handlePaste() {
		if (props.readOnly) return;
		try {
			const text = await navigator.clipboard.readText();
			const parsed = parseTSV(text);
			if (parsed.length === 0) return;

			const sel = props.store.selection();
			const target = sel.anchor;
			const mutations = buildPasteMutations(
				parsed,
				target,
				props.store.cells,
				props.columns,
			);

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
		} catch {
			// Clipboard access denied — silently ignore.
		}
	}

	function handleColumnResize(columnId: string, width: number) {
		props.store.setColumnWidth(columnId, width);
		props.onColumnResize?.(columnId, width);
	}

	function handleFillHandleMouseDown(event: MouseEvent) {
		event.preventDefault();
		event.stopPropagation();

		const source = autoFillSourceRange();
		if (!source || props.readOnly || props.store.editMode()) return;

		setContextMenu(null);
		setFillDragState({
			source,
			preview: null,
		});
	}

	onMount(() => {
		document.addEventListener("mousemove", handleMouseMove);
		document.addEventListener("mouseup", handleMouseUp);
		viewportRef?.addEventListener("wheel", handleWheel, { passive: false });

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
					const top = row * props.rowHeight;
					let left = 0;
					for (let c = 0; c < col; c++) {
						left += columnWidths()[c] ?? DEFAULT_COL_WIDTH;
					}
					viewportRef.scrollTo({ top, left, behavior: "smooth" });
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
					const colDef = props.columns[col];
					if (!colDef) return;
					const oldValue = getRawCellValue(row, col);
					const mutation: CellMutation = {
						address: { row, col },
						columnId: colDef.id,
						oldValue,
						newValue: value,
						source: "external",
					};
					applyMutations(props.store, [mutation]);
					syncMutationToFormulaEngine(mutation);
					props.onCellEdit?.(mutation);
				},
				getColumnMeta: (columnId) =>
					props.columns.find((column) => column.id === columnId)?.meta,
				undo: () => {
					const mutations = props.store.undo();
					if (mutations) {
						syncMutationsToFormulaEngine(mutations);
						props.onBatchEdit?.(mutations);
					}
				},
				redo: () => {
					const mutations = props.store.redo();
					if (mutations) {
						syncMutationsToFormulaEngine(mutations);
						props.onBatchEdit?.(mutations);
					}
				},
				canUndo: () => props.store.canUndo(),
				canRedo: () => props.store.canRedo(),
				getCanvasElement: () => {
					return viewportRef?.querySelector(".se-canvas") as HTMLElement | null ?? null;
				},
			};
			props.controllerRef(controller);
		}
	});

	onCleanup(() => {
		document.removeEventListener("mousemove", handleMouseMove);
		document.removeEventListener("mouseup", handleMouseUp);
		viewportRef?.removeEventListener("wheel", handleWheel);
	});

	return (
		<div
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
					columnWidths={props.store.columnWidths()}
					totalWidth={totalWidth()}
					sortState={sortState()}
					showReferenceHeaders={props.showReferenceHeaders}
					rowGutterWidth={rowGutterWidth()}
					pinnedLeftOffsets={pinnedLeftOffsets()}
					lastPinnedIndex={lastPinnedIndex()}
					onColumnResize={handleColumnResize}
					onSort={handleSort}
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
							columnWidths={props.store.columnWidths()}
							rowHeight={props.rowHeight}
							selection={props.store.selection()}
							clipboardRange={clipboardRange()}
							rowGutterWidth={rowGutterWidth()}
							showReferenceHeaders={props.showReferenceHeaders}
							visibleRows={visibleRows()}
							totalRows={props.store.rowCount()}
							getDisplayValue={getDisplayCellValue}
							onCellMouseDown={handleCellMouseDown}
							onRowHeaderMouseDown={handleRowHeaderMouseDown}
							onCellDblClick={handleCellDblClick}
							pinnedLeftOffsets={pinnedLeftOffsets()}
							lastPinnedIndex={lastPinnedIndex()}
							readOnly={props.readOnly}
							searchMatchSet={searchMatchSet()}
							searchCurrentAddress={searchCurrentAddress()}
						/>

						<SelectionOverlay
							selection={props.store.selection()}
							clipboardRange={clipboardRange()}
							referenceRange={referenceRange()}
							fillPreview={fillDragState()?.preview ?? null}
							showFillHandle={showFillHandle()}
							columnWidths={columnWidths()}
							rowHeight={props.rowHeight}
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
