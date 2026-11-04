import assert from "node:assert/strict";
import { test } from "node:test";
import { sampleOrder } from "./sampling";

test("twelve repetitions balance every run position for two, three, and four libraries", () => {
	for (const size of [2, 3, 4]) {
		const libraries = Array.from({ length: size }, (_, i) => `library-${i}`);
		const counts = new Map(libraries.map((l) => [l, new Array<number>(size).fill(0)]));
		for (let iteration = 0; iteration < 12; iteration++) {
			const order = sampleOrder(libraries, iteration);
			assert.equal(new Set(order).size, size);
			order.forEach((library, position) => {
				const row = counts.get(library);
				if (!row) throw new Error("Unknown library");
				row[position] = (row[position] ?? 0) + 1;
			});
		}
		for (const row of counts.values()) assert.deepEqual(row, new Array(size).fill(12 / size));
	}
	assert.deepEqual(sampleOrder([], 0), []);
});
