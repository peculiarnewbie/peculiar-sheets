# peculiar-sheets

A high-performance spreadsheet component for [SolidJS](https://www.solidjs.com/).

Formula evaluation is **optional** and **not bundled**. The published core package does not depend on HyperFormula. Hosts that need formulas should install HyperFormula themselves or use the separately named GPL adapter [`peculiar-sheets-hyperformula`](../peculiar-sheets-hyperformula).

> HyperFormula is dual GPLv3 / commercial. It is **not** MIT. Ownership of Peculiar Sheets does not relicense HyperFormula.

## Features

- **SolidJS-native** fine-grained reactivity -- no unnecessary re-renders
- **Virtual scrolling** via `@tanstack/solid-virtual` for large datasets
- **Optional formula engine** via duck-typed `formulaEngine` / workbook APIs (HyperFormula through the GPL adapter)
- **Selection system** with multi-range (Ctrl+click), shift-extend, and keyboard navigation
- **Inline editing** with optional formula bar and reference insertion mode
- **Undo / redo** with full mutation history
- **Copy / paste** with TSV serialization
- **Autofill** (fill-down) with copy, linear series, and formula-shift modes
- **Column resizing**, pinning, external/view/mutation sorting, and group headers
- **Cell search** with match highlighting
- **Context menu** support
- **Fully customizable** row headers, cell classes, address labels, and formula display

## Installation

Formula-free grid (no HyperFormula installed):

```bash
npm install peculiar-sheets
# or
bun add peculiar-sheets
```

Optional formulas (GPL path):

```bash
npm install peculiar-sheets peculiar-sheets-hyperformula hyperformula
```

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

## Optional Formulas (GPL adapter)

```tsx
import { Sheet } from "peculiar-sheets";
import {
	createGplHyperFormula,
	toFormulaEngineConfig,
} from "peculiar-sheets-hyperformula";
import "peculiar-sheets/styles";

const hf = createGplHyperFormula();
const sheetName = hf.addSheet("Sheet1");
const sheetId = hf.getSheetId(sheetName)!;

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
	return (
		<Sheet
			data={data}
			columns={columns}
			formulaEngine={toFormulaEngineConfig(hf, { sheetId, sheetName })}
			showFormulaBar
			showReferenceHeaders
			onOperation={(operation) => console.log("operation:", operation)}
		/>
	);
}
```

You can also pass a HyperFormula instance you constructed yourself through `formulaEngine.instance` / `createWorkbookCoordinator({ engine })`. The core types stay duck-typed so HyperFormula is never a required install for grid-only hosts.

## Cross-Sheet Formulas

Multiple `Sheet` components can share a single HyperFormula instance for cross-sheet references:

```tsx
import { createGplHyperFormula, toFormulaEngineConfig } from "peculiar-sheets-hyperformula";

const hf = createGplHyperFormula();
const dataSheetId = hf.getSheetId(hf.addSheet("Data"))!;
const summarySheetId = hf.getSheetId(hf.addSheet("Summary"))!;

// In the Summary sheet, reference the Data sheet:
// =SUM(Data!A1:A10)

<Sheet data={dataRows} columns={dataCols} formulaEngine={toFormulaEngineConfig(hf, { sheetId: dataSheetId })} />
<Sheet data={summaryRows} columns={summaryCols} formulaEngine={toFormulaEngineConfig(hf, { sheetId: summarySheetId })} />
```

That shared-engine pattern is enough for cross-sheet evaluation.

For host-owned faux-workbook behavior, use the headless workbook coordinator:

```tsx
import { Sheet, createWorkbookCoordinator } from "peculiar-sheets";
import { createGplHyperFormula } from "peculiar-sheets-hyperformula";

const hf = createGplHyperFormula();
const workbook = createWorkbookCoordinator({ engine: hf });

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
- Workbook-correct row insert/delete and mutation-sort snapshots through HyperFormula

Notes:

- The host owns workbook layout and naming UI.
- `formulaName` is fixed for the lifetime of a workbook binding in v1.
- Structural workbook sync is driven by `workbook.subscribe(...)` snapshots, not just `onRowInsert` / `onRowDelete`.
- Failed structural operations (`insertRows`, `deleteRows`, `setRowOrder`) and failed undo/redo restores are atomic: registered HyperFormula sheets, runtime caches, and undo/redo availability are left unchanged, and subscribers do not receive a `WorkbookStructuralChange`. If rollback itself fails, the Result is a `WorkbookStructuralRollbackError` with `engineInconsistent: true`.
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
| `formulaEngine` | `FormulaEngineConfig?` | Optional duck-typed formula engine + sheet ID |
| `workbook` | `WorkbookSheetBinding?` | Headless workbook binding for shared cross-sheet coordination |
| `showFormulaBar` | `boolean?` | Show the formula bar |
| `showReferenceHeaders` | `boolean?` | Show A1-style column/row headers |
| `columnSizing` | `Record<string, number>?` | Controlled column sizing state |
| `rowSizing` | `Record<number, number>?` | Controlled row sizing state keyed by stable row ID |
| `sortBehavior` | `"external" \| "view" \| "mutation"` | Built-in sort mode (`view` by default) |
| `sortState` | `SortState \| null` | Controlled sort state |
| `defaultSortState` | `SortState \| null` | Initial uncontrolled sort state |
| `customization` | `SheetCustomization?` | Visual customization hooks |
| `ref` | `(controller: SheetController) => void` | Imperative API handle |
| `class` | `string?` | CSS class for the root element |

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
		getRowHeaderLabel: (row) => `Row ${row + 1}`,
		getRowHeaderSublabel: (row) => (row === 0 ? "first" : null),
		getCellClass: (row, col) => (col === 0 ? "font-bold" : ""),
		getAddressLabel: (row, col) => `Custom(${row},${col})`,
		getReferenceText: (editing, clicked) => `MySheet!${addressToA1(clicked)}`,
		translateFormulaForDisplay: (formula) => formula.replaceAll("Sheet1!", ""),
	}}
/>
```

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

- Packed `peculiar-sheets` must not declare HyperFormula as a production dependency. Verify with `pnpm --filter peculiar-sheets pack:check`.
- Formula hosts use `peculiar-sheets-hyperformula` (GPL) or a self-managed HyperFormula install.
- The copyright holder has authorized the formula-free core under MIT. Published registry metadata must report MIT and omit HyperFormula from production and peer dependencies.

## Changelog

See [CHANGELOG.md](./CHANGELOG.md) for release history.

## License

[MIT](./LICENSE)

The optional HyperFormula adapter and HyperFormula itself are GPL-licensed. They are not part of the formula-free core dependency graph.
