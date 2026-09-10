import { copyFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { transform } from "@solidjs/compiler";
import { defineConfig } from "tsdown";

export default defineConfig({
	entry: ["./src/index.ts"],
	format: "esm",
	outDir: "./dist",
	dts: true,
	deps: {
		neverBundle: [/^solid-js(?:\/|$)/, /^@solidjs\//, "@tanstack/virtual-core", "better-result"],
	},
	outExtensions: () => ({ js: ".js", dts: ".d.ts" }),
	hash: false,
	plugins: [
		{
			name: "solid-2-jsx",
			transform: {
				filter: { id: /\.[jt]sx$/ },
				handler(code, id) {
					return transform(code, {
						filename: id,
						generate: "dom",
						moduleName: "@solidjs/web",
						sourceMap: true,
					});
				},
			},
		},
		{
			name: "copy-css",
			async buildEnd() {
				const outDir = resolve(import.meta.dirname, "dist");
				await mkdir(outDir, { recursive: true });
				await copyFile(resolve(import.meta.dirname, "src/sheet.css"), resolve(outDir, "sheet.css"));
			},
		},
	],
});
