# peculiar-sheets-hyperformula

Optional **GPL-3.0-only** HyperFormula adapter for [`peculiar-sheets`](https://www.npmjs.com/package/peculiar-sheets).

This package exists so formula evaluation can stay separately named and separately licensed from the formula-free grid core. **HyperFormula is not MIT.** Ownership of Peculiar Sheets does not relicense HyperFormula.

## When to use this

- You need formula evaluation, workbook coordination with a real HyperFormula instance, or convenience builders.
- You accept GPL-3.0 obligations from HyperFormula and this adapter.

## When not to use this

- MIT / formula-free distribution (for example UE Shed Data Authoring) should depend only on the formula-free `peculiar-sheets` core and must not install this adapter.

## Install

```bash
npm install peculiar-sheets peculiar-sheets-hyperformula hyperformula
```

## Usage

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

<Sheet
	data={data}
	columns={columns}
	formulaEngine={toFormulaEngineConfig(hf, { sheetId, sheetName })}
	showFormulaBar
/>;
```

## License

[GPL-3.0-only](./LICENSE), matching HyperFormula's GPL distribution terms.
