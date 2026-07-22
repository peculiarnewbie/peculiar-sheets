# peculiar-sheets-hyperformula

Private **GPL-3.0-only** HyperFormula integration package used for repository conformance tests.

This package is not published to npm and is not part of the public migration path. **HyperFormula is not MIT.** Ownership of Peculiar Sheets does not relicense HyperFormula.

## When to use this

- You need formula evaluation, workbook coordination with a real HyperFormula instance, or convenience builders.
- You accept GPL-3.0 obligations from HyperFormula and this adapter.

## When not to use this

- MIT / formula-free distribution (for example UE Shed Data Authoring) should depend only on the formula-free `peculiar-sheets` core and must not install this adapter.

## Public installation

```bash
npm install peculiar-sheets hyperformula
```

Public consumers construct HyperFormula directly and pass it through the existing duck-typed
`formulaEngine` or workbook APIs. The helpers below are internal to this repository.

## Internal usage

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
