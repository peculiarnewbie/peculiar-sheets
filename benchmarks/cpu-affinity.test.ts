import assert from "node:assert/strict";
import { test } from "node:test";
import { homogeneousCpuSet, parseCpuList } from "./cpu-affinity";

test("CPU placement selects the same homogeneous high-capacity cluster for every implementation", () => {
	const allowed = parseCpuList("0-7");
	const capacities = new Map(allowed.map((cpu) => [cpu, cpu < 6 ? 382 : 1024]));
	assert.deepEqual(homogeneousCpuSet(allowed, capacities), [6, 7]);
	assert.deepEqual(homogeneousCpuSet([0, 1, 6], capacities), [6]);
	assert.deepEqual(homogeneousCpuSet([0, 1], capacities), [0, 1]);
	assert.deepEqual(homogeneousCpuSet(allowed, new Map()), allowed);
	assert.deepEqual(
		homogeneousCpuSet(
			[0, 1],
			new Map([
				[0, Number.NaN],
				[1, 1024],
			]),
		),
		[0, 1],
	);
	assert.deepEqual(parseCpuList("0,2-4,3"), [0, 2, 3, 4]);
	assert.throws(() => parseCpuList("4-2"));
	assert.throws(() => parseCpuList("6;echo"));
});
