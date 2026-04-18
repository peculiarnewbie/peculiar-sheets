import type { CellAddress, CellRange, CellStyle } from "./types";

/** A cell position or rectangular range that a style rule applies to. */
export type StyleTarget = CellAddress | CellRange;

/** A declarative rule: one or more targets sharing a single style. */
export interface RangeStyleRule {
	/** A single cell, a range, or an array mixing both. */
	range: StyleTarget | StyleTarget[];
	/** Inline CSS applied to every matching cell. */
	style: CellStyle;
}

interface NormalizedRange {
	startRow: number;
	endRow: number;
	startCol: number;
	endCol: number;
}

interface CompiledRule {
	ranges: NormalizedRange[];
	style: CellStyle;
}

function isRange(t: StyleTarget): t is CellRange {
	return "start" in t && "end" in t;
}

function normalize(t: StyleTarget): NormalizedRange {
	if (isRange(t)) {
		const { start, end } = t;
		return {
			startRow: Math.min(start.row, end.row),
			endRow: Math.max(start.row, end.row),
			startCol: Math.min(start.col, end.col),
			endCol: Math.max(start.col, end.col),
		};
	}
	return { startRow: t.row, endRow: t.row, startCol: t.col, endCol: t.col };
}

/**
 * Compile a list of range-based style rules into an efficient per-cell lookup
 * function suitable for `SheetCustomization.getCellStyle`.
 *
 * Rules are evaluated in order; **later rules override earlier rules per
 * property** (CSS-cascade semantics). When multiple rules match a cell, their
 * styles are shallow-merged into a single object. Returns `undefined` when no
 * rule matches so the cell falls back to the grid's default styling.
 *
 * Targets can be `CellAddress` (single cell), `CellRange` (rectangular), or
 * an array mixing both. Ranges tolerate reversed `start`/`end` — each axis is
 * normalized via `min`/`max` at registration time.
 *
 * Performance note: lookup is O(rules × ranges-per-rule) per cell. The grid
 * only queries visible cells (virtualized), so up to a few hundred rules with
 * a handful of ranges each is effectively free. If you need to style tens of
 * thousands of rules, build your own indexed lookup instead.
 *
 * @example
 * ```ts
 * import { Sheet, createRangeStyles } from "@stairway/spreadsheets";
 *
 * const getCellStyle = createRangeStyles([
 *   // Header row: dark fill + bold text
 *   {
 *     range: { start: { row: 0, col: 0 }, end: { row: 0, col: 9 } },
 *     style: { backgroundColor: "#1f2937", color: "#fff", fontWeight: 600 },
 *   },
 *   // A single highlighted cell
 *   {
 *     range: { row: 4, col: 2 },
 *     style: { backgroundColor: "#7f1d1d", color: "#fecaca" },
 *   },
 *   // Multiple non-contiguous targets sharing one style
 *   {
 *     range: [
 *       { start: { row: 6, col: 0 }, end: { row: 6, col: 9 } },
 *       { start: { row: 9, col: 0 }, end: { row: 9, col: 9 } },
 *     ],
 *     style: { borderBottom: "2px dashed #4ade80" },
 *   },
 * ]);
 *
 * <Sheet customization={{ getCellStyle }} ... />
 * ```
 */
export function createRangeStyles(
	rules: readonly RangeStyleRule[],
): (row: number, col: number) => CellStyle | undefined {
	const compiled: CompiledRule[] = rules.map((rule) => {
		const targets = Array.isArray(rule.range) ? rule.range : [rule.range];
		return {
			ranges: targets.map(normalize),
			style: rule.style,
		};
	});

	return (row, col) => {
		let merged: CellStyle | undefined;
		for (const rule of compiled) {
			for (const r of rule.ranges) {
				if (
					row >= r.startRow &&
					row <= r.endRow &&
					col >= r.startCol &&
					col <= r.endCol
				) {
					merged = merged ? { ...merged, ...rule.style } : rule.style;
					break; // one match per rule is enough
				}
			}
		}
		return merged;
	};
}
