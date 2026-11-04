import { createSignal, getObserver, type Signal } from "solid-js";
import type { RowId } from "./brands";

/** Exact row counters, with subscriptions allocated only for observed rows. */
export function createRowRevisions() {
	interface Entry {
		value: number;
		signal?: Signal<number>;
	}
	const entries = new Map<RowId, Entry>();
	function read(id: RowId): number {
		let entry = entries.get(id);
		if (entry?.signal) return entry.signal[0]();
		const value = entry?.value ?? 0;
		if (!getObserver()) return value;
		if (!entry) {
			entry = { value };
			entries.set(id, entry);
		}
		const owned = entry;
		const signal = createSignal(value, {
			unobserved: () => {
				if (owned.signal !== signal) return;
				delete owned.signal;
				if (owned.value === 0 && entries.get(id) === owned) entries.delete(id);
			},
		});
		entry.signal = signal;
		return signal[0]();
	}
	function bumpOne(id: RowId): void {
		const entry = entries.get(id);
		if (entry) {
			entry.value++;
			entry.signal?.[1](entry.value);
		} else entries.set(id, { value: 1 });
	}
	function bump(ids: ReadonlySet<RowId>): void {
		for (const id of ids) bumpOne(id);
	}
	function forget(ids: Iterable<RowId>): void {
		for (const id of ids) {
			const entry = entries.get(id);
			if (!entry) continue;
			entry.value = 0;
			if (entry.signal) entry.signal[1](0);
			else entries.delete(id);
		}
	}
	function retain(ids: readonly RowId[]): void {
		if (entries.size <= 1) {
			for (const id of entries.keys()) if (!ids.includes(id)) forget([id]);
			return;
		}
		const retained = new Set(ids);
		for (const id of entries.keys()) if (!retained.has(id)) forget([id]);
	}
	return { read, bumpOne, bump, forget, retain };
}
