const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const fmtBytes = (n) => (n > 1e9 ? `${(n / 1e9).toFixed(2)} GB` : n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.round(n / 1e3)} kB`);
const fmtDate = (ms) => (ms ? new Date(ms).toLocaleString() : "–");
const origin = location.origin;
let features = {};

function toast(msg, kind = "") {
	const el = document.createElement("div");
	el.className = `toast ${kind}`;
	el.textContent = msg;
	$("#toasts").appendChild(el);
	setTimeout(() => el.remove(), 6000);
}

let token = localStorage.getItem("companion.token") || "";
async function api(path, opts = {}) {
	const headers = { ...(opts.headers || {}) };
	if (opts.body && !(opts.body instanceof Blob) && typeof opts.body !== "string") {
		opts.body = JSON.stringify(opts.body);
		headers["Content-Type"] = "application/json";
	}
	if (token) headers.Authorization = `Bearer ${token}`;
	const res = await fetch(`/api${path}`, { ...opts, headers });
	const data = await res.json().catch(() => ({}));
	if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
	return data;
}

// A release the Mod Manager staged: pulled and checked, waiting for the admin to pick the moment.
let pendingRelease = null;
function renderRelease(r, online) {
	pendingRelease = r;
	$("#release-card").classList.toggle("hidden", !r);
	if (!r) return;
	const sched = r.schedule ? (r.schedule.when === "idle" ? " · scheduled: when nobody is online" : ` · scheduled: ${fmtDate(r.schedule.at)}`) : "";
	$("#release-summary").textContent =
		`${r.install} to install/update, ${r.remove} to remove, ${r.configs} config files · staged ${fmtDate(r.createdAt)}${sched} · ${online == null ? "player count unknown" : `${online} online`}`;
	$("#release-problems").textContent = [...r.problems, ...(r.lastError ? [`last error: ${r.lastError}`] : [])].join(" · ");
	$("[data-release=idle]").disabled = online == null;
}

document.addEventListener("click", async (e) => {
	const b = e.target.closest("[data-release]");
	if (!b || !pendingRelease) return;
	const when = b.dataset.release;
	if (when === "now" && !confirm("Apply now? The server stops, a backup is taken, the release is installed, the server starts again.")) return;
	try {
		if (when === "discard") {
			await api(`/releases/${encodeURIComponent(pendingRelease.id)}`, { method: "DELETE" });
			toast("Release discarded.", "ok");
		} else {
			const at = when === "at" ? new Date($("#release-at").value).getTime() : undefined;
			if (when === "at" && !at) return toast("Pick a time first.", "err");
			const r = await api(`/releases/${encodeURIComponent(pendingRelease.id)}/apply`, { method: "POST", body: { when, at } });
			toast(
				r.applied
					? `Applied: ${r.result.installed.length} installed, ${r.result.removed.length} removed${r.restartRequired ? " — restart the server" : ""}`
					: when === "none"
						? "Schedule cleared."
						: "Scheduled.",
				"ok",
			);
		}
		loadPublic();
	} catch (err) {
		toast(err.message, "err");
	}
});

function applyFeatures() {
	for (const el of $$("[data-feature]")) el.classList.toggle("hidden", features[el.dataset.feature] === false);
}

async function loadPublic() {
	const status = await api("/status");
	features = status.companion.features || {};
	applyFeatures();
	const name = status.server.name || "Valheim Server";
	document.title = name;
	$("#server-name").textContent = name;
	const c = status.container;
	const base = status.companion.publicUrl || origin;
	$("#link-url").textContent = base;
	$("#open-mm").href =
		`valheim-mod-manager://import?url=${encodeURIComponent(`${base}/api/profile.r2z`)}&name=${encodeURIComponent(name)}&link=${encodeURIComponent(base)}`;
	$("#token-hint").classList.toggle("hidden", !(status.companion.tokenSource === "generated" || status.companion.tokenSource === "file") || !!token);
	$("#admin-state").textContent = status.companion.tokenConfigured ? "" : "No admin token on this companion (COMPANION_TOKEN=none): read-only.";
	const parts = [
		status.server.world ? `World ${status.server.world}` : null,
		c ? `container ${c.state}${c.status ? ` (${c.status})` : ""}` : status.manifest ? "container state unknown" : null,
		status.world?.lastSave ? `last save ${fmtDate(status.world.lastSave)}` : null,
	];
	if (!status.manifest) {
		$("#status").textContent = "Reads need the admin token on this companion.";
		$("#mods-card").classList.add("hidden");
		return;
	}
	renderRelease(status.release, status.online);
	const manifest = await api("/manifest");
	parts.push(`${manifest.mods.length} mods`);
	if (status.online !== null && status.online !== undefined) parts.push(`${status.online} online`);
	$("#status").textContent = parts.filter(Boolean).join(" · ");
	$("#mod-count").textContent = manifest.mods.length;
	$("#mods-card").classList.remove("hidden");
	$("#mods tbody").innerHTML =
		manifest.mods
			.map((m) => {
				const [ns, ...rest] = m.id.split("-");
				const url = `https://thunderstore.io/c/valheim/p/${esc(ns)}/${esc(rest.join("-"))}/`;
				const why = m.explicit ? "" : m.requiredBy.length ? `dependency of ${esc(m.requiredBy.join(", "))}` : "dependency";
				return `<tr><td><a href="${url}" target="_blank" rel="noopener">${esc(m.id)}</a></td><td class="mono">${esc(m.version)}</td><td class="dim">${why}</td></tr>`;
			})
			.join("") || `<tr><td colspan="3" class="dim">Nothing published yet. Link this server in the Mod Manager and use “Publish to server…”.</td></tr>`;
}

async function loadAdmin() {
	const jobs = [];
	if (features.backups !== false) jobs.push(api("/backups").then(renderBackups));
	if (features.env !== false) jobs.push(api("/env").then(renderEnv));
	if (features.players !== false) jobs.push(api("/players").then(renderPlayers));
	if (features.logs !== false) jobs.push(loadLog());
	await Promise.all(jobs.map((j) => j.catch((e) => toast(e.message, "err"))));
}

function renderBackups(b) {
	$("#backups tbody").innerHTML =
		b.backups
			.map(
				(x) =>
					`<tr><td class="mono">${esc(x.id)}</td><td>${esc(x.world ?? "import")}</td><td>${fmtBytes(x.size)}</td><td>${fmtDate(x.createdAt)}</td>
				<td><button data-restore="${esc(x.id)}">Restore…</button> <button data-delete="${esc(x.id)}" class="danger">Delete</button></td></tr>`,
			)
			.join("") || `<tr><td colspan="5" class="dim">No backups yet.</td></tr>`;
}

function renderEnv(env) {
	$("#env").innerHTML = env.entries
		.map(
			(e) =>
				`<label class="row"><span class="mono key">${esc(e.key)}</span><input data-env="${esc(e.key)}" type="${/PASS/i.test(e.key) ? "password" : "text"}" value="${esc(e.value)}" /></label>`,
		)
		.join("");
}

const listText = (entries) => entries.map((e) => (e.note ? `${e.id} # ${e.note}` : e.id)).join("\n");
const parseListText = (text) =>
	text
		.split("\n")
		.map((l) => l.trim())
		.filter((l) => l && !l.startsWith("//") && !l.startsWith("#"))
		.map((l) => {
			const [id, ...rest] = l.split(/\s+/);
			return { id, note: rest.join(" ").replace(/^[#/]+\s*/, "") };
		});

function renderPlayers(p) {
	for (const k of ["admin", "permitted", "banned"]) $(`#list-${k}`).value = listText(p.lists[k]);
	$("#online").textContent = p.logError
		? `Online players unknown (${p.logError})`
		: p.online.length
			? `Online now: ${p.online.map((s) => `${s.name ?? "?"} (${s.id})`).join(", ")}`
			: "Nobody online (from the server log).";
	$("#sessions tbody").innerHTML =
		p.recent
			.map(
				(s) =>
					`<tr><td>${esc(s.name ?? "?")}</td><td class="mono">${esc(s.id)}</td><td class="dim">${esc(s.joinedAt ?? "")}</td><td class="dim">${s.leftAt ? esc(s.leftAt) : "online"}</td></tr>`,
			)
			.join("") || `<tr><td class="dim">No sessions in the log tail.</td></tr>`;
}

let logLines = [];
let logSource = null;
function renderLog() {
	const q = $("#log-filter").value.toLowerCase();
	const el = $("#log");
	const lines = q ? logLines.filter((l) => l.toLowerCase().includes(q)) : logLines;
	el.textContent = lines.slice(-800).join("\n");
	el.scrollTop = el.scrollHeight;
}
async function loadLog() {
	const r = await api("/logs?tail=400");
	logLines = r.lines;
	renderLog();
}
function followLog(on) {
	if (logSource) {
		logSource.close();
		logSource = null;
	}
	$("#log-follow").textContent = on ? "Stop" : "Follow";
	if (!on) return;
	// EventSource cannot send headers; the token travels as a query parameter for this one stream.
	logSource = new EventSource(`/api/logs/stream?token=${encodeURIComponent(token)}`);
	logSource.onmessage = (e) => {
		logLines.push(e.data);
		if (logLines.length > 3000) logLines.splice(0, logLines.length - 3000);
		renderLog();
	};
	logSource.onerror = () => followLog(false);
}

function showAdmin(on) {
	$("#admin-body").classList.toggle("hidden", !on);
	if (on) loadAdmin();
	else followLog(false);
}

$("#token").value = token;
$("#token-save").onclick = async () => {
	token = $("#token").value.trim();
	localStorage.setItem("companion.token", token);
	if (!token) return showAdmin(false);
	try {
		const r = await api("/auth/check", { method: "POST" });
		if (!r.ok) throw new Error(r.tokenConfigured ? "Token rejected." : "This companion has no admin token.");
		toast("Token accepted.", "ok");
		$("#token-hint").classList.add("hidden");
		showAdmin(true);
	} catch (e) {
		toast(e.message, "err");
		showAdmin(false);
	}
};

$$("[data-action]").forEach((b) => {
	b.onclick = async () => {
		try {
			const r = await api(`/server/${b.dataset.action}`, { method: "POST" });
			toast(r.message, r.ok ? "ok" : "err");
			setTimeout(loadPublic, 1500);
		} catch (e) {
			toast(e.message, "err");
		}
	};
});

$("#backup-create").onclick = async () => {
	try {
		const r = await api("/backups", { method: "POST", body: {} });
		toast(`Backup ${r.id} (${fmtBytes(r.size)})`, "ok");
		api("/backups").then(renderBackups);
	} catch (e) {
		toast(e.message, "err");
	}
};

$("#backup-import").onclick = async () => {
	const f = $("#backup-file").files[0];
	if (!f) return toast("Choose a .tar.gz file first.", "err");
	try {
		const r = await api("/backups/import", { method: "POST", body: f, headers: { "Content-Type": "application/octet-stream" } });
		renderImport(r);
		api("/backups").then(renderBackups);
	} catch (e) {
		toast(e.message, "err");
	}
};

function renderImport(r) {
	const d = r.diff;
	const diffHtml = d
		? `<h4>Mod versions in this backup vs. the server now</h4>
		<ul>${[...d.added.map((m) => `<li>+ ${esc(m.id)} ${esc(m.version)} (missing on the server)</li>`), ...d.removed.map((m) => `<li>− ${esc(m.id)} (server has it, backup did not)</li>`), ...d.changed.map((m) => `<li>${esc(m.id)}: ${esc(m.from)} → ${esc(m.to)}</li>`)].join("") || "<li>identical</li>"}</ul>`
		: `<p class="dim">The backup carries no manifest; mod versions cannot be compared.</p>`;
	$("#import-result").classList.remove("hidden");
	$("#import-result").innerHTML =
		`<p>Imported <span class="mono">${esc(r.id)}</span>: worlds ${esc(r.worlds.join(", ") || "none")}${r.hasConfigs ? ", configs included" : ""}.</p>${diffHtml}
		<p class="row"><label><input type="checkbox" id="imp-configs" ${r.hasConfigs ? "" : "disabled"}/> restore configs</label>
		<label><input type="checkbox" id="imp-mods" ${d ? "" : "disabled"}/> install the backup's mod versions</label>
		<button data-restore="${esc(r.id)}" data-opts="1">Restore ${esc(r.worlds[0] ?? "")} now</button></p>`;
}

document.addEventListener("click", async (e) => {
	const del = e.target.closest("[data-delete]");
	if (del) {
		if (!confirm(`Delete ${del.dataset.delete}?`)) return;
		await api(`/backups/${encodeURIComponent(del.dataset.delete)}`, { method: "DELETE" }).catch((err) => toast(err.message, "err"));
		return api("/backups").then(renderBackups);
	}
	const rs = e.target.closest("[data-restore]");
	if (!rs) return;
	const id = rs.dataset.restore;
	const opts = rs.dataset.opts ? { configs: $("#imp-configs")?.checked, mods: $("#imp-mods")?.checked } : {};
	if (!confirm(`Restore ${id}? The server is stopped, a safety backup is taken first, then the world is replaced.`)) return;
	rs.disabled = true;
	try {
		const r = await api(`/backups/${encodeURIComponent(id)}/restore`, { method: "POST", body: opts });
		toast(`Restored ${r.restored.join(", ")}${r.safety ? `; safety copy ${r.safety.id}` : ""}`, "ok");
		api("/backups").then(renderBackups);
		loadPublic();
	} catch (err) {
		toast(err.message, "err");
	} finally {
		rs.disabled = false;
	}
});

$("#env-save").onclick = async () => {
	const changes = Object.fromEntries($$("[data-env]").map((i) => [i.dataset.env, i.value]));
	try {
		await api("/env", { method: "PUT", body: changes });
		toast("valheim.env saved. Restart the server to apply.", "ok");
	} catch (e) {
		toast(e.message, "err");
	}
};

$("#players-save").onclick = async () => {
	try {
		for (const k of ["admin", "permitted", "banned"]) await api(`/players/${k}`, { method: "PUT", body: { entries: parseListText($(`#list-${k}`).value) } });
		toast("Player lists saved.", "ok");
		api("/players").then(renderPlayers);
	} catch (e) {
		toast(e.message, "err");
	}
};

$("#log-refresh").onclick = () => loadLog().catch((e) => toast(e.message, "err"));
$("#log-follow").onclick = () => followLog(!logSource);
$("#log-filter").oninput = renderLog;

loadPublic().catch((e) => ($("#status").textContent = e.message));
showAdmin(!!token);
