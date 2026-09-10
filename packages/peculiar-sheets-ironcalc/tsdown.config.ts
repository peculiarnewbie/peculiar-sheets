import { defineConfig } from "tsdown";

export default defineConfig({
	entry: ["./src/index.ts"],
	format: "esm",
	outDir: "./dist",
	dts: true,
	hash: false,
	deps: { neverBundle: ["@ironcalc/wasm", "peculiar-sheets"] },
	outExtensions: () => ({ js: ".js", dts: ".d.ts" }),
});
