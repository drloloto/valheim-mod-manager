import adapter from "@sveltejs/adapter-static";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";
import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";
import { readFileSync } from "node:fs";
import { defineConfig, type Plugin } from "vitest/config";

// Browser preview without Tauri: serves dev/mock-tauri.js; src/hooks.server.ts injects it (VITE_MOCK_TAURI=1).
function mockTauri(): Plugin {
	return {
		name: "mock-tauri",
		apply: "serve",
		configureServer(server) {
			server.middlewares.use("/__mock-tauri.js", (_req, res) => {
				res.setHeader("Content-Type", "text/javascript");
				res.end(readFileSync("dev/mock-tauri.js"));
			});
		},
	};
}

export default defineConfig({
	plugins: [
		mockTauri(),
		tailwindcss(),
		sveltekit({
			preprocess: vitePreprocess(),
			// Tauri has no Node server: SPA with index.html as the fallback.
			adapter: adapter({ fallback: "index.html" }),
			// The bundle never changes while the app runs; no need to poll _app/version.json.
			version: { pollInterval: 0 },
		}),
	],

	// Tauri expects a fixed port and aborts when it is taken.
	clearScreen: false,
	server: {
		port: 1420,
		strictPort: true,
		watch: {
			// Cargo locks files in the Rust build folder; that crashes Vite's watcher on Windows with EBUSY.
			ignored: ["**/src-tauri/**"],
		},
	},
	envPrefix: ["VITE_", "TAURI_"],
	test: {
		include: ["src/**/*.test.ts"],
		environment: "node",
	},
	build: {
		target: "esnext",
		minify: !process.env.TAURI_ENV_DEBUG ? "esbuild" : false,
		sourcemap: !!process.env.TAURI_ENV_DEBUG,
	},
});
