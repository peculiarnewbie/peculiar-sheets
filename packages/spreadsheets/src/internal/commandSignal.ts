import { type Accessor, createSignal, getObserver, type Signal } from "solid-js";

type CommandSetter<T> = (value: Exclude<T, Function> | ((previous: T) => T)) => T;

/**
 * Synchronous command state with Solid's normal batched render notifications.
 * Keep the writer's value locally so chained commands can read their own writes
 * without flushing the host application.
 * Tracked readers use the signal so derivations stay in Solid's committed frame.
 * Like the sheet's cell array, this is imperative state, not an async derivation.
 */
export function createCommandSignal<T>(
	initialValue: Exclude<T, Function>,
): [Accessor<T>, CommandSetter<T>] {
	let current: T = initialValue;
	const [committed, setCommitted] = createSignal<T>(initialValue);
	const read = () => (getObserver() ? committed() : current);
	const write: CommandSetter<T> = (value) => {
		current = setCommitted(value);
		return current;
	};
	return [read, write];
}

/** Revision metadata needs a Solid source only while reactive readers exist. */
export function createRevisionCounter(): readonly [Accessor<number>, () => void] {
	let value = 0;
	let observed: Signal<number> | undefined;
	const read = () => {
		if (!getObserver()) return value;
		const existing = observed;
		if (existing) return existing[0]();
		const signal: Signal<number> = createSignal(value, {
			unobserved: () => {
				if (observed === signal) observed = undefined;
			},
		});
		observed = signal;
		return signal[0]();
	};
	const bump = () => {
		value++;
		observed?.[1](value);
	};
	return [read, bump];
}
