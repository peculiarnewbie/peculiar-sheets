# @peculiarnewbie/spreadsheets

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
- **Column resizing**, pinning, sorting, and group headers
- **Cell search** with match highlighting
- **Context menu** support
- **Fully customizable** row headers, cell classes, address labels, and formula display

## Installation

```bash
npm install @peculiarnewbie/spreadsheets
# or
bun add @peculiarnewbie/spreadsheets
```

HyperFormula is included as a dependency -- no extra install needed.

## Quick Start

```tsx
import HyperFormula from "hyperformula";
import { Sheet } from "@peculiarnewbie/spreadsheets";
import "@peculiarnewbie/spreadsheets/styles";

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

## Props

| Prop | Type | Description |
|------|------|-------------|
| `data` | `CellValue[][]` | 2D array of cell values |
| `columns` | `ColumnDef[]` | Column definitions |
| `rowCount` | `number?` | Override row count |
| `rowHeight` | `number?` | Row height in px (default `28`) |
| `readOnly` | `boolean?` | Disable editing |
| `formulaEngine` | `FormulaEngineConfig?` | HyperFormula instance + sheet ID |
| `showFormulaBar` | `boolean?` | Show the formula bar |
| `showReferenceHeaders` | `boolean?` | Show A1-style column/row headers |
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
| `onColumnResize` | `(columnId, width)` | Column resized |
| `onSort` | `(columnId, direction)` | Column sort requested |

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
} from "@peculiarnewbie/spreadsheets";
```

Utility functions are also exported:

```tsx
import {
	addressToA1,
	rangeToA1,
	isFormulaValue,
	shiftFormulaByDelta,
} from "@peculiarnewbie/spreadsheets";
```

## License

[GPL-3.0](./LICENSE)

This project depends on [HyperFormula](https://hyperformula.handsontable.com/) which is also licensed under GPL-3.0.
