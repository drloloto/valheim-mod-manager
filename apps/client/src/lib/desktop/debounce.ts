export function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number) {
	let timer: ReturnType<typeof setTimeout> | null = null;
	let pending: A | null = null;
	const run = () => {
		timer = null;
		const args = pending;
		pending = null;
		if (args) fn(...args);
	};
	const d = (...args: A) => {
		pending = args;
		if (timer) clearTimeout(timer);
		timer = setTimeout(run, ms);
	};
	d.cancel = () => {
		if (timer) clearTimeout(timer);
		timer = null;
		pending = null;
	};
	d.flush = () => {
		if (timer) clearTimeout(timer);
		run();
	};
	return d;
}
