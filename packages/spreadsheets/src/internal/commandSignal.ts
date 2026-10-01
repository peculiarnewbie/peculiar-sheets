import { createSignal, getObserver, type Accessor } from "solid-js";

type CommandSetter<T> = (value: Exclude<T, Function> | ((previous: T) => T)) => T;

/**
 * Synchronous command state with Solid's normal batched render notifications.
 * rc.9's `latest()` only serves flushed writes. Keep the writer's value locally
 * so chained commands can read it without flushing the host application.
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
		current = setCommitted((previous) =>
			typeof value === "function" ? (value as (previous: T) => T)(previous) : value,
		);
		return current;
	};
	return [read, write];
}
