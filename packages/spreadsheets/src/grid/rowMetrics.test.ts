import { describe, expect, it } from "bun:test";
import { visualRow } from "../core/brands";
import { buildRowMetrics } from "./rowMetrics";

function overrides(entries: Array<[number, number]>): Map<number, number> {
	return new Map(entries);
}

describe("row metrics", () => {
	it("uses the default row height when no override exists", () => {
		const metrics = buildRowMetrics(3, 28);

		expect(metrics.getRowHeight(visualRow(0))).toBe(28);
		expect(metrics.getRowHeight(visualRow(1))).toBe(28);
		expect(metrics.getRowHeight(visualRow(2))).toBe(28);
	});

	it("applies row-specific overrides", () => {
		const metrics = buildRowMetrics(3, 28, overrides([[1, 44]]));

		expect(metrics.getRowHeight(visualRow(0))).toBe(28);
		expect(metrics.getRowHeight(visualRow(1))).toBe(44);
		expect(metrics.getRowHeight(visualRow(2))).toBe(28);
	});

	it("computes cumulative top offsets", () => {
		const metrics = buildRowMetrics(3, 28, overrides([[1, 40]]));

		expect(metrics.getRowTop(visualRow(0))).toBe(0);
		expect(metrics.getRowTop(visualRow(1))).toBe(28);
		expect(metrics.getRowTop(visualRow(2))).toBe(68);
	});

	it("computes total height from mixed row sizes", () => {
		const metrics = buildRowMetrics(4, 28, overrides([[2, 50]]));

		expect(metrics.getTotalHeight()).toBe(134);
	});

	it("maps offsets back to the correct visual row", () => {
		const metrics = buildRowMetrics(3, 28, overrides([[1, 44]]));

		expect(metrics.getVisualRowAtOffset(0)).toBe(0);
		expect(metrics.getVisualRowAtOffset(27)).toBe(0);
		expect(metrics.getVisualRowAtOffset(28)).toBe(1);
		expect(metrics.getVisualRowAtOffset(60)).toBe(1);
		expect(metrics.getVisualRowAtOffset(72)).toBe(2);
	});

	it("handles first, middle, and last sparse overrides", () => {
		const metrics = buildRowMetrics(
			5,
			10,
			overrides([
				[0, 30],
				[2, 40],
				[4, 50],
			]),
		);

		expect(metrics.getRowTop(visualRow(0))).toBe(0);
		expect(metrics.getRowTop(visualRow(1))).toBe(30);
		expect(metrics.getRowTop(visualRow(2))).toBe(40);
		expect(metrics.getRowTop(visualRow(3))).toBe(80);
		expect(metrics.getRowTop(visualRow(4))).toBe(90);
		expect(metrics.getTotalHeight()).toBe(140);
		expect(metrics.getRowTop(visualRow(5))).toBe(140);
	});

	it("clamps negative and out-of-range offsets to edge rows", () => {
		const metrics = buildRowMetrics(3, 28, overrides([[1, 44]]));

		expect(metrics.getVisualRowAtOffset(-10)).toBe(0);
		expect(metrics.getVisualRowAtOffset(1000)).toBe(2);
		expect(metrics.getRowTop(visualRow(-1))).toBe(0);
		expect(metrics.getRowTop(visualRow(99))).toBe(metrics.getTotalHeight());
	});

	it("maps offsets exactly on row boundaries", () => {
		const metrics = buildRowMetrics(3, 28, overrides([[1, 44]]));

		// Bottom edge of a row is exclusive for that row (belongs to the next).
		expect(metrics.getVisualRowAtOffset(28)).toBe(1);
		expect(metrics.getVisualRowAtOffset(72)).toBe(2);
		expect(metrics.getVisualRowAtOffset(metrics.getTotalHeight())).toBe(2);
	});

	it("ignores out-of-bounds and default-equal overrides", () => {
		const metrics = buildRowMetrics(
			3,
			28,
			overrides([
				[-1, 99],
				[1, 28],
				[3, 99],
			]),
		);

		expect(metrics.getTotalHeight()).toBe(84);
		expect(metrics.getRowTop(visualRow(2))).toBe(56);
	});

	it("does not expose row-count-sized height/offset arrays", () => {
		const metrics = buildRowMetrics(1_000_000, 28);

		expect("heights" in metrics).toBe(false);
		expect("offsets" in metrics).toBe(false);
		expect(metrics.getTotalHeight()).toBe(28_000_000);
		expect(metrics.getRowTop(visualRow(500_000))).toBe(14_000_000);
		expect(metrics.getVisualRowAtOffset(14_000_000)).toBe(500_000);
		expect(metrics.getRowHeight(visualRow(999_999))).toBe(28);
	});

	it("keeps sparse override lookups correct on a large grid", () => {
		const metrics = buildRowMetrics(
			100_000,
			20,
			overrides([
				[0, 50],
				[50_000, 80],
				[99_999, 10],
			]),
		);

		expect(metrics.getRowTop(visualRow(0))).toBe(0);
		expect(metrics.getRowTop(visualRow(1))).toBe(50);
		expect(metrics.getRowTop(visualRow(50_000))).toBe(50 + 49_999 * 20);
		expect(metrics.getRowHeight(visualRow(50_000))).toBe(80);
		expect(metrics.getRowHeight(visualRow(99_999))).toBe(10);
		expect(metrics.getTotalHeight()).toBe(100_000 * 20 + (50 - 20) + (80 - 20) + (10 - 20));
		expect(metrics.getVisualRowAtOffset(metrics.getRowTop(visualRow(50_000)))).toBe(50_000);
	});
});
