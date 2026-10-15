// Workspace root: formatting, lint and type-check settings for every package (Vite+ reads them only from here),
// the pre-commit check, and the repo-wide tasks. Each app's own vite.config.ts holds its Vite and test settings
// and its package tasks (svelte-check, cargo, docker).
//
//   vp check          format + lint + type-check (.ts; .svelte is checked by each app's check:svelte task)
//   vp run ci         the whole gate: check, svelte-check, tests, builds, the Rust core, cached per input
//   vp check --fix    what the pre-commit hook runs on staged files
import { defineConfig } from "vite-plus";

/** Generated, vendored or local-only: never formatted or linted. */
const IGNORED = [
	"**/node_modules/**",
	"**/.svelte-kit/**",
	"**/build/**",
	"**/dist/**",
	"**/src-tauri/target/**",
	"**/src-tauri/gen/**",
	// shadcn-svelte output: regenerated with `shadcn-svelte add`, never edited by hand (AGENTS.md)
	"packages/ui/src/components/ui/**",
	"packages/ui/src/style-vega.css",
	"docs/design/**",
	"pnpm-lock.yaml",
	// the docker test stack's runtime state (game data, configs, backups) and local design-sync scratch
	"test/data/**",
	"test/config/**",
	"test/backups/**",
	"test/e2e/out/**",
	"spike/**",
	"ds-bundle/**",
	".design-sync/**",
];

export default defineConfig({
	staged: {
		"*": "vp check --fix",
	},
	lint: {
		jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
		rules: { "vite-plus/prefer-vite-plus-imports": "error" },
		options: { typeAware: true, typeCheck: true },
		ignorePatterns: IGNORED,
	},
	fmt: {
		useTabs: true,
		printWidth: 160,
		sortPackageJson: false,
		sortTailwindcss: {},
		svelte: {},
		associations: [{ files: ["*.svelte"], language: "svelte" }],
		ignorePatterns: IGNORED,
	},
	run: {
		tasks: {
			// The gate for people, agents and CI. Every step is its own cached task; unchanged inputs replay.
			ci: {
				command: "vp check",
				dependsOn: [
					"@vmm/client#check:svelte",
					"@vmm/client#test",
					"@vmm/client#build",
					"@vmm/client#rust",
					"@vmm/companion#test",
					"@vmm/companion-ui#check:svelte",
					"@vmm/companion-ui#build",
				],
			},
		},
	},
});
