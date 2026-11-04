import { describe, expect, it } from "bun:test";
import { rowId } from "./brands";
import { createRowRevisions } from "./rowRevisions";

describe("exact identity revision counters", () => {
	it("keeps unobserved counts across retention, forgetting and reuse", () => {
		const revisions = createRowRevisions();
		const a = rowId("a");
		const b = rowId("b");
		const c = rowId("c");
		revisions.bump(new Set([a, b]));
		revisions.bumpOne(b);
		revisions.retain([b, c]);
		expect(revisions.read(a)).toBe(0);
		expect(revisions.read(b)).toBe(2);
		expect(revisions.read(c)).toBe(0);
		revisions.forget([b]);
		revisions.bump(new Set([b, c]));
		expect(revisions.read(b)).toBe(1);
		expect(revisions.read(c)).toBe(1);
	});
});
