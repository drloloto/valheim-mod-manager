// Onboarding logic for install.sh, run inside the companion image so the server needs nothing but Docker.
//   plan:   reads `docker compose config --format json --no-interpolate` on stdin, finds the game service and
//           its /config and env file, refuses setups it cannot handle safely, prints compose.companion.yaml.
//   verify: runs in the started companion and checks that it sees the same server the game runs.
// Output is line based (KEY=value, ERROR:/WARN:/INFO:) so the shell script needs no JSON parser.

export interface ComposeService {
	image?: string;
	build?: unknown;
	env_file?: { path: string; required?: boolean }[] | string[] | string;
	environment?: Record<string, string | null> | string[];
	volumes?: { type?: string; source?: string; target?: string }[];
	network_mode?: string;
}
export interface ComposeConfig {
	name?: string;
	services?: Record<string, ComposeService>;
}

export interface PlanOptions {
	projectDir: string;
	/** companion folder relative to the project dir, e.g. ./companion */
	companionDir: string;
	bind: string;
	port: number;
	dockerSock: string;
	/** force the game service when the compose file has several */
	service?: string;
}

export interface Plan {
	errors: string[];
	warnings: string[];
	info: string[];
	service: string | null;
	/** WORLD_NAME written in the compose file itself (not in the env file); null when not set there */
	composeWorld: string | null;
	yaml: string | null;
}

const GAME_IMAGE = /(^|\/)(community-valheim-tools|lloesche)\/valheim-server(:|@|$)/;
export const COMPANION_SERVICE = "companion";

/** Addresses the companion may listen on: loopback, private LAN ranges, CGNAT/Tailscale. Never a public one. */
export function isPrivateBind(ip: string): boolean {
	const m = ip.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
	if (!m) return false;
	const [a, b] = [Number(m[1]), Number(m[2])];
	return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}

/** A host path as written in the companion file: relative when inside the project dir. */
export function hostPath(abs: string, projectDir: string): string {
	const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "");
	const a = norm(abs);
	const p = norm(projectDir);
	const same = /^[a-z]:\//i.test(p) ? a.toLowerCase().startsWith(p.toLowerCase() + "/") : a.startsWith(p + "/");
	return same ? `./${a.slice(p.length + 1)}` : abs;
}

const envFiles = (s: ComposeService): string[] => {
	const raw = s.env_file;
	if (!raw) return [];
	const list = Array.isArray(raw) ? raw : [raw];
	return list.map((e) => (typeof e === "string" ? e : e.path)).filter(Boolean);
};

const envValue = (s: ComposeService, key: string): string | null => {
	const e = s.environment;
	if (!e) return null;
	if (Array.isArray(e)) {
		const hit = e.find((x) => x.startsWith(`${key}=`));
		return hit ? hit.slice(key.length + 1) : null;
	}
	return e[key] ?? null;
};

const yamlStr = (s: string) => JSON.stringify(s);

export function planCompanion(cfg: ComposeConfig, o: PlanOptions): Plan {
	const plan: Plan = { errors: [], warnings: [], info: [], service: null, composeWorld: null, yaml: null };
	const services = cfg.services ?? {};

	if (services[COMPANION_SERVICE]) {
		plan.errors.push(`a service "${COMPANION_SERVICE}" already exists in this compose project; use "install.sh status" or "install.sh update"`);
		return plan;
	}
	// The old webapp wrote into the same plugins folder; two writers would fight over it.
	for (const [name, s] of Object.entries(services)) {
		const ctx = typeof s.build === "string" ? s.build : ((s.build as { context?: string } | undefined)?.context ?? "");
		if (name === "modmanager" || /[\\/]webapp$/.test(ctx))
			plan.errors.push(`service "${name}" looks like the old mod manager webapp; remove it first (the companion replaces it)`);
	}

	const games = Object.entries(services).filter(([name, s]) => (o.service ? name === o.service : GAME_IMAGE.test(s.image ?? "")));
	if (!games.length) {
		plan.errors.push(o.service ? `service "${o.service}" not found` : "no service runs the valheim-server image (community-valheim-tools or lloesche); pass --service <name>");
		return plan;
	}
	if (games.length > 1) {
		plan.errors.push(`several valheim services (${games.map(([n]) => n).join(", ")}); pass --service <name>`);
		return plan;
	}
	const [name, game] = games[0];
	plan.service = name;
	if (!GAME_IMAGE.test(game.image ?? "")) plan.warnings.push(`"${name}" runs ${game.image ?? "a custom build"}; the companion is made for the valheim-server image's layout`);

	const config = (game.volumes ?? []).find((v) => v.target === "/config");
	if (!config?.source) {
		plan.errors.push(`"${name}" has no volume mounted at /config; the companion works on that folder`);
		return plan;
	}
	const configSource = config.type === "volume" ? config.source : hostPath(config.source, o.projectDir);

	const envs = envFiles(game);
	const envFile = envs.find((p) => /valheim[^/\\]*\.env$/i.test(p)) ?? envs[0] ?? null;
	plan.composeWorld = envValue(game, "WORLD_NAME");
	if (!envFile) {
		plan.warnings.push(`"${name}" has no env_file: editing server settings from the companion is switched off`);
	} else if (envs.length > 1) {
		plan.warnings.push(`"${name}" reads several env files; the companion edits ${envFile}`);
	}
	// The companion reads the world name from the env file; one in the compose file wins in the game. verify
	// compares both after the start and rolls back on a mismatch, so a matching duplicate is fine.
	if (plan.composeWorld !== null)
		plan.warnings.push(
			`WORLD_NAME is set in the compose file ("${plan.composeWorld}"); the companion reads ${envFile ?? "the env file"}, keep both the same`,
		);

	if (!isPrivateBind(o.bind)) plan.errors.push(`${o.bind} is not a loopback or private LAN address; the companion must never be reachable from the internet`);
	if (!Number.isInteger(o.port) || o.port < 1 || o.port > 65535) plan.errors.push(`invalid port ${o.port}`);
	if (game.network_mode === "host") plan.warnings.push(`"${name}" uses network_mode: host; that does not affect the companion`);

	if (plan.errors.length) return plan;

	const url = `http://${o.bind}:${o.port}`;
	const lines = [
		"# Valheim companion, added by companion/install.sh. Your own compose file is unchanged; .env loads this",
		"# file through COMPOSE_FILE. Remove both with: bash companion/install.sh uninstall",
		"services:",
		`  ${COMPANION_SERVICE}:`,
		`    build: ${yamlStr(o.companionDir)}`,
		"    image: valheim-companion:local",
		"    volumes:",
		`      - ${yamlStr(`${configSource}:/config`)}`,
		`      - ${yamlStr("./backups:/backups")}`,
		...(envFile ? [`      - ${yamlStr(`${hostPath(envFile, o.projectDir)}:/env/valheim.env`)}`] : []),
		`      - ${yamlStr(`${o.dockerSock}:/var/run/docker.sock`)}`,
		"    environment:",
		`      - ${yamlStr(`VALHEIM_SERVICE=${name}`)}`,
		`      - ${yamlStr(`PUBLIC_URL=${url}`)}`,
		...(envFile ? [] : [`      - ${yamlStr("COMPANION_ALLOW_ENV=false")}`]),
		"    ports:",
		`      - ${yamlStr(`${o.bind}:${o.port}:9002`)}`,
		"    restart: unless-stopped",
		"",
	];
	plan.yaml = lines.join("\n");
	plan.info.push(`game service: ${name}`, `config folder: ${configSource}`, `env file: ${envFile ? hostPath(envFile, o.projectDir) : "none"}`, `companion URL: ${url}`);
	return plan;
}

// ---- verify: inside the running companion ----

export interface VerifyInput {
	status: {
		server: { world: string };
		container: { state: string; id: string } | null;
		world: { name: string; size: number; lastSave: number | null } | null;
		manifest: { mods: number } | null;
	};
	worlds: { name: string }[];
	configs: string[];
	/** what the game container really runs with */
	gameWorld: string;
	gameRunning: boolean;
	gameId: string;
}

export function verifyCompanion(v: VerifyInput): { errors: string[]; warnings: string[]; info: string[] } {
	const errors: string[] = [];
	const warnings: string[] = [];
	const info: string[] = [];
	const s = v.status;
	// gameWorld is empty when the game container does not exist yet: nothing to compare against.
	if (v.gameWorld && s.server.world !== v.gameWorld)
		errors.push(`the companion reads world "${s.server.world}" but the game runs "${v.gameWorld}"; backups would miss the real world`);
	if (v.gameRunning) {
		if (!s.container) errors.push("the companion cannot see the game container through the Docker socket");
		else if (!v.gameId.startsWith(s.container.id)) errors.push(`the companion found container ${s.container.id}, the game runs in ${v.gameId.slice(0, 12)}`);
		else if (s.container.state !== "running") errors.push(`the companion sees the game as "${s.container.state}"`);
	}
	if (!s.world) {
		if (v.worlds.length) errors.push(`world "${s.server.world}" is not in worlds_local, but ${v.worlds.map((w) => w.name).join(", ")} is; check WORLD_NAME`);
		else warnings.push("no world on disk yet (fresh server): the first backup happens once the game has saved");
	} else {
		info.push(`world: ${s.world.name}, ${(s.world.size / 1e6).toFixed(1)} MB, last saved ${s.world.lastSave ? new Date(s.world.lastSave).toISOString() : "unknown"}`);
	}
	const mods = s.manifest?.mods ?? 0;
	info.push(`configs: ${v.configs.length} .cfg files`, mods ? `mods in the lock: ${mods}` : "no mods in the lock yet: the first publish from the Mod Manager takes over hand-installed mods");
	if (!v.configs.length && s.world) warnings.push("no .cfg files found in config/bepinex; is BEPINEX=true?");
	return { errors, warnings, info };
}

// ---- CLI ----

function arg(name: string, fallback = ""): string {
	const i = process.argv.indexOf(`--${name}`);
	return i >= 0 ? (process.argv[i + 1] ?? "") : fallback;
}

function print(r: { errors: string[]; warnings: string[]; info: string[] }) {
	for (const l of r.info) console.log(`INFO: ${l}`);
	for (const l of r.warnings) console.log(`WARN: ${l}`);
	for (const l of r.errors) console.log(`ERROR: ${l}`);
}

async function cliPlan() {
	const cfg = JSON.parse(await Bun.stdin.text()) as ComposeConfig;
	const plan = planCompanion(cfg, {
		projectDir: arg("project-dir"),
		companionDir: arg("companion-dir", "./companion"),
		bind: arg("bind", "127.0.0.1"),
		port: Number(arg("port", "9002")),
		dockerSock: arg("docker-sock", "/var/run/docker.sock"),
		service: arg("service") || undefined,
	});
	print(plan);
	if (plan.service) console.log(`SERVICE=${plan.service}`);
	if (plan.yaml) console.log(`---YAML---\n${plan.yaml}`);
	process.exit(plan.errors.length ? 1 : 0);
}

async function cliVerify() {
	const base = "http://127.0.0.1:9002/api";
	const tokenFile = Bun.file(`${process.env.CONFIG_DIR || "/config"}/modmanager/companion-token`);
	const token = process.env.COMPANION_TOKEN?.trim() || ((await tokenFile.exists()) ? (await tokenFile.text()).trim() : "");
	const headers = token && token !== "none" ? { authorization: `Bearer ${token}` } : undefined;
	const get = async <T>(p: string): Promise<T> => {
		const r = await fetch(`${base}${p}`, { headers });
		if (!r.ok) throw new Error(`${p}: HTTP ${r.status}`);
		return (await r.json()) as T;
	};
	const [status, worlds, configs] = await Promise.all([
		get<VerifyInput["status"]>("/status"),
		get<{ worlds: { name: string }[] }>("/worlds"),
		get<{ files: string[] }>("/configs"),
	]);
	const r = verifyCompanion({
		status,
		worlds: worlds.worlds,
		configs: configs.files,
		gameWorld: arg("world"),
		gameRunning: arg("running") === "1",
		gameId: arg("game-id"),
	});
	print(r);
	if (!r.errors.length && token && token !== "none") console.log(`TOKEN=${token}`);
	process.exit(r.errors.length ? 1 : 0);
}

if (import.meta.main) {
	const cmd = process.argv[2];
	if (cmd === "plan") await cliPlan();
	else if (cmd === "verify") await cliVerify();
	else {
		console.error("usage: bun run src/onboard.ts plan|verify [options]");
		process.exit(2);
	}
}
