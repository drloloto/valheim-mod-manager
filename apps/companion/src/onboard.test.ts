import { describe, expect, it } from "bun:test";
import { hostPath, isPrivateBind, planCompanion, verifyCompanion, type ComposeConfig, type VerifyInput } from "./onboard";

// `docker compose config --format json --no-interpolate` of the prod compose (valheim + playit).
const prod: ComposeConfig = {
	name: "valheim-server",
	services: {
		valheim: {
			image: "ghcr.io/community-valheim-tools/valheim-server",
			env_file: [{ path: "/home/u/docker/valheim-server/valheim.env", required: true }],
			volumes: [
				{ type: "bind", source: "/home/u/docker/valheim-server/config", target: "/config" },
				{ type: "bind", source: "/home/u/docker/valheim-server/data", target: "/opt/valheim" },
			],
		},
		playit: { image: "ghcr.io/playit-cloud/playit-agent:1.0", network_mode: "host", environment: { SECRET_KEY: "${PLAYIT_SECRET_KEY}" } },
	},
};
const opts = { projectDir: "/home/u/docker/valheim-server", companionDir: "./companion", bind: "10.10.10.123", port: 9002, dockerSock: "/var/run/docker.sock" };

describe("planCompanion", () => {
	it("writes a companion service that mounts what the game mounts", () => {
		const p = planCompanion(prod, opts);
		expect(p.errors).toEqual([]);
		expect(p.service).toBe("valheim");
		expect(p.yaml).toContain('- "./config:/config"');
		expect(p.yaml).toContain('- "./valheim.env:/env/valheim.env"');
		expect(p.yaml).toContain('- "VALHEIM_SERVICE=valheim"');
		expect(p.yaml).toContain('- "10.10.10.123:9002:9002"');
		expect(p.yaml).toContain('- "PUBLIC_URL=http://10.10.10.123:9002"');
		expect(p.yaml).not.toContain("SECRET_KEY");
	});
	it("refuses a public bind address", () => {
		expect(planCompanion(prod, { ...opts, bind: "0.0.0.0" }).errors[0]).toContain("internet");
		expect(planCompanion(prod, { ...opts, bind: "85.10.1.2" }).yaml).toBeNull();
	});
	it("refuses a second companion and the old webapp", () => {
		expect(planCompanion({ services: { ...prod.services, companion: { image: "x" } } }, opts).errors[0]).toContain("already exists");
		const old = planCompanion({ services: { ...prod.services, modmanager: { build: "./webapp" } } }, opts);
		expect(old.errors.join()).toContain("old mod manager webapp");
	});
	it("finds the game by image, or by --service", () => {
		const renamed = { services: { game: { ...prod.services!.valheim } } };
		expect(planCompanion(renamed, opts).service).toBe("game");
		expect(planCompanion({ services: { a: { image: "nginx" } } }, opts).errors[0]).toContain("no service runs the valheim-server image");
		const custom = { services: { srv: { build: ".", volumes: [{ type: "bind", source: "/x/config", target: "/config" }] } } };
		expect(planCompanion(custom, { ...opts, service: "srv" }).errors).toEqual([]);
	});
	it("needs /config, switches env editing off without an env file", () => {
		const noConfig = { services: { valheim: { ...prod.services!.valheim, volumes: [] } } };
		expect(planCompanion(noConfig, opts).errors[0]).toContain("/config");
		const noEnv = planCompanion({ services: { valheim: { ...prod.services!.valheim, env_file: undefined } } }, opts);
		expect(noEnv.yaml).toContain("COMPANION_ALLOW_ENV=false");
		expect(noEnv.yaml).not.toContain("/env/valheim.env");
	});
	it("keeps named volumes and paths outside the project as they are", () => {
		const named = { services: { valheim: { ...prod.services!.valheim, volumes: [{ type: "volume", source: "valheim-config", target: "/config" }] } } };
		expect(planCompanion(named, opts).yaml).toContain('- "valheim-config:/config"');
		expect(hostPath("/srv/valheim/config", "/home/u/x")).toBe("/srv/valheim/config");
		expect(hostPath("C:\\Users\\a\\test\\config", "C:\\Users\\a\\test")).toBe("./config");
	});
	it("only accepts loopback and private ranges", () => {
		for (const ip of ["127.0.0.1", "10.10.10.123", "192.168.1.5", "172.20.0.1", "100.100.1.1"]) expect(isPrivateBind(ip)).toBe(true);
		for (const ip of ["0.0.0.0", "8.8.8.8", "172.32.0.1", "::", "localhost"]) expect(isPrivateBind(ip)).toBe(false);
	});
});

describe("verifyCompanion", () => {
	const ok: VerifyInput = {
		status: {
			server: { world: "PetersWelte" },
			container: { state: "running", id: "05cc1274d752" },
			world: { name: "PetersWelte", size: 18e6, lastSave: 1 },
			manifest: { mods: 0 },
		},
		worlds: [{ name: "PetersWelte" }],
		configs: ["BepInEx.cfg"],
		gameWorld: "PetersWelte",
		gameRunning: true,
		gameId: "05cc1274d752bbb24d9b",
	};
	it("passes when the companion sees what the game runs", () => {
		expect(verifyCompanion(ok).errors).toEqual([]);
	});
	it("fails when the world differs from the game's (backups would miss it)", () => {
		const r = verifyCompanion({ ...ok, status: { ...ok.status, server: { world: "Dedicated" }, world: null } });
		expect(r.errors.join()).toContain('game runs "PetersWelte"');
		expect(r.errors.join()).toContain("not in worlds_local");
	});
	it("fails without Docker access while the game runs", () => {
		expect(verifyCompanion({ ...ok, status: { ...ok.status, container: null } }).errors[0]).toContain("Docker socket");
	});
	it("accepts a fresh server without a world", () => {
		const r = verifyCompanion({ ...ok, worlds: [], status: { ...ok.status, world: null } });
		expect(r.errors).toEqual([]);
		expect(r.warnings[0]).toContain("fresh server");
	});
});
