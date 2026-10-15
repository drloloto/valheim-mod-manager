// svelte-check and the Svelte language server look for the nearest Svelte config of every .svelte file; the
// apps have theirs in vite.config.ts, the shared components need this one (TypeScript in <script lang="ts">).
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

export default { preprocess: vitePreprocess() };
