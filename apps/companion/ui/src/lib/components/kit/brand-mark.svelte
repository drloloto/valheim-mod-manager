<script lang="ts">
	// The VMM rune in currentColor; the colored app icon lives in static/favicon.svg and src-tauri/icons.
	let { class: className = "" }: { class?: string } = $props();
</script>

<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" class={className} aria-hidden="true">
	<path
		d="M76 52v152M180 52v152M76 52l104 94M180 52L76 146"
		stroke="currentColor"
		stroke-width="30"
		stroke-linecap="round"
		stroke-linejoin="round"
		fill="none"
	/>
</svg>
