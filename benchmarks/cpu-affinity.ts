/** Parse Linux CPU-list notation without shell interpretation. */
export function parseCpuList(value: string): number[] {
	const cpus = new Set<number>();
	for (const part of value.trim().split(",")) {
		const match = /^(\d+)(?:-(\d+))?$/.exec(part);
		if (!match) throw new Error(`Invalid CPU list: ${value}`);
		const first = Number(match[1]),
			last = Number(match[2] ?? match[1]);
		if (last < first || last > 65535 || last - first > 4096)
			throw new Error(`Invalid CPU range: ${part}`);
		for (let cpu = first; cpu <= last; cpu++) cpus.add(cpu);
	}
	return [...cpus].sort((a, b) => a - b);
}

/** Keep homogeneous hosts unrestricted; isolate the highest-capacity cluster on mixed hosts. */
export function homogeneousCpuSet(
	allowed: readonly number[],
	capacities: ReadonlyMap<number, number>,
): number[] {
	const values = allowed.map((cpu) => capacities.get(cpu));
	if (values.some((value) => value === undefined || !Number.isFinite(value) || value <= 0))
		return [...allowed];
	const maximum = Math.max(...values.map((value) => value ?? 0));
	const selected = allowed.filter((cpu) => capacities.get(cpu) === maximum);
	return selected.length ? selected : [...allowed];
}
