import { defineConfig } from "vitest/config";
import solid from "@solidjs/vite-plugin";

export default defineConfig({
	plugins: [solid({ hot: false })],
	test: {
		environment: "happy-dom",
		include: ["tests/solid2/**/*.test.tsx"],
	},
});
