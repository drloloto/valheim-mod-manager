import adapter from "@sveltejs/adapter-static";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";
import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";
import { readFileSync } from "node:fs";
import { defineConfig, type Plugin, lazyPlugins } from "vite-plus";

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

// SvelteKit writes these itself while it runs (sync, types, the build); they are results, not inputs.
const SVELTEKIT_GENERATED = ["!.svelte-kit/**", "!build/**", "!node_modules/$app/**"];

export default defineConfig({
	plugins: lazyPlugins(() => [
		mockTauri(),
		tailwindcss(),
		sveltekit({
			preprocess: vitePreprocess(),
			// Tauri has no Node server: SPA with index.html as the fallback.
			adapter: adapter({ fallback: "index.html" }),
			// The bundle never changes while the app runs; no need to poll _app/version.json.
			version: { pollInterval: 0 },
		}),
	]),

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
	// Package tasks (`vp run <task>`, cached by their inputs). package.json keeps only the entry points people
	// start by hand: dev, the Tauri CLI and the DEV app.
	run: {
		tasks: {
			build: {
				command: "vp build",
				// a Tauri debug build changes minify and source maps (see build above)
				cache: {
					env: ["TAURI_ENV_*", "VITE_MOCK_TAURI"],
					// the Rust core is not an input of the web build (Vite's scan also touches src-tauri/target)
					input: [{ auto: true }, ...SVELTEKIT_GENERATED, "!src-tauri/**"],
					output: [{ auto: true }, "!.svelte-kit/**", "!node_modules/$app/**"],
				},
			},
			test: { command: "vp test run", cache: { input: [{ auto: true }, ...SVELTEKIT_GENERATED] } },
			"check:svelte": {
				command: "svelte-kit sync && svelte-check --tsconfig ./tsconfig.json",
				cache: { input: [{ auto: true }, ...SVELTEKIT_GENERATED], output: [] },
			},
			// The Rust core. generate_context! embeds the frontend build, so it comes first. The inputs are the
			// crate's own files and the build; target/ is cargo's own cache and never archived.
			rust: {
				command: ["cargo fmt --check", "cargo clippy --all-targets -- -D warnings", "cargo test"],
				cwd: "src-tauri",
				dependsOn: ["build"],
				cache: {
					input: [
						"src-tauri/src/**",
						"src-tauri/tests/**",
						"src-tauri/Cargo.toml",
						"src-tauri/Cargo.lock",
						"src-tauri/build.rs",
						"src-tauri/rustfmt.toml",
						"src-tauri/tauri*.json",
						"src-tauri/capabilities/**",
						"src-tauri/icons/**",
						"build/**",
						// Kit writes a fresh timestamp into it on every build; the app never polls it (pollInterval: 0)
						"!build/_app/version.json",
					],
					output: [],
				},
			},
		},
	},
});
