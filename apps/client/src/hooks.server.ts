import type { Handle } from "@sveltejs/kit/hooks";

// Dev server: browser preview without Tauri. With VITE_MOCK_TAURI=1 the HTML shell loads the mock before the app.
// The variable is unset in builds, so the fallback page stays untouched.
import { dev } from "$app/env";

export const handle: Handle = ({ event, resolve }) =>
	resolve(event, {
		transformPageChunk: ({ html }) => (dev && process.env.VITE_MOCK_TAURI ? html.replace("<head>", '<head><script src="/__mock-tauri.js"></script>') : html),
	});
