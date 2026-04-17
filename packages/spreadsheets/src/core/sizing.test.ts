import { describe, expect, it } from "bun:test";
import type { ColumnDef } from "../types";
import { clampColumnWidth, getColumnWidth, getEffectiveColumnWidth } from "./sizing";

function column(overrides?: Partial<ColumnDef>): ColumnDef {
	return {
		id: "name",
		header: "Name",
		...overrides,
	};
}

describe("sizing helpers", () => {
	it("falls back to column width when no committed override exists", () => {
		expect(getEffectiveColumnWidth(column({ width: 180 }), new Map())).toBe(180);
	});

	it("uses the committed override when present", () => {
		expect(
			getEffectiveColumnWidth(
				column({ width: 180 }),
				new Map([["name", 240]]),
			),
		).toBe(240);
	});

	it("clamps to the minimum width", () => {
		expect(clampColumnWidth(column({ minWidth: 90 }), 40)).toBe(90);
	});

	it("clamps to the maximum width", () => {
		expect(clampColumnWidth(column({ maxWidth: 200 }), 260)).toBe(200);
	});

	it("uses defaults when the column cannot be found", () => {
		expect(getColumnWidth("missing", [], new Map())).toBe(120);
	});
});
