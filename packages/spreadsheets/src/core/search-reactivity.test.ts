import { createComputed, createRoot, createSignal, on } from "solid-js/dist/solid.js";
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

			createComputed(on(source, (scan) => scans.push(scan?.query ?? null)));
			expect(scans).toEqual([null]);

			setDataRevision(1);
			setFormulaRevision(1);
			expect(scans).toEqual([null]);

			setQuery("needle");
			expect(scans).toEqual([null, "needle"]);
			setDataRevision(2);
			expect(scans).toEqual([null, "needle", "needle"]);

			setQuery("");
			expect(scans).toEqual([null, "needle", "needle", null]);
			setDataRevision(3);
			setFormulaRevision(2);
			expect(scans).toEqual([null, "needle", "needle", null]);
			dispose();
		});
	});
});
