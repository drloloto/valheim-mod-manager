// Reactive value mirrored to localStorage. Always replace as a whole (set), never mutate.
import { readJson, writeJson, type Parser } from "./storage";

export class Persisted<T> {
	readonly #key: string;
	value = $state.raw<T>(undefined as T);

	constructor(key: string, fallback: T, parse: Parser<T>) {
		this.#key = key;
		this.value = readJson(key, fallback, parse);
	}

	set(v: T) {
		this.value = v;
		writeJson(this.#key, v);
	}

	update(fn: (v: T) => T) {
		this.set(fn(this.value));
	}
}
