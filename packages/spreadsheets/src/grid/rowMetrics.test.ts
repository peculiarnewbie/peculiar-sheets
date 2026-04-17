import { describe, expect, it } from "bun:test";
import { buildRowMetrics } from "./rowMetrics";

describe("row metrics", () => {
	it("uses the default row height when no override exists", () => {
		const metrics = buildRowMetrics(3, 28, () => undefined);

		expect(metrics.getRowHeight(0)).toBe(28);
		expect(metrics.getRowHeight(1)).toBe(28);
		expect(metrics.getRowHeight(2)).toBe(28);
	});

	it("applies row-specific overrides", () => {
		const metrics = buildRowMetrics(3, 28, (row) => (row === 1 ? 44 : undefined));

		expect(metrics.getRowHeight(0)).toBe(28);
		expect(metrics.getRowHeight(1)).toBe(44);
		expect(metrics.getRowHeight(2)).toBe(28);
	});

	it("computes cumulative top offsets", () => {
		const metrics = buildRowMetrics(3, 28, (row) => (row === 1 ? 40 : undefined));

		expect(metrics.getRowTop(0)).toBe(0);
		expect(metrics.getRowTop(1)).toBe(28);
		expect(metrics.getRowTop(2)).toBe(68);
	});

	it("computes total height from mixed row sizes", () => {
		const metrics = buildRowMetrics(4, 28, (row) => (row === 2 ? 50 : undefined));

		expect(metrics.getTotalHeight()).toBe(134);
	});

	it("maps offsets back to the correct visual row", () => {
		const metrics = buildRowMetrics(3, 28, (row) => (row === 1 ? 44 : undefined));

		expect(metrics.getVisualRowAtOffset(0)).toBe(0);
		expect(metrics.getVisualRowAtOffset(27)).toBe(0);
		expect(metrics.getVisualRowAtOffset(28)).toBe(1);
		expect(metrics.getVisualRowAtOffset(60)).toBe(1);
		expect(metrics.getVisualRowAtOffset(72)).toBe(2);
	});
});
