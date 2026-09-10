import { flush } from "solid-js";
import { createEffect, createRoot, createSignal } from "solid-js";
import { describe, expect, it } from "bun:test";
import { createActiveSearchScanSource } from "./search";

describe("active search scan source", () => {
	it("does not subscribe to grid revisions while the query is empty", () => {
		createRoot((dispose) => {
			const [query, setQuery] = createSignal("");
			const [dataRevision, setDataRevision] = createSignal(0);
			const [formulaRevision, setFormulaRevision] = createSignal(0);
			const scans: Array<string | null> = [];
			const source = createActiveSearchScanSource({
				query,
				rowCount: () => 10_000,
				colCount: () => 20,
				dataRevision,
				formulaRevision,
			});

			createEffect(source, (scan) => {
				scans.push(scan?.query ?? null);
			});
			flush();
			expect(scans).toEqual([null]);

			setDataRevision(1);
			setFormulaRevision(1);
			flush();
			expect(scans).toEqual([null]);

			setQuery("needle");
			flush();
			expect(scans).toEqual([null, "needle"]);
			setDataRevision(2);
			flush();
			expect(scans).toEqual([null, "needle", "needle"]);

			setQuery("");
			flush();
			expect(scans).toEqual([null, "needle", "needle", null]);
			setDataRevision(3);
			setFormulaRevision(2);
			flush();
			expect(scans).toEqual([null, "needle", "needle", null]);
			dispose();
		});
	});
});
