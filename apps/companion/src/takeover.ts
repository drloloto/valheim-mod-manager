// A server whose mods were copied into plugins/ by hand has no lock. This seeds one from what lies there:
// a folder named `Namespace-Name` is a Thunderstore package (r2modman and the Mod Manager lay mods out that
// way), its version is the newest release that existed when the files were copied (the latest release when
// it predates the copy, else the version the DLL itself carries when Thunderstore knows it), and its
// dependencies come from Thunderstore like the Mod Manager's own manifests. Loose DLLs and other folders
// cannot be mapped to a package without an index and are reported as unidentified; the admin's first publish
// covers those. The files stay where they are: the first applied release moves them aside and installs the
// packages cleanly (install.ts, firstTakeover).
import { readdir, readFile, stat } from "fs/promises";
import { join } from "path";
import { VERSION } from "./config";
import { configHashes, normalizeManifest, type Manifest, type ManifestMod, type ServerInfo } from "./manifest";
import { BEPINEX_DIR } from "./paths";

const PACKAGE_DIR = /^([A-Za-z0-9_]+)-([A-Za-z0-9_]+)$/;
const DEP = /^([A-Za-z0-9_]+-[A-Za-z0-9_]+)-(\d+\.\d+\.\d+)$/;
/** a release published up to this long after the copy still counts as "existed when copied" (clock skew, uploads) */
const SLACK_MS = 86_400_000;

export interface Candidate {
	id: string;
	/** relative to the BepInEx folder */
	dir: string;
	/** versions the DLLs in the folder carry (VERSIONINFO), normalised to x.y.z, newest DLL first */
	dllVersions: string[];
	/** newest DLL mtime: when the files were copied */
	copiedAt: number;
}

export interface Scan {
	candidates: Candidate[];
	/** entries of plugins/ that are not a `Namespace-Name` folder */
	unidentified: string[];
}

export interface PackageVersion {
	version: string;
	createdAt: number;
	dependencies: string[];
	/** set when only Hexium answered for the package */
	source?: "hexium";
}

export interface PackageApi {
	/** the latest release, null when the package does not exist */
	latest(ns: string, name: string): Promise<PackageVersion | null>;
	/** one release, null when it does not exist */
	version(ns: string, name: string, version: string): Promise<PackageVersion | null>;
}

export interface Resolved {
	id: string;
	version: string;
	/** latest: the latest release predates the copy; dll: the DLL's own version exists; guess: latest, released after the copy */
	from: "latest" | "dll" | "guess";
	dependencies: string[];
	/** the lock downloads from Hexium when only Hexium has the package */
	source?: "hexium";
}

export interface Takeover {
	resolved: Resolved[];
	/** `id: reason` for candidates Thunderstore does not know or did not answer for */
	unresolved: string[];
	unidentified: string[];
	/** the lock, null when nothing could be resolved */
	manifest: Manifest | null;
	at: number;
}

const headers = { Accept: "application/json", "User-Agent": `valheim-companion/${VERSION}` };
const toVersion = (body: { version_number?: string; date_created?: string; dependencies?: unknown }): PackageVersion => ({
	version: body.version_number ?? "",
	createdAt: Date.parse(body.date_created ?? "") || 0,
	dependencies: Array.isArray(body.dependencies) ? body.dependencies.filter((d): d is string => typeof d === "string") : [],
});

/** The experimental package API (Thunderstore's, which Hexium serves too): one request per package, one more per DLL version to check. */
const experimentalApi = (base: string, label: string, source?: "hexium"): PackageApi => {
	const mark = (v: PackageVersion): PackageVersion => (source ? { ...v, source } : v);
	return {
		async latest(ns, name) {
			const res = await fetch(`${base}/package/${ns}/${name}/`, { headers });
			if (res.status === 404) return null;
			if (!res.ok) throw new Error(`${label} ${ns}-${name}: HTTP ${res.status}`);
			const body = (await res.json()) as { latest?: Parameters<typeof toVersion>[0] };
			return body.latest ? mark(toVersion(body.latest)) : null;
		},
		async version(ns, name, version) {
			const res = await fetch(`${base}/package/${ns}/${name}/${version}/`, { headers });
			if (res.status === 404) return null;
			if (!res.ok) throw new Error(`${label} ${ns}-${name}-${version}: HTTP ${res.status}`);
			return mark(toVersion((await res.json()) as Parameters<typeof toVersion>[0]));
		},
	};
};

export const thunderstoreApi = experimentalApi("https://thunderstore.io/api/experimental", "thunderstore");
export const hexiumApi = experimentalApi("https://valheim.hexium.gg/api/experimental", "hexium", "hexium");

/** Thunderstore first, Hexium for what Thunderstore does not have (its answers mark the release for the lock). */
export const storeApi: PackageApi = {
	latest: async (ns, name) => (await thunderstoreApi.latest(ns, name)) ?? hexiumApi.latest(ns, name),
	version: async (ns, name, v) => (await thunderstoreApi.version(ns, name, v)) ?? hexiumApi.version(ns, name, v),
};

/** The x.y.z versions a .NET assembly's VERSIONINFO carries (ProductVersion, FileVersion), without build tags. */
export function dllVersions(bytes: Uint8Array): string[] {
	const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const out: string[] = [];
	for (const key of ["ProductVersion", "FileVersion"]) {
		const needle = Buffer.from(`${key}\0`, "utf16le");
		let idx = buf.indexOf(needle);
		while (idx >= 0) {
			let p = idx + needle.length;
			while (p + 1 < buf.length && buf[p] === 0 && buf[p + 1] === 0) p += 2;
			let text = "";
			while (p + 1 < buf.length) {
				const c = buf[p] | (buf[p + 1] << 8);
				if (c === 0) break;
				text += String.fromCharCode(c);
				p += 2;
			}
			const m = /^(\d+)\.(\d+)(?:\.(\d+))?/.exec(text);
			if (m) {
				const v = `${Number(m[1])}.${Number(m[2])}.${Number(m[3] ?? 0)}`;
				if (!out.includes(v)) out.push(v);
				break;
			}
			idx = buf.indexOf(needle, idx + 2);
		}
	}
	return out;
}

async function dllsIn(dir: string): Promise<string[]> {
	const out: string[] = [];
	for (const it of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
		const p = join(dir, it.name);
		if (it.isDirectory()) out.push(...(await dllsIn(p)));
		else if (it.isFile() && it.name.toLowerCase().endsWith(".dll")) out.push(p);
	}
	return out;
}

/** What lies in plugins/: package folders with their DLL versions and copy time, and everything else. */
export async function scanPlugins(bepinexDir = BEPINEX_DIR): Promise<Scan> {
	const pluginsDir = join(bepinexDir, "plugins");
	const candidates: Candidate[] = [];
	const unidentified: string[] = [];
	for (const it of (await readdir(pluginsDir, { withFileTypes: true }).catch(() => [])).sort((a, b) => a.name.localeCompare(b.name))) {
		if (!it.isDirectory() || !PACKAGE_DIR.test(it.name)) {
			unidentified.push(`plugins/${it.name}`);
			continue;
		}
		const dlls: { path: string; mtime: number }[] = [];
		for (const path of await dllsIn(join(pluginsDir, it.name))) {
			const st = await stat(path).catch(() => null);
			if (st) dlls.push({ path, mtime: st.mtimeMs });
		}
		dlls.sort((a, b) => b.mtime - a.mtime);
		const versions: string[] = [];
		for (const d of dlls) for (const v of dllVersions(new Uint8Array(await readFile(d.path)))) if (!versions.includes(v)) versions.push(v);
		candidates.push({ id: it.name, dir: `plugins/${it.name}`, dllVersions: versions, copiedAt: dlls[0]?.mtime ?? 0 });
	}
	return { candidates, unidentified };
}

export async function resolveCandidate(c: Candidate, api: PackageApi): Promise<Resolved | null> {
	const [ns, name] = c.id.split("-", 2);
	const latest = await api.latest(ns, name);
	if (!latest) return null;
	const src = latest.source ? { source: latest.source } : {};
	if (latest.createdAt <= c.copiedAt + SLACK_MS) return { id: c.id, version: latest.version, from: "latest", dependencies: latest.dependencies, ...src };
	for (const v of c.dllVersions) {
		if (v === latest.version) return { id: c.id, version: v, from: "dll", dependencies: latest.dependencies, ...src };
		const hit = await api.version(ns, name, v);
		if (hit) return { id: c.id, version: v, from: "dll", dependencies: hit.dependencies, ...(hit.source ? { source: hit.source } : {}) };
	}
	return { id: c.id, version: latest.version, from: "guess", dependencies: latest.dependencies, ...src };
}

const newer = (a: string, b: string) => {
	const pa = a.split(".").map(Number);
	const pb = b.split(".").map(Number);
	for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0);
	return false;
};

/** The lock entries: every resolved package explicit, its dependencies pinned as Thunderstore lists them. */
export function lockFrom(resolved: Resolved[]): ManifestMod[] {
	const mods = new Map<string, ManifestMod>();
	for (const r of resolved) mods.set(r.id, { id: r.id, version: r.version, explicit: true, requiredBy: [], ...(r.source ? { source: r.source } : {}) });
	for (const r of resolved) {
		for (const dep of r.dependencies) {
			const m = DEP.exec(dep);
			if (!m) continue;
			const [, id, version] = m;
			const have = mods.get(id);
			if (!have) mods.set(id, { id, version, explicit: false, requiredBy: [r.id] });
			else {
				if (!have.requiredBy.includes(r.id)) have.requiredBy.push(r.id);
				if (!have.explicit && newer(version, have.version)) have.version = version;
			}
		}
	}
	return [...mods.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export async function takeover(server: ServerInfo, opts: { bepinexDir?: string; api?: PackageApi; configs?: Record<string, string> } = {}): Promise<Takeover> {
	const api = opts.api ?? storeApi;
	const scan = await scanPlugins(opts.bepinexDir);
	const resolved: Resolved[] = [];
	const unresolved: string[] = [];
	for (const c of scan.candidates) {
		try {
			const r = await resolveCandidate(c, api);
			if (r) resolved.push(r);
			else unresolved.push(`${c.id}: not on Thunderstore`);
		} catch (e) {
			unresolved.push(`${c.id}: ${(e as Error).message}`);
		}
	}
	const manifest = resolved.length ? normalizeManifest({ mods: lockFrom(resolved) }, server, opts.configs ?? (await configHashes())) : null;
	return { resolved, unresolved, unidentified: scan.unidentified, manifest, at: Date.now() };
}

export const describe = (t: Takeover): string =>
	[
		`${t.resolved.length} packages: ${t.resolved.map((r) => `${r.id} ${r.version}${r.from === "latest" ? "" : ` (${r.from})`}`).join(", ") || "none"}`,
		t.unresolved.length ? `unresolved: ${t.unresolved.join("; ")}` : "",
		t.unidentified.length ? `unidentified: ${t.unidentified.join(", ")}` : "",
	]
		.filter(Boolean)
		.join(" | ");
