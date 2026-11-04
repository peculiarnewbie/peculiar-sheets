/** Rotate equally sized iteration blocks so no implementation always runs first. */
export function sampleOrder<T>(implementations: readonly T[], iteration: number): T[] {
	if (!implementations.length) return [];
	const offset = Math.max(0, iteration) % implementations.length;
	return [...implementations.slice(offset), ...implementations.slice(0, offset)];
}
