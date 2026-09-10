import { defineConfig } from "vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import solid from "@solidjs/vite-plugin";

export default defineConfig({
	plugins: [solid(), cloudflare()],
});
