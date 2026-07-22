import { defineConfig } from "tsdown";

export default defineConfig({
	entry: ["./src/index.ts"],
	format: "esm",
	outDir: "./dist",
	dts: true,
	hash: false,
	external: ["hyperformula", "peculiar-sheets", "solid-js"],
});
