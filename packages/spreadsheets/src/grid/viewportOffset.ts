import type { VirtualizerOptions } from "@tanstack/virtual-core";

type OffsetObserver = VirtualizerOptions<HTMLDivElement, HTMLElement>["observeElementOffset"];
type OffsetCallback = Parameters<OffsetObserver>[1];

interface OffsetSource {
	scrollElement: HTMLDivElement | null;
	targetWindow: Window | null;
	options: { horizontal?: boolean; isRtl?: boolean };
}

interface OffsetSubscription {
	horizontal: boolean;
	rtl: boolean;
	callback: OffsetCallback;
}

interface ViewportObservation {
	subscriptions: Set<OffsetSubscription>;
	dispose(): void;
}

/** Read both axes before notifying Solid, so one scroll event has one render flush. */
export function createViewportOffsetObserver(resetDelay = 150) {
	const observations = new WeakMap<HTMLDivElement, ViewportObservation>();
	return (instance: OffsetSource, callback: OffsetCallback) => {
		const viewport = instance.scrollElement;
		const targetWindow = instance.targetWindow;
		if (!viewport || !targetWindow) return;
		let observation = observations.get(viewport);
		if (!observation) {
			const subscriptions = new Set<OffsetSubscription>();
			let resetTimer: number | undefined;
			const notify = (scrolling: boolean) => {
				const top = viewport.scrollTop;
				const left = viewport.scrollLeft;
				for (const subscription of subscriptions) {
					const offset = subscription.horizontal ? left * (subscription.rtl ? -1 : 1) : top;
					subscription.callback(offset, scrolling);
				}
			};
			const onScroll = () => {
				if (resetTimer !== undefined) targetWindow.clearTimeout(resetTimer);
				resetTimer = targetWindow.setTimeout(() => {
					resetTimer = undefined;
					notify(false);
				}, resetDelay);
				notify(true);
			};
			viewport.addEventListener("scroll", onScroll, { passive: true });
			observation = {
				subscriptions,
				dispose() {
					viewport.removeEventListener("scroll", onScroll);
					if (resetTimer !== undefined) targetWindow.clearTimeout(resetTimer);
				},
			};
			observations.set(viewport, observation);
		}
		const subscription: OffsetSubscription = {
			horizontal: instance.options.horizontal ?? false,
			rtl: instance.options.isRtl ?? false,
			callback,
		};
		observation.subscriptions.add(subscription);
		return () => {
			observation.subscriptions.delete(subscription);
			if (observation.subscriptions.size === 0) {
				observation.dispose();
				observations.delete(viewport);
			}
		};
	};
}
