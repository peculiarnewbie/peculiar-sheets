# Autofill Compatibility Contract

This document defines the supported behavior for the first shipped autofill pass in the local sheet engine. The test suite is the source of truth.

## Supported

- Vertical autofill only
- Drag handle on the lower-right corner of the primary selection
- Single-cell literal seeds copy
- Multi-row literal seeds tile by source-row order
- Two-or-more numeric seed values in one column infer a constant-delta linear series
- Formula seeds shift supported A1 references relative to the tiled source formula cell
- Absolute row and column references remain fixed
- Non-editable target cells are skipped
- One completed fill commits as one batch edit and one undo/redo entry

## Unsupported

- Horizontal autofill
- Diagonal or freeform destination areas
- Multi-range autofill
- Destination width mismatches
- Date inference
- Custom text lists such as weekdays or months
- Broad Excel heuristic matching beyond the documented cases
- Double-click fill handle
- Sheet-qualified references, R1C1, named ranges, and structured references

Unsupported or invalid drags produce no preview commit, no mutations, and no history entry.

## Geometry Rules

- The source must be one primary rectangular range.
- The destination must extend directly above or below the source.
- The destination must preserve the source column span exactly.
- Dragging inside the source is a no-op.
- The preview represents only the extension area, not the union of source and extension.

## Fill Modes

Modes are selected independently per source column.

### Copy

Used when the seed is not a supported numeric series and not a formula-only seed column.

Examples:

- `["foo"] -> ["foo", "foo", "foo"]`
- `[7] -> [7, 7, 7]`
- `["A", "B"] -> ["A", "B", "A", "B"]`

### Linear Numeric Series

Used when a column seed has at least two rows and every seed value is numeric.

Inference:

- `step = lastSeed - previousSeed`
- Downward fill continues from the last seed value
- Upward fill continues backward from the first seed value using the same step

Examples:

- `[1, 2] -> 3, 4, 5`
- `[2, 4] -> 6, 8, 10`
- `[1, 3, 5] -> 7, 9, 11`
- `[10, 7] -> 4, 1, -2`

Nulls inside an otherwise numeric seed fall back to copy mode.

### Formula Copy

Used when every seed value in a column is a formula string beginning with `=`.

Behavior:

- Formulas tile by source row
- Each destination formula shifts relative references from the specific source formula cell that tiled into that destination
- Absolute row or column markers remain fixed
- Unsupported reference syntax is preserved unchanged rather than guessed

Examples:

- `=A1` filled down one row becomes `=A2`
- `=A1+B1` filled down two rows becomes `=A3+B3`
- `=$A1` filled down one row becomes `=$A2`
- `=A$1` filled down one row stays `=A$1`

## Non-Editable Targets

- Source cells may be read even if their columns are non-editable
- Target editability controls whether a mutation is emitted
- A fill still commits if at least one editable target changes
- Fully non-editable destinations produce zero mutations

## History

- A completed fill produces one `CellMutation[]`
- That mutation list records `source: "fill"`
- Applying the batch yields one history entry
- Undo restores all pre-fill values in one step
- Redo reapplies all fill mutations in one step
