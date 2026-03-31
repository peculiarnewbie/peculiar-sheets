import { copyFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import solid from "@rolldown-plugin/solid";
import { defineConfig } from "tsdown";

export default defineConfig({
	entry: ["./src/index.ts"],
	format: "esm",
	outDir: "./dist",
	dts: true,
	hash: false,
	plugins: [
		solid({
			solid: {
				generate: "dom",
				delegateEvents: true,
			},
		}),
		{
			name: "copy-css",
			async buildEnd() {
				const outDir = resolve(import.meta.dirname, "dist");
				await mkdir(outDir, { recursive: true });
				await copyFile(
					resolve(import.meta.dirname, "src/sheet.css"),
					resolve(outDir, "sheet.css"),
				);
			},
		},
	],
});
