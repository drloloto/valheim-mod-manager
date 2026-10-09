// Browser preview without Tauri: replaces window.__TAURI_INTERNALS__ with a mock serving sample data.
// Active in the dev server only when VITE_MOCK_TAURI=1 is set (see vite.config.ts). Not part of the build.
(() => {
	const AUTHORS = [
		"Azumatt",
		"Therzie",
		"RandyKnapp",
		"Smoothbrain",
		"ValheimModding",
		"OdinPlus",
		"blacks7ar",
		"Marlthon",
		"Digitalroot",
		"KGvalheim",
		"shudnal",
		"coemt",
		"Searica",
		"warpalicious",
		"MSchmoecker",
		"Vapok",
		"JereKuusela",
		"Frogger",
		"Nextek",
		"Advize",
	];
	const CATS = [
		"Mods",
		"Tweaks",
		"Items",
		"Building",
		"Crafting",
		"Client-side",
		"Server-side",
		"Libraries",
		"Utility",
		"Gear",
		"Enemies",
		"Modpacks",
		"Tools",
		"Transportation",
		"World Generation",
		"Audio",
		"Misc",
		"Hildir's Request Update",
		"Ashlands Update",
		"Bog Witch Update",
	];
	const WORDS = [
		"Epic",
		"Better",
		"Simple",
		"More",
		"Fast",
		"Odin",
		"Valheim",
		"Plus",
		"Craft",
		"Build",
		"Seasons",
		"Loot",
		"Boss",
		"Magic",
		"Vikings",
		"Farm",
		"Quick",
		"Auto",
		"Mount",
		"Ward",
	];
	let seed = 42;
	const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
	const pick = (a) => a[Math.floor(rnd() * a.length)];
	const NOW = Date.now();
	const DAY = 86400000;
	const BEP = "denikson-BepInExPack_Valheim";
	const JOT = "ValheimModding-Jotunn";

	const pkgs = [
		{
			id: BEP,
			ns: "denikson",
			name: "BepInExPack_Valheim",
			desc: "BepInEx pack for Valheim",
			cats: ["Libraries", "Tools"],
			dl: 48_000_000,
			rating: 2100,
			deps: [],
			pinned: true,
			upd: NOW - 60 * DAY,
			created: NOW - 1800 * DAY,
		},
		{
			id: JOT,
			ns: "ValheimModding",
			name: "Jotunn",
			desc: "Jötunn, the Valheim Library",
			cats: ["Libraries"],
			dl: 12_000_000,
			rating: 900,
			deps: [BEP],
			pinned: true,
			upd: NOW - 20 * DAY,
			created: NOW - 1500 * DAY,
		},
	];
	for (let i = 0; i < 3000; i++) {
		const ns = pick(AUTHORS);
		const name = `${pick(WORDS)}${pick(WORDS)}${i % 7 ? "" : "Reborn"}${i}`;
		const dl = Math.floor(10 ** (rnd() * 6.5));
		const deps = rnd() < 0.85 ? [BEP] : [];
		if (rnd() < 0.3) deps.push(JOT);
		if (rnd() < 0.1) deps.push(pkgs[Math.floor(rnd() * Math.min(pkgs.length, 50))].id);
		const created = NOW - Math.floor(rnd() * 1600) * DAY;
		pkgs.push({
			id: `${ns}-${name}`,
			ns,
			name,
			desc: `Sample description for ${name}: makes things better, faster and prettier.`,
			cats: [...new Set([pick(CATS), rnd() < 0.5 ? pick(CATS) : null, rnd() < 0.2 ? pick(CATS) : null].filter(Boolean))],
			dl,
			rating: Math.floor(dl / (200 + rnd() * 2000)),
			deps,
			pinned: false,
			upd: created + Math.floor(rnd() * (NOW - created)),
			created,
		});
	}
	const slim = pkgs.map((p) => ({
		...p,
		icon: "",
		ver: `${1 + Math.floor(rnd() * 3)}.${Math.floor(rnd() * 10)}.${Math.floor(rnd() * 20)}`,
		dep: rnd() < 0.06,
		nsfw: rnd() < 0.02,
		ndeps: p.deps.length,
		nver: 1 + Math.floor(rnd() * 25),
		size: Math.floor(10 ** (3 + rnd() * 4.5)),
	}));
	const byId = new Map(slim.map((p) => [p.id, p]));
	const inProfile = slim.slice(2, 40).map((p) => p.id);
	const updates = Object.fromEntries(inProfile.slice(0, 5).map((id) => [id, "9.9.9"]));
	const resolved = Object.fromEntries([BEP, JOT, ...inProfile].map((id) => [id, { version: byId.get(id).ver, requiredBy: [] }]));
	const state = {
		profiles: ["Hardcore", "Vanilla+", "Bauen"],
		active: "Hardcore",
		mods: inProfile.map((id, i) => ({
			namespace: byId.get(id).ns,
			name: byId.get(id).name,
			version: byId.get(id).ver,
			enabled: i % 9 !== 0,
			source: "thunderstore",
		})),
		installed: Object.fromEntries(inProfile.map((id) => [id, byId.get(id).ver])),
		plan: { resolved, toInstall: [], toRemove: [], errors: [] },
		updates,
		indexAge: 240000,
		sync: { running: false, queued: false },
		game: { valheimDir: "C:\\Steam\\steamapps\\common\\Valheim", found: true, lastUpdated: NOW - 30 * DAY, buildId: "25730771" },
		profileMods: { Hardcore: inProfile, "Vanilla+": slim.slice(30, 60).map((p) => p.id), Bauen: slim.slice(100, 110).map((p) => p.id) },
		health: [
			{ kind: "duplicate", ids: [inProfile[0], inProfile[1]], detail: "Shared.dll" },
			{ kind: "stale", ids: [inProfile[2]], detail: String(NOW - 200 * DAY) },
			{ kind: "deprecated", ids: [inProfile[3]], detail: "" },
		],
		app: { version: "0.1.0", portable: false, dataDir: "C:\\Users\\you\\AppData\\Roaming\\io.github.drloloto.valheim-mod-manager" },
	};
	const settings = { valheimDir: null, steamExe: null, downloadConcurrency: 4, indexTtlMinutes: 30, showNsfw: false };

	const handlers = {
		get_state: () => state,
		get_index: () => new TextEncoder().encode(JSON.stringify({ fetchedAt: NOW - 240000, packages: slim })).buffer,
		refresh_index: () => NOW,
		get_package: ({ id }) => {
			const p = byId.get(id);
			if (!p) throw { message: `Package not found: ${id}`, kind: "notFound" };
			return {
				...p,
				url: `https://thunderstore.io/c/valheim/p/${p.ns}/${p.name}/`,
				web: "",
				versions: [
					{ v: p.ver, deps: p.deps.map((d) => `${d}-1.0.0`), size: p.size, date: p.upd },
					{ v: "0.9.0", deps: [], size: p.size - 100, date: p.created },
				],
			};
		},
		get_settings: () => settings,
		list_foreign_profiles: () => [
			{ manager: "r2modman", name: "Friends", path: "C:\\r2modman\\Friends", mods: 42 },
			{ manager: "tmm", name: "Default", path: "C:\\tmm\\Default", mods: 7 },
		],
		import_foreign_profile: () => ({ ...state, imported: { name: "Friends", mods: 42, configs: 12, skipped: [] } }),
		save_settings: ({ settings: s }) => s,
		set_mods: ({ mods }) => ({ ...state, mods }),
		list_config_files: () => [],
		start_log_tail: () => [],
		stop_log_tail: () => undefined,
	};

	window.__TAURI_INTERNALS__ = {
		metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main", windowLabel: "main" } },
		transformCallback: (cb) => {
			const id = Math.floor(Math.random() * 1e9);
			window[`_${id}`] = cb;
			return id;
		},
		unregisterCallback: () => {},
		convertFileSrc: (p) => p,
		invoke: async (cmd, args) => {
			if (cmd === "plugin:updater|check") return null;
			if (cmd.startsWith("plugin:")) return cmd.includes("|listen") ? 1 : cmd.includes("is_") ? false : undefined;
			const h = handlers[cmd];
			if (!h) throw { message: `Mock: unknown command ${cmd}`, kind: "unknown" };
			return h(args ?? {});
		},
	};
	console.info("[mock-tauri] active:", slim.length, "packages");
})();
