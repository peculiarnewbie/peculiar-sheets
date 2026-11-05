import { describe, expect, it } from "bun:test";
import { createEffect, createRoot, flush } from "solid-js";
import { columnIdx, physicalRow, rowId } from "./brands";
import { applyMutations } from "./commands";
import type { HistoryStack } from "./history";
import { createSheetStore } from "./state";

function fixture() {
	const store = createSheetStore([[0]], [{ id: "value", header: "Value" }], [rowId("row")]);
	const write = (value: number) => {
		applyMutations(store, [
			{
				address: { row: physicalRow(0), col: columnIdx(0) },
				columnId: "value",
				oldValue: store.cells[0]?.[0] ?? null,
				newValue: value,
				source: "external",
			},
		]);
	};
	return { store, write };
}

describe("store-owned history", () => {
	it("preserves snapshots while enforcing the history limit and clearing redo on a new edit", () => {
		const { store, write } = fixture();
		const initial = store.history();
		for (let value = 1; value <= 250; value++) write(value);
		const full = store.history();
		expect(store.history()).toBe(full);
		expect(full.undoStack).toHaveLength(200);
		expect(initial.undoStack).toHaveLength(0);
		for (let count = 0; count < 200; count++) store.undo();
		expect(store.cells[0]?.[0]).toBe(50);
		expect(store.undo()).toBeNull();
		const undone = store.history();
		expect(undone.redoStack).toHaveLength(200);
		store.redo();
		expect(store.cells[0]?.[0]).toBe(51);
		write(999);
		expect(store.canRedo()).toBe(false);
		expect(full.undoStack).toHaveLength(200);
		expect(full.redoStack).toHaveLength(0);
		expect(undone.undoStack).toHaveLength(0);
		expect(undone.redoStack).toHaveLength(200);
	});

	it("restores history after a failed transition and keeps retained snapshots isolated", () => {
		const { store, write } = fixture();
		write(1);
		write(2);
		const before = store.history();
		const transition = store.beginUndo();
		if (!transition) throw new Error("Undo transition missing");
		expect(store.cells[0]?.[0]).toBe(1);
		expect(store.canRedo()).toBe(true);
		transition.rollback();
		expect(store.cells[0]?.[0]).toBe(2);
		expect(store.history()).toEqual(before);
		write(3);
		expect(before.undoStack).toHaveLength(2);
		expect(before.redoStack).toHaveLength(0);
		expect(store.history().undoStack).toHaveLength(3);
	});

	it("keeps commands synchronous and batches reactive history snapshots", () => {
		const snapshots: HistoryStack[] = [];
		const { store, write } = fixture();
		const dispose = createRoot((dispose) => {
			createEffect(
				() => store.history(),
				(history) => {
					snapshots.push(history);
				},
			);
			return dispose;
		});
		try {
			flush();
			write(1);
			write(2);
			expect(store.canUndo()).toBe(true);
			expect(snapshots).toHaveLength(1);
			flush();
			expect(snapshots.map((history) => history.undoStack.length)).toEqual([0, 2]);
			store.undo();
			write(3);
			flush();
			expect(snapshots.map((history) => history.undoStack.length)).toEqual([0, 2, 2]);
			expect(snapshots.map((history) => history.redoStack.length)).toEqual([0, 0, 0]);
		} finally {
			dispose();
		}
	});

	it("preserves revisions and history while observers leave and return", () => {
		const { store, write } = fixture();
		const revisions: number[] = [];
		const lengths: number[] = [];
		const observe = () =>
			createRoot((dispose) => {
				createEffect(
					() => store.dataRevision(),
					(revision) => {
						revisions.push(revision);
					},
				);
				createEffect(
					() => store.history(),
					(history) => {
						lengths.push(history.undoStack.length);
					},
				);
				return dispose;
			});
		write(1);
		const stop = observe();
		flush();
		write(2);
		write(3);
		flush();
		stop();
		flush();
		write(4);
		write(5);
		expect(store.dataRevision()).toBe(5);
		const stopAgain = observe();
		try {
			flush();
			expect(revisions).toEqual([1, 3, 5]);
			expect(lengths).toEqual([1, 3, 5]);
		} finally {
			stopAgain();
		}
	});
});
