// The shared UI package has no Vite build of its own; this holds its vp task: svelte-check over the kit parts
// and the generated primitives with the package's tsconfig (which also resolves the #lib alias for the
// shadcn-svelte CLI). Format and lint settings come from the root vite.config.ts.
import { defineConfig } from "vite-plus";

export default defineConfig({
	run: {
		tasks: {
			"check:svelte": {
				command: "svelte-check --tsconfig ./tsconfig.json",
				cache: { input: [{ auto: true }], output: [] },
			},
		},
	},
});
