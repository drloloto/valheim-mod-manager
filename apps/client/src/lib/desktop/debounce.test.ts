import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { debounce } from "./debounce";

describe("debounce", () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it("debounce runs only the last call", () => {
		const fn = vi.fn();
		const d = debounce(fn, 500);
		d("C:");
		d("C:\\Ste");
		d("C:\\Steam");
		vi.advanceTimersByTime(499);
		expect(fn).not.toHaveBeenCalled();
		vi.advanceTimersByTime(1);
		expect(fn).toHaveBeenCalledTimes(1);
		expect(fn).toHaveBeenCalledWith("C:\\Steam");
	});
	it("flush runs pending immediately, cancel drops it", () => {
		const fn = vi.fn();
		const d = debounce(fn, 500);
		d(1);
		d.flush();
		expect(fn).toHaveBeenCalledWith(1);
		d(2);
		d.cancel();
		vi.advanceTimersByTime(1000);
		expect(fn).toHaveBeenCalledTimes(1);
	});
});
