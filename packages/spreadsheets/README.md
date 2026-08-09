# peculiar-sheets

A high-performance spreadsheet component for [SolidJS](https://www.solidjs.com/).

Formula evaluation is **optional** and **not bundled**. IronCalc is the recommended formula engine;
existing HyperFormula integrations remain supported through a compatibility adapter.

## Features

- **SolidJS-native** fine-grained reactivity -- no unnecessary re-renders
- **Virtual scrolling** via `@tanstack/solid-virtual` for large datasets
- **Optional formula engines** through an engine-neutral adapter and workbook API
- **Selection system** with multi-range (Ctrl+click), shift-extend, and keyboard navigation
- **Inline editing** with optional formula bar and reference insertion mode
- **Undo / redo** with full mutation history
- **Copy / paste** with TSV serialization
- **Autofill** (fill-down) with copy, linear series, and formula-shift modes
- **Column resizing**, pinning, external/view/mutation sorting, and group headers
- **Cell search** with match highlighting
- **Context menu** support
- **First-class theming** through documented `--ps-*` variables on the sheet root
- **Fully customizable** rows, row headers, cells, empty states, address labels, and formula display

## Installation

Formula-free grid (no HyperFormula installed):

```bash
npm install peculiar-sheets
# or
bun add peculiar-sheets
```

Recommended formulas (MIT/Apache-2.0 IronCalc path):

```bash
npm install peculiar-sheets peculiar-sheets-ironcalc
```

Legacy HyperFormula integrations can instead install `hyperformula@^3.0.0` directly. HyperFormula
is GPLv3/commercial and is not relicensed by Peculiar Sheets.

## Migrating from 0.10.x

Formula-free applications can upgrade without changing application code:

```bash
npm install peculiar-sheets@0.11.1
```

Applications that use formulas can migrate to the recommended IronCalc adapter:

```bash
npm install peculiar-sheets@0.11.1 peculiar-sheets-ironcalc@0.11.1
```

Because IronCalc loads WASM asynchronously, create it before rendering the formula-enabled sheet.
Existing applications may instead install `hyperformula@^3.0.0`; direct
`HyperFormula.buildEmpty(...)`, `formulaEngine={{ instance, sheetId }}`, and
`createWorkbookCoordinator({ engine })` code remains valid without a rewrite.

## Quick Start (formula-free)

```tsx
import { Sheet } from "peculiar-sheets";
import "peculiar-sheets/styles";

const columns = [
	{ id: "a", header: "A", width: 120, editable: true },
	{ id: "b", header: "B", width: 120, editable: true },
];

const data = [
	[10, 20],
	[30, 40],
];

function App() {
	return (
		<Sheet
			data={data}
			columns={columns}
			showFormulaBar={false}
			onOperation={(operation) => console.log("operation:", operation)}
		/>
	);
}
```

## Recommended formulas with IronCalc

```tsx
import { createSignal, onCleanup, onMount, Show } from "solid-js";
import { Sheet } from "peculiar-sheets";
import { createIronCalcFormulaEngine } from "peculiar-sheets-ironcalc";
import "peculiar-sheets/styles";

const columns = [
	{ id: "a", header: "A", width: 120, editable: true },
	{ id: "b", header: "B", width: 120, editable: true },
];

const data = [
	[10, 20],
	[30, 40],
	["=SUM(A1:B2)", null],
];

function App() {
	const [engine, setEngine] = createSignal<Awaited<
		ReturnType<typeof createIronCalcFormulaEngine>
	> | null>(null);
	let created: Awaited<ReturnType<typeof createIronCalcFormulaEngine>> | null = null;

	onMount(async () => {
		created = await createIronCalcFormulaEngine();
		setEngine(created);
	});
	onCleanup(() => created?.dispose?.());

	return (
		<Show when={engine()}>
			{(ready) => <Sheet
				data={data}
				columns={columns}
				formulaEngine={{ instance: ready() }}
				showFormulaBar
				showReferenceHeaders
			/>}
		</Show>
	);
}
```

The core stays formula-free. `peculiar-sheets-ironcalc` owns WASM initialization and coordinate,
evaluation, event, structural-row, and lifetime adaptation.

## Legacy HyperFormula compatibility

Install `hyperformula` explicitly and keep passing the direct instance. Peculiar Sheets detects and
adapts it to the same engine-neutral boundary:

```tsx
import HyperFormula from "hyperformula";

const hf = HyperFormula.buildEmpty({ licenseKey: "gpl-v3" });
const sheetName = hf.addSheet("Sheet1");
const sheetId = hf.getSheetId(sheetName)!;

<Sheet data={data} columns={columns} formulaEngine={{ instance: hf, sheetId, sheetName }} />
```

## Cross-Sheet Formulas

Multiple `Sheet` components can share one engine for cross-sheet references. The headless workbook
coordinator is the recommended engine-neutral path:

```tsx
import { createWorkbookCoordinator } from "peculiar-sheets";
import { createIronCalcFormulaEngine } from "peculiar-sheets-ironcalc";

const engine = await createIronCalcFormulaEngine();
const workbook = createWorkbookCoordinator({ engine });

const dataWorkbook = workbook.bindSheet({
	sheetKey: "data",
	formulaName: "Data",
});

const summaryWorkbook = workbook.bindSheet({
	sheetKey: "summary",
	formulaName: "Summary",
});

<Sheet data={dataRows} columns={dataCols} workbook={dataWorkbook} />
<Sheet data={summaryRows} columns={summaryCols} workbook={summaryWorkbook} />
```

Workbook mode keeps `Sheet` embeddable while adding:

- Cross-sheet click/drag reference insertion
- Cross-sheet reference highlighting
- Workbook-correct row insert/delete and mutation-sort snapshots through the selected engine

Notes:

- The host owns workbook layout and naming UI.
- `formulaName` is fixed for the lifetime of a workbook binding in v1.
- Structural workbook sync is driven by `workbook.subscribe(...)` snapshots, not just `onRowInsert` / `onRowDelete`.
- Failed structural operations (`insertRows`, `deleteRows`, `setRowOrder`) and failed undo/redo restores are atomic: registered engine sheets, runtime caches, and undo/redo availability are left unchanged, and subscribers do not receive a `WorkbookStructuralChange`. If rollback itself fails, the Result is a `WorkbookStructuralRollbackError` with `engineInconsistent: true`.
- `WorkbookStructuralChange.snapshots` remains an all-registered-sheet payload for subscribers. Internal undo/redo history retains only sheets whose serialized content changed for that operation.
- On the confirmed happy path, a structural operation serializes each registered sheet once (public `after` snapshots). Rollback capture reuses confirmed caches, and `before` history snapshots are built from those caches without a second full-workbook serialize. Formula-bridge writes (`setCell` / `setCells` / `syncAll` / `setRowOrder`) mark the workbook sheet unconfirmed so later rollback capture re-serializes that sheet instead of restoring a stale cache.
- Non-goals in v1: built-in workbook/tabs UI, sheet rename, column insert/delete, workbook-wide non-structural undo
- See [CHANGELOG.md](./CHANGELOG.md) for release notes covering atomic-failure and scoped-history semantics.

## Props

| Prop | Type | Description |
|------|------|-------------|
| `data` | `CellValue[][]` | 2D array of cell values |
| `columns` | `ColumnDef[]` | Column definitions |
| `rowCount` | `number?` | Override row count |
| `rowHeight` | `number?` | Row height in px (default `28`) |
| `resizeMode` | `"onEnd" \| "onChange"` | Resize commit timing (`onEnd` by default) |
| `readOnly` | `boolean?` | Disable editing |
| `formulaEngine` | `FormulaEngineConfig?` | Optional FormulaEngine adapter or legacy HyperFormula instance |
| `workbook` | `WorkbookSheetBinding?` | Headless workbook binding for shared cross-sheet coordination |
| `showFormulaBar` | `boolean?` | Show the formula bar |
| `showReferenceHeaders` | `boolean?` | Show A1-style column/row headers |
| `columnSizing` | `Record<string, number>?` | Controlled column sizing state |
| `rowSizing` | `Record<number, number>?` | Controlled row sizing state keyed by stable row ID |
| `sortBehavior` | `"external" \| "view" \| "mutation"` | Built-in sort mode (`view` by default) |
| `sortState` | `SortState \| null` | Controlled sort state |
| `defaultSortState` | `SortState \| null` | Initial uncontrolled sort state |
| `customization` | `SheetCustomization?` | Visual customization hooks |
| `ariaLabel` | `string?` | Accessible grid name (default `"Spreadsheet"`) |
| `emptyState` | `JSX.Element?` | Content shown when no rows exist (default `"No data"`) |
| `ref` | `(controller: SheetController) => void` | Imperative API handle |
| `class` | `string?` | CSS class applied to the `.se-grid` root; set theme variables here |

### Event Callbacks

| Callback | Payload | Description |
|------|------|-------------|
| `onCellEdit` | `CellMutation` | Single cell edited |
| `onBatchEdit` | `CellMutation[]` | Multiple cells edited (paste, fill) |
| `onSelectionChange` | `Selection` | Selection changed |
| `onEditModeChange` | `EditModeState \| null` | Enter/exit edit mode |
| `onClipboard` | `ClipboardPayload` | Copy/cut/paste event |
| `onScroll` | `ScrollPosition` | Scroll position changed |
| `onColumnSizingChange` | `(next) => void` | Controlled column sizing changed |
| `onRowSizingChange` | `(next) => void` | Controlled row sizing changed |
| `onColumnResize` | `(columnId, width)` | Column resized |
| `onRowResize` | `(rowId, height)` | Row resized |
| `onSort` | `(columnId, direction)` | Column sort requested (`direction` can be `null` when sort is cleared) |
| `onSortChange` | `SortState \| null` | Sort UI state changed |
| `onRowReorder` | `RowReorderMutation` | Underlying rows were structurally reordered |

## Sorting

By default, the sheet uses `sortBehavior="view"`. Clicking a column header selects the full column. Use the column header context menu to sort `A-Z`, `Z-A`, or clear the active sort.

Use `sortBehavior="external"` to keep sorting as host-controlled UI state only.

Use `sortBehavior="view"` to sort only the rendered row order. Edits still mutate backing/model rows, and `CellMutation.address` stays in backing coordinates while `CellMutation.viewAddress` records the visible coordinate at edit time.
In this mode, row headers show backing row numbers rather than visual positions, and hovering a row header shows the visible row number in a tooltip.

Use `sortBehavior="mutation"` to physically reorder the table. Mutation sorts are recorded in undo/redo history and emit `onRowReorder` so host apps can persist the reordered data.

## SheetController (Imperative API)

Access via the `ref` prop:

```tsx
let ctrl: SheetController;

<Sheet ref={(c) => (ctrl = c)} data={data} columns={columns} />

// Then:
ctrl.scrollToCell(10, 2);
ctrl.startEditing(0, 0);
ctrl.undo();
ctrl.redo();
```

Key methods: `getSelection`, `setSelection`, `clearSelection`, `scrollToCell`, `startEditing`, `stopEditing`, `getRawCellValue`, `getDisplayCellValue`, `setCellValue`, `setCellValues`, `undo`, `redo`, `canUndo`, `canRedo`.

Use `setCellValues` for bulk host updates that should share one formula sync, store update, undo entry, and `batch-edit` operation:

```ts
ctrl.setCellValues([
	{ row: 0, col: 0, value: "Alice" },
	{ row: 0, col: 1, value: 31 },
]);
```

## Customization

```tsx
<Sheet
	data={data}
	columns={columns}
	customization={{
		getRowClass: (_row, context) =>
			context.containsFocus ? "focused-record" : "",
		getRowHeaderLabel: (row) => `Row ${row + 1}`,
		getRowHeaderSublabel: (row) => (row === 0 ? "first" : null),
		getCellClass: (row, col) => (col === 0 ? "font-bold" : ""),
		getAddressLabel: (row, col) => `Custom(${row},${col})`,
		getReferenceText: (editing, clicked) => `MySheet!${addressToA1(clicked)}`,
		translateFormulaForDisplay: (formula) => formula.replaceAll("Sheet1!", ""),
	}}
/>
```

`getRowClass(rowIndex, context)` is evaluated per rendered row and reevaluated when its generic
interaction state changes. `rowIndex` is the backing/model row index. The class is placed on the row
wrapper, row header, and every currently rendered data cell, including pinned cells. The context contains:

- `rowId`: the stable `RowId` for the backing row
- `visualRowIndex`: its current position after view sorting
- `dataRowIndex`: its backing/model index (the same value as `rowIndex`)
- `containsFocus`: the row contains the keyboard-focused cell
- `intersectsSelection`: at least one selection range crosses the row
- `containsActiveEditor`: the inline editor is in the row

This keeps row styling tied to stable row identity while virtualization recycles rendered rows.
The existing `getCellClass`, `getCellStyle`, and `getRowHeaderClass` hooks remain supported.

## Theming

Import `peculiar-sheets/styles`, pass a root class, and set variables on that class. Consumers do
not need to override internal `.se-*` selectors:

```css
.my-sheet {
	--ps-grid-background: #f7f3e8;
	--ps-text-primary: #2b261e;
	--ps-surface-header: #d7c39d;
	--ps-surface-header-cell: #e3d4b7;
	--ps-cell-border: #d2c5aa;
	--ps-focus: #b5582b;
	--ps-selection-background: rgba(181, 88, 43, 0.14);
	--ps-selection-focus-background: rgba(181, 88, 43, 0.24);
}
```

```tsx
<Sheet class="my-sheet" data={data} columns={columns} />
```

`.se-grid` defines the previous dark appearance as the fallback, so existing sheets look the same
without host variables. Variables inherit per instance. The defaults use the zero-specificity
`:where(.se-grid)` selector, so variables on the host root class win even when the host stylesheet
loads before `peculiar-sheets/styles`; consumers do not need `!important` or internal selectors.

### CSS variable reference

| Variables | Purpose |
|---|---|
| `--ps-grid-background`, `--ps-grid-border` | Root grid surface and border |
| `--ps-surface-formula-bar`, `--ps-surface-header`, `--ps-surface-header-secondary`, `--ps-surface-header-cell` | Formula bar and primary/secondary header surfaces |
| `--ps-surface-elevated`, `--ps-surface-hover` | Raised and hover surfaces |
| `--ps-border-default`, `--ps-border-strong`, `--ps-border-input`, `--ps-cell-border` | Structural, emphasized, input, and cell borders |
| `--ps-text-primary`, `--ps-text-secondary`, `--ps-text-muted`, `--ps-text-subtle`, `--ps-text-accent` | Text hierarchy and accent text |
| `--ps-focus`, `--ps-focus-contrast` | Grid/cell focus ring and contrasting handle edge |
| `--ps-selection-background`, `--ps-selection-focus-background`, `--ps-selection-overlay-background` | Selected cells, focused cell, and range overlay |
| `--ps-active-row-background`, `--ps-active-row-header-background` | Active-row cells and row header |
| `--ps-editor-background`, `--ps-editor-border`, `--ps-editor-focus`, `--ps-editor-focus-shadow` | Inline editor states |
| `--ps-menu-background`, `--ps-menu-hover-background`, `--ps-menu-shadow` | Context menu surfaces and elevation |
| `--ps-search-background`, `--ps-search-input-background`, `--ps-search-match-background`, `--ps-search-current-background`, `--ps-search-accent` | Search UI and match states |
| `--ps-resize-indicator`, `--ps-resize-background` | Resize handles, guides, and active header tint |
| `--ps-clipboard-indicator` | Copied-range outline |
| `--ps-reference-indicator`, `--ps-reference-background` | Formula-reference outline and fill |
| `--ps-fill-indicator`, `--ps-fill-hover`, `--ps-fill-background` | Autofill handle and preview |
| `--ps-disabled-text`, `--ps-disabled-control` | Disabled menu and search controls |
| `--ps-state-info`, `--ps-state-success`, `--ps-state-warning`, `--ps-state-danger` | Generic host/application state palette |

## Keyboard and focus contract

- Arrow keys move the focused cell; Shift+Arrow extends from the selection anchor.
- Enter and F2 enter edit mode. A printable character replaces the focused cell's editor text.
- Escape cancels an edit without committing and restores focus to the grid.
- Tab/Shift+Tab commit and move one column right/left. The grid does not wrap rows.
- Enter/Shift+Enter commit and move one row down/up. At a vertical boundary, focus stays on the boundary cell.
- At the first cell, Shift+Tab moves focus to the previous focusable element outside the sheet. At the last cell, Tab moves focus to the next focusable element outside the sheet. This applies while navigating and while committing an edit, so the sheet is not a keyboard trap.
- Selection movement scrolls the focused cell into view; focus remains on the grid after in-grid navigation.
- Sheet-level and column-level read-only cells reject Enter, F2, printable-key, pointer, formula-bar, and imperative edit entry.

The root grid exposes row/column counts and an accessible name. Rendered rows/cells expose 1-based
indices, cells expose `aria-selected`/`aria-readonly`, and the grid uses `aria-activedescendant` to
announce the focused virtualized cell. The inline editor is labeled with its A1 address. Focus,
selection, editing, and active-row visuals use separate theme variables, with forced-colors and
`prefers-reduced-motion` fallbacks.

## Empty state

`emptyState` accepts host JSX while preserving `No data` by default:

```tsx
<Sheet
	data={[]}
	columns={columns}
	emptyState={<button onClick={createFirstRow}>Create first row</button>}
/>
```

Loading, error, retry, and domain-specific state management remain host responsibilities.

## Types

All types are exported for use in your application:

```tsx
import type {
	CellAddress,
	CellMutation,
	CellRange,
	CellValue,
	ColumnDef,
	EditModeState,
	FormulaEngineConfig,
	FormulaEngine,
	RowClassContext,
	Selection,
	SheetController,
	SheetCustomization,
	SheetProps,
	WorkbookCoordinator,
	WorkbookCoordinatorOptions,
	WorkbookSheetBinding,
	WorkbookSheetDefinition,
	WorkbookStructuralChange,
	WorkbookStructuralOrigin,
} from "peculiar-sheets";
```

Utility functions are also exported:

```tsx
import {
	addressToA1,
	createWorkbookCoordinator,
	rangeToA1,
	isFormulaValue,
	shiftFormulaByDelta,
} from "peculiar-sheets";
```

## Distribution boundary

- Packed `peculiar-sheets` must not declare a formula engine as a production dependency. Verify with `pnpm --filter peculiar-sheets pack:check`.
- Formula hosts install `peculiar-sheets-ironcalc` (recommended) or configure HyperFormula explicitly.
- The copyright holder has authorized the formula-free core under MIT. Published registry metadata must report MIT and omit HyperFormula from production and peer dependencies.

## Changelog

See [CHANGELOG.md](./CHANGELOG.md) for release history.

## License

[MIT](./LICENSE)

IronCalc and HyperFormula are not part of the formula-free core dependency graph.
