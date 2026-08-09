import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";

const stylesheet = readFileSync(new URL("../sheet.css", import.meta.url), "utf8");

describe("stylesheet theming contract", () => {
	it("declares defaults at zero specificity so host root classes win in either source order", () => {
		expect(stylesheet).toContain(":where(.se-grid) {");
		expect(stylesheet).toMatch(/:where\(\.se-grid\)\s*\{[^}]*--ps-grid-background:/s);
		expect(stylesheet).toMatch(/\.se-grid\s*\{[^}]*position:\s*relative;/s);
	});

	it("defines the documented theme categories on the grid root", () => {
		const usedVariables = [
			"--ps-grid-background",
			"--ps-border-default",
			"--ps-text-primary",
			"--ps-text-muted",
			"--ps-focus",
			"--ps-selection-background",
			"--ps-active-row-background",
			"--ps-surface-header",
			"--ps-editor-background",
			"--ps-menu-background",
			"--ps-search-background",
			"--ps-resize-indicator",
			"--ps-state-success",
		];
		for (const variable of usedVariables) {
			expect(stylesheet).toContain(`${variable}:`);
			expect(stylesheet).toContain(`var(${variable})`);
		}
		for (const variable of ["--ps-state-info", "--ps-state-warning", "--ps-state-danger"]) {
			expect(stylesheet).toContain(`${variable}:`);
		}
	});

	it("keeps literal colors inside the backward-compatible root defaults", () => {
		const rootEnd = stylesheet.indexOf("\n}");
		expect(rootEnd).toBeGreaterThan(0);
		const rules = stylesheet.slice(rootEnd + 2);
		expect(rules).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i);
	});

	it("includes reduced-motion and forced-color fallbacks", () => {
		expect(stylesheet).toContain("@media (prefers-reduced-motion: reduce)");
		expect(stylesheet).toContain("@media (forced-colors: active)");
	});
});
