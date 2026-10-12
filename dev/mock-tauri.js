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
		ndependants: p.deps.length ? 0 : (p.id.length * 37) % 900,
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
		server: { url: "http://10.10.10.123:9002", name: "PetersWelte", hasToken: true, gist: false, hasGistToken: false },
		mods: inProfile.map((id, i) => ({
			namespace: byId.get(id).ns,
			name: byId.get(id).name,
			version: byId.get(id).ver,
			enabled: i % 9 !== 0,
			source: "thunderstore",
			pinned: i === 7,
		})),
		// Jotunn is resolved as a dependency but not installed: shows the readiness banner and the Play gate.
		installed: Object.fromEntries([BEP, ...inProfile].map((id) => [id, byId.get(id).ver])),
		plan: { resolved, toInstall: [{ id: JOT, to: byId.get(JOT).ver }], toRemove: [], errors: [] },
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
		app: { version: "0.2.0", portable: false, dev: false, dataDir: "C:\\Users\\you\\AppData\\Roaming\\io.github.drloloto.valheim-mod-manager" },
	};
	const settings = { valheimDir: null, steamExe: null, downloadConcurrency: 4, indexTtlMinutes: 30, showNsfw: false, thunderstoreToken: "tss_mock" };

	const mockRelease = (schedule) => ({ id: "r1", createdAt: NOW - 60000, install: 1, remove: 1, configs: 1, problems: [], schedule, lastError: null });
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
		get_package_doc: ({ id, kind }) => {
			const p = byId.get(id);
			if (!p) throw { message: `Package not found: ${id}`, kind: "notFound" };
			if (kind === "changelog")
				return id.endsWith("Pack_Valheim")
					? ""
					: `## ${p.ver}\n\n- Fixed a crash on world load\n- Added config option \`Speed\`\n\n## 0.9.0\n\n- Initial release`;
			return [
				`# ${p.name}`,
				`![Banner](https://picsum.photos/seed/${encodeURIComponent(id)}/640/200)`,
				p.desc,
				"## Features",
				"- Works out of the box\n- Configurable through BepInEx\n- Compatible with **Jötunn**",
				"## Installation",
				"Install through this mod manager or drop the DLL into `BepInEx/plugins`.",
				"| Setting | Default |\n|---|---|\n| Speed | 1.0 |\n| Enabled | true |",
				"See the [wiki](https://thunderstore.io/c/valheim/p/" + p.ns + "/" + p.name + "/wiki/) for details.",
			].join("\n\n");
		},
		get_package_wiki: ({ id }) =>
			id.endsWith("Jotunn") || byId.get(id)?.cats.includes("Modpacks")
				? {
						title: `${id} Wiki`,
						pages: [
							{ id: "417", title: "Summary" },
							{ id: "418", title: "Getting started" },
							{ id: "419", title: "FAQ" },
						],
					}
				: null,
		get_wiki_page: ({ page }) =>
			`## Page ${page}\n\nWiki text with an image:\n\n![](https://picsum.photos/seed/wiki${page}/480/160)\n\n1. Step one\n2. Step two`,
		get_settings: () => settings,
		thunderstore_categories: () => [
			{ name: "Modpacks", slug: "modpacks" },
			{ name: "Gear", slug: "gear" },
			{ name: "Tweaks", slug: "tweaks" },
			{ name: "Server-side", slug: "server-side" },
			{ name: "Client-side", slug: "client-side" },
		],
		modpack_preview: ({ name, description }) => ({
			dependencies: [BEP + "-5.4.2351", JOT + "-" + byId.get(JOT).ver, ...inProfile.slice(0, 6).map((id) => id + "-" + byId.get(id).ver)],
			readme: `# ${name || "Hardcore"}\n\n${description}\n\n## Mods\n\n| Mod | Author | Version |\n| --- | --- | --- |\n${inProfile
				.slice(0, 6)
				.map((id) => `| ${byId.get(id).name} | ${byId.get(id).ns} | ${byId.get(id).ver} |`)
				.join("\n")}\n`,
			configs: 3,
			hasToken: !!settings.thunderstoreToken,
		}),
		publish_modpack: ({ meta }) =>
			new Promise((r) =>
				setTimeout(
					() => r({ fullName: `${meta.team}-${meta.name}-${meta.version}`, url: `https://thunderstore.io/c/valheim/p/${meta.team}/${meta.name}/` }),
					1200,
				),
			),
		list_foreign_profiles: () => [
			{ manager: "r2modman", name: "Friends", path: "C:\\r2modman\\Friends", mods: 42 },
			{ manager: "tmm", name: "Default", path: "C:\\tmm\\Default", mods: 7 },
		],
		import_foreign_profile: () => ({ ...state, imported: { name: "Friends", mods: 42, configs: 12, skipped: [] } }),
		save_settings: ({ settings: s }) => s,
		set_mods: ({ mods }) => ({ ...state, mods }),
		// Linked companion server: the mock server runs one older version and one extra mod.
		set_server_link: ({ link }) => ({
			...state,
			server: link
				? {
						url: link.url,
						name: link.name || "PetersWelte",
						hasToken: !!link.token || state.server?.hasToken,
						gist: !!link.syncCode,
						hasGistToken: !!link.gistToken,
					}
				: null,
		}),
		check_server: () => ({
			reachable: true,
			name: "PetersWelte",
			world: "PetersWelte",
			inSync: false,
			serverMods: inProfile.length + 1,
			serverConfigs: 12,
			hash: "sha256:mock",
			generatedAt: NOW - 3600000,
			features: { publish: true, modManager: true },
			release: null,
			online: 2,
			configsChanged: [],
			gistRelease: null,
			diff: {
				onlyServer: [{ id: slim[50].id, version: slim[50].ver, explicit: true, requiredBy: [] }],
				onlyLocal: [],
				changed: [{ id: inProfile[0], local: byId.get(inProfile[0]).ver, server: "9.9.9" }],
			},
		}),
		adopt_server: ({ intoNew }) => (intoNew ? { ...state, profiles: [...state.profiles, intoNew], active: intoNew } : state),
		check_all_servers: () => [{ profile: "Vanilla+", check: handlers.check_server() }],
		discover_server: ({ url }) => ({
			url: /^https?:/.test(url) ? url.replace(/\/+$/, "") : `http://${url}`,
			name: "PetersWelte",
			world: "PetersWelte",
			mods: 7,
			features: { publish: true, modManager: true },
		}),
		apply_release: ({ when }) =>
			when === "now"
				? {
						applied: true,
						result: { installed: [`${inProfile[0]}@9.9.9`], removed: [slim[50].id], errors: [] },
						configsWritten: ["EpicLoot.cfg"],
						stopped: { ok: true, message: "" },
						started: { ok: true, message: "" },
						restartRequired: false,
						log: [],
					}
				: {
						applied: false,
						summary: mockRelease(when === "none" ? null : { when, at: Date.now() + 3600000, setAt: Date.now() }),
						configsWritten: [],
						stopped: null,
						started: null,
						restartRequired: false,
						log: [],
					},
		discard_release: () => undefined,
		publish_profile: () => ({
			release: {
				id: "r1",
				plan: {
					install: [{ id: inProfile[0], from: byId.get(inProfile[0]).ver, to: "9.9.9" }],
					remove: [slim[50].id],
					configsChanged: ["EpicLoot.cfg"],
					configsNew: [],
				},
				problems: [],
			},
			summary: mockRelease(null),
			online: 2,
			log: ["downloaded …"],
			skippedLocal: [],
		}),
		import_profile_url: () => ({ ...state, imported: { name: "PetersWelte", mods: 7, configs: 3, skipped: [] } }),
		list_config_files: () => ["BepInEx/config/com.example.planteverything.cfg", "BepInEx/config/BepInEx.cfg"],
		get_config_file: ({ file }) => ({
			file,
			settings: [
				{ section: "General", key: "EnableMod", value: "true", description: "Turn the mod on or off.", type: "Boolean", defaultValue: "true" },
				{
					section: "General",
					key: "GrowthSpeed",
					value: "1.5",
					description: "Multiplier for plant growth.",
					type: "Single",
					defaultValue: "1",
					acceptableValues: "From 0.1 to 5",
				},
				{
					section: "General",
					key: "MaxPlants",
					value: "40",
					description: "How many plants a cultivator can place per action.",
					type: "Int32",
					defaultValue: "20",
					acceptableValues: "From 1 to 100",
				},
				{
					section: "Keys",
					key: "Hotkey",
					value: "F7",
					description: "Key that opens the planting menu.",
					type: "KeyCode",
					defaultValue: "F7",
					acceptableValues: "None, F5, F6, F7, F8",
				},
				{ section: "Keys", key: "OldHotkey", value: "F9", description: "" },
			],
		}),
		save_config_file: () => null,
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
