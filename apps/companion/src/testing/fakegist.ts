// A stand-in for api.github.com/gists: in-memory gists, ETag/304 on GET, PATCH merges files (null removes),
// POST creates. Writes need an Authorization header, like GitHub. Used by gistsync.test.ts and, run as a
// script, by the Docker end-to-end test (the companion reaches it through host.docker.internal).
import { createHash, randomBytes } from "crypto";

type Files = Record<string, { content: string }>;

export function startFakeGist(port = 0, hostname = "::") {
	const gists = new Map<string, Files>();
	const etagOf = (files: Files) => `"${createHash("sha256").update(JSON.stringify(files)).digest("hex").slice(0, 32)}"`;
	const host = hostname === "::" || hostname === "0.0.0.0" ? "127.0.0.1" : hostname;
	// raw_url is built from the request's Host header, so a container that reached us can reach it too.
	const view = (id: string, files: Files, via: string) => ({
		id,
		files: Object.fromEntries(
			Object.entries(files).map(([name, f]) => [
				name,
				{
					filename: name,
					content: f.content.length > 1_000_000 ? f.content.slice(0, 1_000_000) : f.content,
					truncated: f.content.length > 1_000_000,
					size: f.content.length,
					raw_url: `http://${via}/raw/${id}/${name}`,
				},
			]),
		),
	});

	const server: ReturnType<typeof Bun.serve> = Bun.serve({
		port,
		hostname,
		async fetch(req) {
			const url = new URL(req.url);
			const via = req.headers.get("host") ?? `${host}:${server.port}`;
			const m = url.pathname.match(/^\/gists\/([0-9a-f]+)$/);
			const raw = url.pathname.match(/^\/raw\/([0-9a-f]+)\/(.+)$/);
			if (raw) {
				const f = gists.get(raw[1])?.[decodeURIComponent(raw[2])];
				return f ? new Response(f.content) : new Response("not found", { status: 404 });
			}
			if (req.method === "POST" && url.pathname === "/gists") {
				if (!req.headers.get("authorization")) return Response.json({ message: "Requires authentication" }, { status: 401 });
				const body = (await req.json()) as { files?: Files };
				const id = randomBytes(16).toString("hex");
				gists.set(id, { ...body.files });
				return Response.json(view(id, gists.get(id)!, via), { status: 201 });
			}
			if (!m) return new Response("not found", { status: 404 });
			const files = gists.get(m[1]);
			if (!files) return Response.json({ message: "Not Found" }, { status: 404 });
			if (req.method === "GET") {
				const etag = etagOf(files);
				if (req.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers: { ETag: etag } });
				return Response.json(view(m[1], files, via), { headers: { ETag: etag } });
			}
			if (req.method === "PATCH") {
				if (!req.headers.get("authorization")) return Response.json({ message: "Requires authentication" }, { status: 401 });
				const body = (await req.json()) as { files?: Record<string, { content: string } | null> };
				for (const [name, f] of Object.entries(body.files ?? {})) {
					if (f === null) delete files[name];
					else files[name] = { content: f.content };
				}
				return Response.json(view(m[1], files, via), { headers: { ETag: etagOf(files) } });
			}
			return new Response("method not allowed", { status: 405 });
		},
	});
	return {
		url: `http://${host}:${server.port}`,
		port: server.port,
		gists,
		stop: () => server.stop(true),
	};
}

if (import.meta.main) {
	// IPv4 only by default: Bun's fetch inside the container picked the IPv6 record of host.docker.internal,
	// which Docker Desktop on Windows did not forward, and reported ECONNREFUSED.
	const port = Number(process.argv[2] ?? 9777);
	const g = startFakeGist(port, process.argv[3] ?? "0.0.0.0");
	console.log(`fake gist API on ${g.url} (containers: http://<ipv4 of host.docker.internal>:${g.port})`);
}
