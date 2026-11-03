import { describe, expect, it } from "bun:test";
import { buildRowMetrics } from "./rowMetrics";
import { getRowWindow } from "./rowWindow";

describe("row window", () => {
	it("covers partially visible rows and preserves overscan on distant jumps", () => {
		const metrics = buildRowMetrics(100_000, 28);
		const rows = getRowWindow(metrics, 100_000, 50_000 * 28 + 10, 560, []);
		expect(rows[0]).toEqual({ index: 49_997, start: 49_997 * 28, size: 28 });
		expect(rows.at(-1)).toEqual({ index: 50_023, start: 50_023 * 28, size: 28 });
		expect(rows).toHaveLength(27);
		const bottom = getRowWindow(metrics, 100_000, metrics.getTotalHeight() - 560, 560, rows);
		expect(bottom[0]?.index).toBe(99_977);
		expect(bottom.at(-1)?.index).toBe(99_999);
		expect(getRowWindow(metrics, 100_000, -100, 560, bottom)[0]?.index).toBe(0);
	});

	it("uses sparse height changes without rebuilding measurements for other rows", () => {
		const metrics = buildRowMetrics(
			10,
			20,
			new Map([
				[2, 80],
				[5, 40],
			]),
		);
		const rows = getRowWindow(metrics, 10, 50, 70, [], 0);
		expect(rows).toEqual([{ index: 2, start: 40, size: 80 }]);
		expect(getRowWindow(metrics, 10, 110, 20, rows, 0)).toEqual([
			{ index: 2, start: 40, size: 80 },
			{ index: 3, start: 120, size: 20 },
		]);
		const resized = buildRowMetrics(
			10,
			20,
			new Map([
				[2, 100],
				[5, 40],
			]),
		);
		expect(getRowWindow(resized, 10, 110, 20, rows, 0)).toEqual([
			{ index: 2, start: 40, size: 100 },
		]);
	});

	it("retains unchanged items and the entire window between row boundaries", () => {
		const metrics = buildRowMetrics(100, 20);
		const before = getRowWindow(metrics, 100, 200, 200, []);
		const same = getRowWindow(metrics, 100, 201, 198, before);
		expect(same).toBe(before);
		const next = getRowWindow(metrics, 100, 220, 200, before);
		expect(next[0]).toBe(before[1]);
		expect(next.slice(0, -1)).toEqual(before.slice(1));
		const small = buildRowMetrics(2, 20);
		expect(getRowWindow(small, 2, 0, 200, next)).toHaveLength(2);
		expect(getRowWindow(small, 0, 0, 200, next)).toEqual([]);
		expect(getRowWindow(metrics, 100, 200, 0, before)).toEqual([]);
	});
});
