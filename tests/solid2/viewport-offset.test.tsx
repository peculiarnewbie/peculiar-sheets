import { afterEach, describe, expect, it, vi } from "vitest";
import { createViewportOffsetObserver } from "../../packages/spreadsheets/src/grid/viewportOffset";

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

function virtualizer(viewport: HTMLDivElement, horizontal = false, isRtl = false) {
	return {
		scrollElement: viewport,
		targetWindow: window,
		options: { horizontal, isRtl },
	};
}

describe("shared viewport offsets", () => {
	it("captures both offsets before either subscriber can update the viewport", () => {
		vi.useFakeTimers();
		const viewport = document.createElement("div");
		viewport.scrollTop = 100;
		viewport.scrollLeft = 200;
		const observe = createViewportOffsetObserver();
		const addListener = vi.spyOn(viewport, "addEventListener");
		const seen: Array<[number, boolean]> = [];
		const stopRows = observe(virtualizer(viewport), (offset, scrolling) => {
			seen.push([offset, scrolling]);
			viewport.scrollLeft = 300;
		});
		const stopColumns = observe(virtualizer(viewport, true), (offset, scrolling) => {
			seen.push([offset, scrolling]);
		});
		expect(addListener.mock.calls.filter(([event]) => event === "scroll")).toHaveLength(1);
		viewport.dispatchEvent(new Event("scroll"));
		expect(seen).toEqual([
			[100, true],
			[200, true],
		]);
		vi.advanceTimersByTime(150);
		expect(seen.slice(2)).toEqual([
			[100, false],
			[300, false],
		]);
		stopRows?.();
		stopColumns?.();
	});

	it("keeps the other axis subscribed and cancels pending work on final cleanup", () => {
		vi.useFakeTimers();
		const viewport = document.createElement("div");
		viewport.scrollTop = 28;
		viewport.scrollLeft = -100;
		const observe = createViewportOffsetObserver();
		const rows = vi.fn();
		const columns = vi.fn();
		const stopRows = observe(virtualizer(viewport), rows);
		const stopColumns = observe(virtualizer(viewport, true, true), columns);
		viewport.dispatchEvent(new Event("scroll"));
		stopRows?.();
		vi.advanceTimersByTime(100);
		viewport.scrollLeft = -200;
		viewport.dispatchEvent(new Event("scroll"));
		vi.advanceTimersByTime(100);
		expect(rows.mock.calls).toEqual([[28, true]]);
		expect(columns.mock.calls).toEqual([
			[100, true],
			[200, true],
		]);
		stopColumns?.();
		vi.advanceTimersByTime(200);
		viewport.dispatchEvent(new Event("scroll"));
		expect(columns).toHaveBeenCalledTimes(2);
		const restarted = vi.fn();
		const stopRestarted = observe(virtualizer(viewport), restarted);
		viewport.dispatchEvent(new Event("scroll"));
		expect(restarted.mock.calls).toEqual([[28, true]]);
		stopRestarted?.();
	});
});
