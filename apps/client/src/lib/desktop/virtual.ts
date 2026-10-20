// Window computation for virtualized lists with a fixed row height.

export interface Range {
	start: number;
	end: number;
}

export function visibleRange(scrollTop: number, viewport: number, rowHeight: number, count: number, overscan = 6): Range {
	if (count === 0 || rowHeight <= 0) return { start: 0, end: 0 };
	const maxTop = Math.max(0, count * rowHeight - viewport);
	const top = Math.min(Math.max(0, scrollTop), maxTop);
	const first = Math.floor(top / rowHeight);
	const last = Math.ceil((top + viewport) / rowHeight);
	return { start: Math.max(0, first - overscan), end: Math.min(count, last + overscan) };
}

export function scrollToReveal(index: number, rowHeight: number, scrollTop: number, viewport: number): number {
	const top = index * rowHeight;
	const bottom = top + rowHeight;
	if (top < scrollTop) return top;
	if (bottom > scrollTop + viewport) return bottom - viewport;
	return scrollTop;
}
