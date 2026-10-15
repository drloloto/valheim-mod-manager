// The companion server runs on Bun (its image); Vite+ only runs and caches its tasks. The UI in ui/ is its own
// package with its own config. Formatting, lint and type checks come from the workspace root.
import { defineConfig } from "vite-plus";

export default defineConfig({
	run: {
		tasks: {
			// bun:test, because the server uses Bun's APIs (Bun.file, Bun.spawn); moves to `vp test` with the agent.
			test: "bun test src",
		},
	},
});
