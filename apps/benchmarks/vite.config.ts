import path from "node:path";
import { defineConfig } from "vite";
import solid from "vite-plugin-solid";

export default defineConfig({
	plugins: [solid()],
	resolve: {
		alias: {
			"peculiar-sheets/styles": path.resolve(__dirname, "../../packages/spreadsheets/dist/sheet.css"),
			"peculiar-sheets": path.resolve(__dirname, "../../packages/spreadsheets/dist/index.js"),
		},
	},
});
