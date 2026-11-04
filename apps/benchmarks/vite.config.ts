import path from "node:path";
import { defineConfig } from "vite";
import solid from "@solidjs/vite-plugin";

export default defineConfig({
	server: {
		headers: {
			"Cross-Origin-Opener-Policy": "same-origin",
			"Cross-Origin-Embedder-Policy": "require-corp",
		},
	},
	preview: {
		headers: {
			"Cross-Origin-Opener-Policy": "same-origin",
			"Cross-Origin-Embedder-Policy": "require-corp",
		},
	},
	plugins: [solid()],
	resolve: {
		alias: {
			"peculiar-sheets/styles": path.resolve(
				__dirname,
				"../../packages/spreadsheets/dist/sheet.css",
			),
			"peculiar-sheets": path.resolve(__dirname, "../../packages/spreadsheets/dist/index.js"),
		},
	},
});
