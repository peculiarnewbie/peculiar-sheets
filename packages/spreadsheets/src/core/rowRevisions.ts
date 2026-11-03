import { createSignal, getObserver, type Signal } from "solid-js";
import type { RowId } from "./brands";

/** Row counters with Solid subscriptions only for rows that are being observed. */
export function createRowRevisions() {
	const values = new Map<RowId, number>();
	const observed = new Map<RowId, Signal<number>>();

	function read(id: RowId): number {
		const existing = observed.get(id);
		if (existing) return existing[0]();
		const value = values.get(id) ?? 0;
		if (!getObserver()) return value;
		const signal = createSignal(value, {
			unobserved: () => {
				if (observed.get(id) === signal) observed.delete(id);
			},
		});
		observed.set(id, signal);
		return signal[0]();
	}

	function bumpOne(id: RowId): void {
		const next = (values.get(id) ?? 0) + 1;
		values.set(id, next);
		observed.get(id)?.[1](next);
	}

	function bump(ids: ReadonlySet<RowId>): void {
		for (const id of ids) bumpOne(id);
	}

	function forget(ids: Iterable<RowId>): void {
		for (const id of ids) {
			values.delete(id);
			observed.get(id)?.[1](0);
		}
	}

	function retain(ids: readonly RowId[]): void {
		const retained = new Set(ids);
		for (const id of values.keys()) {
			if (!retained.has(id)) forget([id]);
		}
	}

	return { read, bumpOne, bump, forget, retain };
}
