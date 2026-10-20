// Container log of the game service over the Docker API. Non-TTY containers multiplex stdout/stderr with
// an 8-byte frame header (type, 3 zero bytes, big-endian length); `demux` strips it.
import { gameContainerId, dockerFetch } from "./docker";

export function demux(buf: Uint8Array): string {
	let out = "";
	let i = 0;
	const dec = new TextDecoder();
	while (i + 8 <= buf.length) {
		const type = buf[i];
		if (type > 2 || buf[i + 1] !== 0 || buf[i + 2] !== 0 || buf[i + 3] !== 0) {
			return dec.decode(buf); // TTY container: raw stream
		}
		const len = (buf[i + 4] << 24) | (buf[i + 5] << 16) | (buf[i + 6] << 8) | buf[i + 7];
		out += dec.decode(buf.subarray(i + 8, i + 8 + len));
		i += 8 + len;
	}
	return out;
}

/** Last `tail` lines of the container log. */
export async function tailLog(tail = 300): Promise<string[]> {
	const id = await gameContainerId();
	const res = await dockerFetch(`/containers/${id}/logs?stdout=1&stderr=1&timestamps=1&tail=${Math.min(Math.max(tail, 1), 5000)}`);
	if (!res.ok) throw new Error(`docker logs failed (${res.status})`);
	const text = demux(new Uint8Array(await res.arrayBuffer()));
	return text.split("\n").filter(Boolean);
}

/** Server-sent events: one `data:` line per log line, following the container. */
export async function streamLog(signal: AbortSignal): Promise<ReadableStream<Uint8Array>> {
	const id = await gameContainerId();
	const res = await dockerFetch(`/containers/${id}/logs?stdout=1&stderr=1&timestamps=1&follow=1&tail=100`, { signal });
	if (!res.ok || !res.body) throw new Error(`docker logs failed (${res.status})`);
	const reader = res.body.getReader();
	const enc = new TextEncoder();
	let carry = "";
	return new ReadableStream<Uint8Array>({
		async pull(controller) {
			const { value, done } = await reader.read();
			if (done) {
				controller.close();
				return;
			}
			carry += demux(value);
			const lines = carry.split("\n");
			carry = lines.pop() ?? "";
			for (const l of lines) if (l) controller.enqueue(enc.encode(`data: ${l}\n\n`));
		},
		cancel() {
			reader.cancel().catch(() => {});
		},
	});
}
