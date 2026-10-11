import adapter from "@sveltejs/adapter-static";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";
import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [
		tailwindcss(),
		sveltekit({
			preprocess: vitePreprocess(),
			// The companion's Bun server serves build/ as static files; there is no Node SSR server.
			adapter: adapter({ fallback: "200.html" }),
			version: { pollInterval: 0 },
			// Strict CSP as a <meta> in every page; Kit hashes its own bootstrap script. frame-ancestors cannot be
			// set in a meta tag, the server sends it as a header (src/server.ts).
			csp: {
				mode: "hash",
				directives: {
					"default-src": ["self"],
					"script-src": ["self"],
					// bits-ui positions popovers and Svelte transitions animate via inline style attributes.
					"style-src": ["self", "unsafe-inline"],
					"img-src": ["self", "data:"],
					"font-src": ["self"],
					"connect-src": ["self"],
					"object-src": ["none"],
					"base-uri": ["none"],
					"form-action": ["self"],
				},
			},
		}),
	],
	// The companion API during `bun run dev` (start the server with PORT=9002 next to it).
	server: { proxy: { "/api": "http://localhost:9002" } },
	// No data: URLs: small font subsets would otherwise be inlined and blocked by font-src 'self'.
	build: { target: "es2022", assetsInlineLimit: 0 },
});
