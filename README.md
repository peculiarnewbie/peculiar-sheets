# peculiar-sheets

A high-performance spreadsheet component for [SolidJS](https://www.solidjs.com/) powered by [HyperFormula](https://hyperformula.handsontable.com/).

## Features

- **SolidJS-native** fine-grained reactivity -- no unnecessary re-renders
- **Virtual scrolling** via `@tanstack/solid-virtual` for large datasets
- **Formula engine** powered by HyperFormula (A1 references, cross-sheet formulas, 400+ built-in functions)
- **Selection system** with multi-range (Ctrl+click), shift-extend, and keyboard navigation
- **Inline & formula bar editing** with reference insertion mode
- **Undo / redo** with full mutation history
- **Copy / paste** with TSV serialization
- **Autofill** (fill-down) with copy, linear series, and formula-shift modes
- **Column resizing**, pinning, external/view/mutation sorting, and group headers
- **Cell search** with match highlighting
- **Context menu** support
- **Fully customizable** row headers, cell classes, address labels, and formula display

## Installation

```bash
npm install peculiar-sheets
# or
bun add peculiar-sheets
```

HyperFormula is included as a dependency -- no extra install needed.

## Quick Start

```tsx
import HyperFormula from "hyperformula";
import { Sheet } from "peculiar-sheets";
import "peculiar-sheets/styles";

const hf = HyperFormula.buildEmpty({ licenseKey: "gpl-v3" });
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
			formulaEngine={{ instance: hf, sheetId }}
			showFormulaBar
			showReferenceHeaders
			onCellEdit={(mutation) => console.log("edited:", mutation)}
		/>
	);
}
```

## Cross-Sheet Formulas

Multiple `Sheet` components can share a single HyperFormula instance for cross-sheet references:

```tsx
const hf = HyperFormula.buildEmpty({ licenseKey: "gpl-v3" });
const dataSheetId = hf.getSheetId(hf.addSheet("Data"))!;
const summarySheetId = hf.getSheetId(hf.addSheet("Summary"))!;

// In the Summary sheet, reference the Data sheet:
// =SUM(Data!A1:A10)

<Sheet data={dataRows} columns={dataCols} formulaEngine={{ instance: hf, sheetId: dataSheetId }} />
<Sheet data={summaryRows} columns={summaryCols} formulaEngine={{ instance: hf, sheetId: summarySheetId }} />
```

That shared-engine pattern is enough for cross-sheet evaluation.

For host-owned faux-workbook behavior, use the headless workbook coordinator:

```tsx
import HyperFormula from "hyperformula";
import { Sheet, createWorkbookCoordinator } from "peculiar-sheets";

const hf = HyperFormula.buildEmpty({ licenseKey: "gpl-v3" });
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
- Non-goals in v1: built-in workbook/tabs UI, sheet rename, column insert/delete, workbook-wide non-structural undo

## Props

| Prop | Type | Description |
|------|------|-------------|
| `data` | `CellValue[][]` | 2D array of cell values |
| `columns` | `ColumnDef[]` | Column definitions |
| `rowCount` | `number?` | Override row count |
| `rowHeight` | `number?` | Row height in px (default `28`) |
| `resizeMode` | `"onEnd" \| "onChange"` | Resize commit timing (`onEnd` by default) |
| `readOnly` | `boolean?` | Disable editing |
| `formulaEngine` | `FormulaEngineConfig?` | HyperFormula instance + sheet ID |
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
|----------|---------|-------------|
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

Key methods: `getSelection`, `setSelection`, `clearSelection`, `scrollToCell`, `startEditing`, `stopEditing`, `getRawCellValue`, `getDisplayCellValue`, `setCellValue`, `undo`, `redo`, `canUndo`, `canRedo`.

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

## License

[GPL-3.0](./LICENSE)

This project depends on [HyperFormula](https://hyperformula.handsontable.com/) which is also licensed under GPL-3.0.
