import { describe, expect, it } from "bun:test";
import { demux } from "./logs";

const frame = (type: number, text: string) => {
	const body = new TextEncoder().encode(text);
	const out = new Uint8Array(8 + body.length);
	out[0] = type;
	out[7] = body.length & 0xff;
	out[6] = (body.length >> 8) & 0xff;
	out.set(body, 8);
	return out;
};

describe("demux", () => {
	it("strips docker frame headers and keeps raw tty output", () => {
		const a = frame(1, "hello\n");
		const b = frame(2, "err\n");
		const joined = new Uint8Array(a.length + b.length);
		joined.set(a);
		joined.set(b, a.length);
		expect(demux(joined)).toBe("hello\nerr\n");
		expect(demux(new TextEncoder().encode("plain tty line\n"))).toBe("plain tty line\n");
	});
});
