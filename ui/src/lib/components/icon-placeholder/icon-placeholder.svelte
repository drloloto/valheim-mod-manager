<!--
  Minimal stand-in for shadcn-svelte's multi-icon-library placeholder (docs-only
  feature). This app only ever uses the `lucide` icon name, resolved directly
  against @lucide/svelte.
-->
<script lang="ts">
	import CheckIcon from "@lucide/svelte/icons/check";
	import MinusIcon from "@lucide/svelte/icons/minus";
	import XIcon from "@lucide/svelte/icons/x";
	import ChevronDownIcon from "@lucide/svelte/icons/chevron-down";
	import Loader2Icon from "@lucide/svelte/icons/loader-2";
	import CircleCheckIcon from "@lucide/svelte/icons/circle-check";
	import OctagonXIcon from "@lucide/svelte/icons/octagon-x";
	import InfoIcon from "@lucide/svelte/icons/info";
	import TriangleAlertIcon from "@lucide/svelte/icons/triangle-alert";

	const icons = {
		CheckIcon,
		MinusIcon,
		XIcon,
		ChevronDownIcon,
		Loader2Icon,
		CircleCheckIcon,
		OctagonXIcon,
		InfoIcon,
		TriangleAlertIcon,
	};

	let { lucide, class: className, ...restProps }: { lucide: keyof typeof icons; class?: string; [key: string]: unknown } = $props();

	const IconComponent = $derived(icons[lucide]);
</script>

<IconComponent class={className} {...restProps} />
