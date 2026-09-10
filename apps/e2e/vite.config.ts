import path from "node:path";
import { defineConfig } from "vite";
import solid from "@solidjs/vite-plugin";

export default defineConfig({
	plugins: [solid()],
	resolve: {
		alias: {
			"@tanstack/virtual-core": path.resolve(
				import.meta.dirname,
				"src/virtualizer-instrumentation.ts",
			),
			"peculiar-sheets/styles": path.resolve(
				import.meta.dirname,
				"../../packages/spreadsheets/dist/sheet.css",
			),
			"peculiar-sheets": path.resolve(
				import.meta.dirname,
				"../../packages/spreadsheets/dist/index.js",
			),
		},
	},
	server: {
		port: 3141,
	},
});
