//! Linked server (the companion container): fetch its manifest, compare it with the local plan,
//! adopt its versions, publish the local plan. The manifest is the lock both sides agree on.
use crate::error::{AppError, Result};
use crate::models::{Pkg, Profile, ProfileMod, Resolved, ServerLink, Source, Store};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, HashMap, HashSet};

fn yes() -> bool {
    true
}

pub fn is_pack(id: &str) -> bool {
    id.to_ascii_lowercase().starts_with("denikson-bepinexpack")
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ManifestMod {
    pub id: String,
    pub version: String,
    #[serde(default = "yes")]
    pub explicit: bool,
    #[serde(default)]
    pub required_by: Vec<String>,
    /// Namespace and name as the index knows them: `id` alone cannot be split when the team name has a
    /// hyphen (`LVH-IT-UseEquipmentInWater`). Empty in a diff and in locks from older clients.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub ns: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub name: String,
    /// The store the companion downloads this release from; locks from older clients mean Thunderstore.
    #[serde(default)]
    pub source: Store,
}

impl ManifestMod {
    /// (namespace, name): the stored pair, or the id split at its first hyphen.
    pub fn split(&self) -> Option<(&str, &str)> {
        if !self.ns.is_empty() && !self.name.is_empty() {
            return Some((&self.ns, &self.name));
        }
        self.id.split_once('-').filter(|(ns, name)| !ns.is_empty() && !name.is_empty())
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ServerInfo {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub world: String,
}

/// The release whose apply produced the server's lock: its id, the name the admin gave it (the profile),
/// when, and the transport. Missing on locks from before release tracking or from a takeover.
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseRef {
    pub id: String,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub applied_at: i64,
    #[serde(default)]
    pub source: Option<String>,
}

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    #[serde(default)]
    pub server: ServerInfo,
    pub mods: Vec<ManifestMod>,
    #[serde(default)]
    pub configs: BTreeMap<String, String>,
    #[serde(default)]
    pub hash: String,
    #[serde(default)]
    pub generated_at: i64,
    /// Companion switches relevant to the client (e.g. `publish: false`).
    #[serde(default)]
    pub features: BTreeMap<String, bool>,
    #[serde(default)]
    pub release: Option<ReleaseRef>,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Changed {
    pub id: String,
    pub local: String,
    pub server: String,
}

#[derive(Serialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ServerDiff {
    /// On the server, not resolved locally.
    pub only_server: Vec<ManifestMod>,
    /// Resolved locally, not on the server: the player's own mods (an admin's unpublished work).
    pub only_local: Vec<ManifestMod>,
    /// The server's mods (`managed`) it no longer lists: adoption uninstalls them.
    pub dropped: Vec<ManifestMod>,
    pub changed: Vec<Changed>,
}

/// Ids the server claims in this profile: every `managed` entry, or, in a profile adopted before `managed`
/// existed (the link has `last_adopted`, nothing is managed), every Thunderstore entry.
pub fn servers_ids(profile: &Profile) -> HashSet<String> {
    let legacy = profile.server.as_ref().is_some_and(|s| s.last_adopted.is_some()) && !profile.mods.iter().any(|m| m.managed);
    profile.mods.iter().filter(|m| m.managed || (legacy && m.source == Source::Thunderstore)).map(ProfileMod::id).collect()
}

/// Local resolved set vs the server manifest; the BepInEx pack is ignored on both sides. A local mod the
/// server does not list is `dropped` when the server put it there (see `servers_ids`), `only_local` when
/// the player did. A disabled server mod the server dropped is not resolved, so it is read off the profile.
pub fn diff(profile: &Profile, local: &BTreeMap<String, Resolved>, manifest: &[ManifestMod]) -> ServerDiff {
    let mut d = ServerDiff::default();
    let servers = servers_ids(profile);
    let server: BTreeMap<&str, &ManifestMod> = manifest.iter().filter(|m| !is_pack(&m.id)).map(|m| (m.id.as_str(), m)).collect();
    for (id, r) in local.iter().filter(|(id, _)| !is_pack(id)) {
        match server.get(id.as_str()) {
            None => {
                let m = ManifestMod {
                    id: id.clone(),
                    version: r.version.clone(),
                    explicit: r.required_by.is_empty(),
                    required_by: r.required_by.clone(),
                    ns: String::new(),
                    name: String::new(),
                    source: r.store,
                };
                if servers.contains(id) {
                    d.dropped.push(m);
                } else {
                    d.only_local.push(m);
                }
            }
            Some(m) if m.version != r.version => d.changed.push(Changed { id: id.clone(), local: r.version.clone(), server: m.version.clone() }),
            Some(_) => {}
        }
    }
    for m in profile.mods.iter().filter(|m| !m.enabled && servers.contains(&m.id())) {
        let id = m.id();
        if !is_pack(&id) && !server.contains_key(id.as_str()) && !local.contains_key(&id) {
            d.dropped.push(ManifestMod {
                id,
                version: m.version.clone(),
                explicit: !m.implicit,
                required_by: vec![],
                ns: String::new(),
                name: String::new(),
                source: Store::Thunderstore,
            });
        }
    }
    for (id, m) in server {
        if !local.contains_key(id) {
            d.only_server.push((*m).clone());
        }
    }
    d
}

/// The lock to publish: every resolved package, `explicit` from the profile, namespace and name from the
/// index. Local mods cannot be installed on the server and are returned separately.
pub fn manifest_mods(profile: &Profile, resolved: &BTreeMap<String, Resolved>, by_id: &HashMap<String, Pkg>) -> (Vec<ManifestMod>, Vec<String>) {
    let explicit: Vec<String> = profile.mods.iter().filter(|m| m.source == Source::Thunderstore && m.enabled && !m.implicit).map(ProfileMod::id).collect();
    let local: Vec<String> = profile.mods.iter().filter(|m| m.source == Source::Local).map(ProfileMod::id).collect();
    let mods = resolved
        .iter()
        .filter(|(id, _)| !local.contains(id))
        .map(|(id, r)| {
            let (ns, name) = by_id.get(id).map(|p| (p.ns.clone(), p.name.clone())).unwrap_or_default();
            ManifestMod {
                id: id.clone(),
                version: r.version.clone(),
                explicit: explicit.contains(id),
                required_by: r.required_by.clone(),
                ns,
                name,
                source: r.store,
            }
        })
        .collect();
    (mods, local)
}

/// `<manifest hash>:<config hash>` of a server state, what `ServerLink::last_adopted` remembers. The config
/// part hashes the manifest's `configs` map (path → sha256) in path order.
pub fn adopted_stamp(manifest_hash: &str, configs: &BTreeMap<String, String>) -> String {
    let mut h = Sha256::new();
    for (path, hash) in configs {
        h.update(path.as_bytes());
        h.update([0]);
        h.update(hash.as_bytes());
        h.update([0]);
    }
    let digest: String = h.finalize().iter().map(|b| format!("{b:02x}")).collect();
    format!("{manifest_hash}:{digest}")
}

/// Writes the server's list into the profile: every listed mod becomes a pinned, enabled, `managed`
/// Thunderstore entry in the server's version (so neither the resolver nor "Update all" can drift from the
/// server), replacing whatever the profile had under that id. What the server lists as a dependency *of
/// something* stays one here (`implicit`); an entry the server calls a dependency that nothing requires is
/// a pick (older locks carry such entries). Managed entries the server no longer lists are removed.
/// Everything else, the player's own mods and local mods, stays untouched, so a player can run
/// client-side extras next to the server's set.
///
/// A profile adopted before `managed` existed was the server list in full (the old rewrite); it is read
/// that way once (`servers_ids`), so its next adoption behaves exactly as before.
pub fn adopt(profile: &mut Profile, manifest: &[ManifestMod]) {
    let servers = servers_ids(profile);
    let listed = |m: &ProfileMod| manifest.iter().any(|x| x.id == m.id());
    let mut mods: Vec<ProfileMod> = profile.mods.iter().filter(|m| m.source == Source::Local || (!listed(m) && !servers.contains(&m.id()))).cloned().collect();
    for m in manifest {
        if let Some((ns, name)) = m.split() {
            let implicit = !m.explicit && !m.required_by.is_empty();
            mods.push(ProfileMod { implicit, managed: true, pinned: true, ..ProfileMod::thunderstore(ns, name, &m.version) });
        }
    }
    profile.mods = mods;
}

/// Whether a link carries admin credentials (publishing), on either transport.
pub fn is_admin(link: &ServerLink) -> bool {
    let set = |s: &Option<String>| s.as_deref().is_some_and(|t| !t.trim().is_empty());
    set(&link.token) || set(&link.gist_token)
}

/// A player is in sync when every server mod is there in the server's version and nothing the server
/// dropped is still installed; mods only they have are theirs to keep. An admin's profile is the server
/// list, so a mod only they have is unpublished work.
pub fn in_sync(d: &ServerDiff, admin: bool) -> bool {
    d.only_server.is_empty() && d.changed.is_empty() && d.dropped.is_empty() && (!admin || d.only_local.is_empty())
}

pub fn normalize_url(url: &str) -> Result<String> {
    let u = url.trim().trim_end_matches('/');
    if !(u.starts_with("http://") || u.starts_with("https://")) || u.len() < 10 || u.contains(char::is_whitespace) {
        return Err(AppError::Invalid("The server address must start with http:// or https://.".into()));
    }
    Ok(u.to_string())
}

pub async fn fetch_manifest(client: &reqwest::Client, link: &ServerLink) -> Result<Manifest> {
    let url = format!("{}/api/manifest", normalize_url(&link.url)?);
    let res = client.get(&url).send().await?;
    if !res.status().is_success() {
        return Err(AppError::Network(format!("{url}: HTTP {}", res.status())));
    }
    Ok(res.json::<Manifest>().await?)
}

const MAX_R2Z: usize = 64 * 1024 * 1024;

pub async fn fetch_bytes(client: &reqwest::Client, url: &str) -> Result<Vec<u8>> {
    let url = url.trim();
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err(AppError::Invalid("Only http(s) URLs can be imported.".into()));
    }
    let res = client.get(url).send().await?;
    if !res.status().is_success() {
        return Err(AppError::Network(format!("{url}: HTTP {}", res.status())));
    }
    let bytes = res.bytes().await?;
    if bytes.len() > MAX_R2Z {
        return Err(AppError::Invalid("The downloaded profile is too large.".into()));
    }
    Ok(bytes.to_vec())
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PublishConfig {
    pub path: String,
    pub content_base64: String,
}

/// Body of `POST /api/releases`: the lock plus the config files to stage.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StageBody {
    pub mods: Vec<ManifestMod>,
    pub configs: Vec<PublishConfig>,
    /// What the admin calls the release: the profile's name.
    pub name: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct ActionResult {
    pub ok: bool,
    #[serde(default)]
    pub message: String,
}

/// "idle" = when nobody is online, "at" = at `at` (epoch ms).
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Schedule {
    pub when: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub at: Option<i64>,
    #[serde(default)]
    pub set_at: i64,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseSummary {
    pub id: String,
    #[serde(default)]
    pub created_at: i64,
    #[serde(default)]
    pub install: usize,
    #[serde(default)]
    pub remove: usize,
    #[serde(default)]
    pub configs: usize,
    #[serde(default)]
    pub problems: Vec<String>,
    #[serde(default)]
    pub schedule: Option<Schedule>,
    #[serde(default)]
    pub last_error: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct PlanItem {
    pub id: String,
    #[serde(default)]
    pub from: Option<String>,
    pub to: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct ReleasePlan {
    #[serde(default)]
    pub install: Vec<PlanItem>,
    #[serde(default)]
    pub remove: Vec<String>,
    #[serde(default)]
    pub configs_changed: Vec<String>,
    #[serde(default)]
    pub configs_new: Vec<String>,
}

/// What the companion staged: the plan it will execute and the problems it found while pulling.
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct Release {
    pub id: String,
    #[serde(default)]
    pub plan: ReleasePlan,
    #[serde(default)]
    pub problems: Vec<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct StageResponse {
    pub release: Release,
    pub summary: ReleaseSummary,
    #[serde(default)]
    pub online: Option<usize>,
    #[serde(default)]
    pub log: Vec<String>,
    /// Local mods that were left out because the server cannot install them.
    #[serde(default)]
    pub skipped_local: Vec<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct ApplyResult {
    #[serde(default)]
    pub installed: Vec<String>,
    #[serde(default)]
    pub removed: Vec<String>,
    #[serde(default)]
    pub errors: Vec<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct ApplyResponse {
    pub applied: bool,
    #[serde(default)]
    pub summary: Option<ReleaseSummary>,
    #[serde(default)]
    pub result: Option<ApplyResult>,
    #[serde(default)]
    pub configs_written: Vec<String>,
    #[serde(default)]
    pub stopped: Option<ActionResult>,
    #[serde(default)]
    pub started: Option<ActionResult>,
    #[serde(default)]
    pub restart_required: bool,
    #[serde(default)]
    pub log: Vec<String>,
}

/// "Autoconfig" for players: paste anything that points at a companion and get name, world and mod count.
#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct Discovery {
    /// Normalized base URL to link; empty for a gist server.
    pub url: String,
    /// Set when the pasted text held a sync code: the server is reached through its gist.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sync_code: Option<String>,
    /// The gist's id, shortened: the server's identity as the page and the companion log show it.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gist: Option<String>,
    pub name: String,
    pub world: String,
    pub mods: usize,
    pub features: BTreeMap<String, bool>,
}

/// Accepts "10.10.10.123:9002", "http://host:9002/", a landing-page or API URL; tries http:// when no scheme is given.
pub fn guess_base(raw: &str) -> Result<String> {
    let mut s = raw.trim().to_string();
    if s.is_empty() {
        return Err(AppError::Invalid("Enter the server address.".into()));
    }
    if !(s.starts_with("http://") || s.starts_with("https://")) {
        s = format!("http://{s}");
    }
    // Cut everything after the host[:port] except nothing: paths like /api/manifest or /configs are noise.
    let (scheme, rest) = s.split_once("://").unwrap_or(("http", &s));
    let host = rest.split(['/', '?', '#']).next().unwrap_or("");
    if host.is_empty() || host.contains(char::is_whitespace) {
        return Err(AppError::Invalid("The server address is not valid.".into()));
    }
    normalize_url(&format!("{scheme}://{host}"))
}

/// `GET /api/sync` of a companion: its sync code when the gist sync is on. The companion is the only source of
/// the code, so an address is just another way to find it; None when the companion is off, old, or has no sync.
pub async fn fetch_sync_code(client: &reqwest::Client, base: &str) -> Option<String> {
    #[derive(Deserialize)]
    struct Sync {
        #[serde(default)]
        enabled: bool,
        #[serde(default)]
        code: Option<String>,
    }
    let res = client.get(format!("{base}/api/sync")).send().await.ok()?;
    if !res.status().is_success() {
        return None;
    }
    let s: Sync = res.json().await.ok()?;
    s.code.filter(|c| s.enabled && !c.is_empty())
}

pub async fn discover(client: &reqwest::Client, raw: &str) -> Result<Discovery> {
    let url = guess_base(raw)?;
    let link = ServerLink { url: url.clone(), ..Default::default() };
    let m = fetch_manifest(client, &link).await.map_err(|e| AppError::Network(format!("No companion found at {url}: {e}")))?;
    Ok(Discovery {
        url,
        sync_code: None,
        gist: None,
        name: m.server.name,
        world: m.server.world,
        mods: m.mods.iter().filter(|x| !is_pack(&x.id)).count(),
        features: m.features,
    })
}

/// Subset of `GET /api/status` the client cares about.
#[derive(Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    #[serde(default)]
    pub release: Option<ReleaseSummary>,
    #[serde(default)]
    pub online: Option<usize>,
}

pub fn encode_config(path: &str, bytes: &[u8]) -> PublishConfig {
    PublishConfig { path: path.replace('\\', "/"), content_base64: STANDARD.encode(bytes) }
}

/// The file's bytes, or None when the server sent something that is not base64.
pub fn decode_config(c: &PublishConfig) -> Option<Vec<u8>> {
    STANDARD.decode(&c.content_base64).ok()
}

pub async fn fetch_status(client: &reqwest::Client, link: &ServerLink) -> Result<Status> {
    let url = format!("{}/api/status", normalize_url(&link.url)?);
    let res = client.get(&url).send().await?;
    if !res.status().is_success() {
        return Err(AppError::Network(format!("{url}: HTTP {}", res.status())));
    }
    Ok(res.json::<Status>().await?)
}

fn token_of(link: &ServerLink) -> Result<&str> {
    link.token
        .as_deref()
        .map(str::trim)
        .filter(|t| !t.is_empty())
        .ok_or_else(|| AppError::Invalid("The server token is missing. Set it under Server → Link.".into()))
}

/// Stage a release: the companion pulls the zips and configs, checks them, changes nothing live.
pub async fn stage(client: &reqwest::Client, link: &ServerLink, body: &StageBody) -> Result<StageResponse> {
    let url = format!("{}/api/releases", normalize_url(&link.url)?);
    let res = client.post(&url).bearer_auth(token_of(link)?).json(body).send().await?;
    parse_response(res, "Staging failed").await
}

/// `when`: "now" | "idle" | "at" (+ `at`) | "none" (clear the schedule).
pub async fn apply(client: &reqwest::Client, link: &ServerLink, id: &str, when: &str, at: Option<i64>) -> Result<ApplyResponse> {
    let url = format!("{}/api/releases/{id}/apply", normalize_url(&link.url)?);
    let body = serde_json::json!({ "when": when, "at": at });
    let res = client.post(&url).bearer_auth(token_of(link)?).json(&body).send().await?;
    parse_response(res, "Apply failed").await
}

pub async fn discard(client: &reqwest::Client, link: &ServerLink, id: &str) -> Result<()> {
    let url = format!("{}/api/releases/{id}", normalize_url(&link.url)?);
    let res = client.delete(&url).bearer_auth(token_of(link)?).send().await?;
    parse_response::<serde_json::Value>(res, "Discard failed").await.map(|_| ())
}

async fn parse_response<T: serde::de::DeserializeOwned>(res: reqwest::Response, what: &str) -> Result<T> {
    let status = res.status();
    let text = res.text().await?;
    if !status.is_success() {
        let msg = serde_json::from_str::<serde_json::Value>(&text).ok().and_then(|v| v.get("error")?.as_str().map(String::from)).unwrap_or(text);
        return Err(AppError::Network(format!("{what} (HTTP {status}): {msg}")));
    }
    Ok(serde_json::from_str(&text)?)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn res(v: &str, by: &[&str]) -> Resolved {
        Resolved { version: v.into(), required_by: by.iter().map(|s| s.to_string()).collect(), store: Store::Thunderstore }
    }
    fn mm(id: &str, v: &str) -> ManifestMod {
        ManifestMod {
            id: id.into(),
            version: v.into(),
            explicit: true,
            required_by: vec![],
            ns: String::new(),
            name: String::new(),
            source: Store::Thunderstore,
        }
    }

    #[test]
    fn diff_ignores_pack_and_reports_three_kinds() {
        let mut local = BTreeMap::new();
        local.insert("a-A".to_string(), res("1.0.0", &[]));
        local.insert("b-B".to_string(), res("1.0.0", &["a-A"]));
        local.insert("denikson-BepInExPack_Valheim".to_string(), res("5.4.2351", &[]));
        let manifest = vec![mm("a-A", "2.0.0"), mm("c-C", "1.0.0")];
        let p = Profile::default();
        let d = diff(&p, &local, &manifest);
        assert_eq!(d.changed, vec![Changed { id: "a-A".into(), local: "1.0.0".into(), server: "2.0.0".into() }]);
        assert_eq!(d.only_local.iter().map(|m| m.id.as_str()).collect::<Vec<_>>(), vec!["b-B"]);
        assert!(!d.only_local[0].explicit);
        assert!(d.dropped.is_empty());
        assert_eq!(d.only_server, vec![mm("c-C", "1.0.0")]);
        assert!(in_sync(&diff(&p, &local, &[mm("a-A", "1.0.0"), mm("b-B", "1.0.0")]), true));
    }

    #[test]
    fn diff_reports_a_dropped_server_mod_as_out_of_sync_for_players() {
        // me-Minimap is the player's own, a-A and b-B came from the server; the server dropped b-B.
        let mut mods = vec![ProfileMod::thunderstore("me", "Minimap", "1.0.0")];
        mods.push(ProfileMod { managed: true, ..ProfileMod::thunderstore("a", "A", "1.0.0") });
        mods.push(ProfileMod { managed: true, enabled: false, ..ProfileMod::thunderstore("b", "B", "1.0.0") });
        mods.push(ProfileMod { managed: true, ..ProfileMod::thunderstore("c", "C", "1.0.0") });
        let p = Profile { name: "p".into(), mods, server: None };
        let mut local = BTreeMap::new();
        local.insert("me-Minimap".to_string(), res("1.0.0", &[]));
        local.insert("a-A".to_string(), res("1.0.0", &[]));
        local.insert("c-C".to_string(), res("1.0.0", &[]));
        let d = diff(&p, &local, &[mm("a-A", "1.0.0")]);
        assert_eq!(d.only_local.iter().map(|m| m.id.as_str()).collect::<Vec<_>>(), vec!["me-Minimap"]);
        // c-C runs and is dropped; b-B is disabled (not resolved), still the server's, still dropped.
        assert_eq!(d.dropped.iter().map(|m| m.id.as_str()).collect::<Vec<_>>(), vec!["c-C", "b-B"]);
        assert!(!in_sync(&d, false));
        // Listed again and running: in sync (b-B stays disabled, so it is "only on the server", as before).
        local.insert("b-B".to_string(), res("1.0.0", &[]));
        assert!(in_sync(&diff(&p, &local, &[mm("a-A", "1.0.0"), mm("b-B", "1.0.0"), mm("c-C", "1.0.0")]), false));
        // A profile adopted before `managed` existed: every Thunderstore entry is the server's.
        let legacy = Profile {
            name: "p".into(),
            mods: vec![ProfileMod::thunderstore("old", "Gone", "1.0.0")],
            server: Some(ServerLink { last_adopted: Some("h:c".into()), ..Default::default() }),
        };
        let mut local = BTreeMap::new();
        local.insert("old-Gone".to_string(), res("1.0.0", &[]));
        assert_eq!(diff(&legacy, &local, &[]).dropped.len(), 1);
    }

    #[test]
    fn manifest_mod_splits_hyphenated_teams_only_with_the_stored_pair() {
        let m = ManifestMod { ns: "LVH-IT".into(), name: "UseEquipmentInWater".into(), ..mm("LVH-IT-UseEquipmentInWater", "0.2.4") };
        assert_eq!(m.split(), Some(("LVH-IT", "UseEquipmentInWater")));
        assert_eq!(mm("LVH-IT-UseEquipmentInWater", "0.2.4").split(), Some(("LVH", "IT-UseEquipmentInWater")));
        assert_eq!(mm("broken", "1.0.0").split(), None);
        let s = serde_json::to_string(&m).unwrap();
        assert!(s.contains("\"ns\":\"LVH-IT\"") && !serde_json::to_string(&mm("a-A", "1.0.0")).unwrap().contains("\"ns\""));
        assert_eq!(adopted_stamp("sha256:x", &BTreeMap::new()).split(':').count(), 3);
        assert_ne!(adopted_stamp("h", &BTreeMap::from([("a.cfg".to_string(), "1".to_string())])), adopted_stamp("h", &BTreeMap::new()));
    }

    #[test]
    fn manifest_mods_and_adopt_round_trip() {
        let mut p = Profile { name: "p".into(), mods: vec![ProfileMod::thunderstore("a", "A", "1.0.0")], server: None };
        p.mods.push(ProfileMod {
            namespace: "local".into(),
            name: "Mine".into(),
            version: "0.1.0".into(),
            enabled: true,
            source: Source::Local,
            pinned: false,
            implicit: false,
            managed: false,
            deps: vec![],
        });
        let mut resolved = BTreeMap::new();
        resolved.insert("a-A".to_string(), res("1.0.0", &[]));
        resolved.insert("b-B".to_string(), res("2.0.0", &["a-A"]));
        resolved.insert("local-Mine".to_string(), res("0.1.0", &[]));
        let by_id = HashMap::from([("a-A".to_string(), crate::models::test_pkg("a-A", &[("1.0.0", &[])]))]);
        let (mods, local) = manifest_mods(&p, &resolved, &by_id);
        assert_eq!(local, vec!["local-Mine"]);
        assert_eq!(mods.len(), 2);
        assert!(mods[0].explicit && !mods[1].explicit);
        assert_eq!(mods[1].required_by, vec!["a-A"]);
        assert_eq!((mods[0].ns.as_str(), mods[0].name.as_str(), mods[1].ns.as_str()), ("a", "A", ""));

        // b-B is a dependency of a-A; c-C is called a dependency but nothing requires it, so it is a pick.
        adopt(
            &mut p,
            &[
                mm("a-A", "1.5.0"),
                ManifestMod { explicit: false, required_by: vec!["a-A".into()], ..mm("b-B", "2.0.0") },
                ManifestMod { explicit: false, ..mm("c-C", "1.0.0") },
            ],
        );
        assert_eq!(
            p.mods.iter().map(|m| (m.id(), m.version.clone(), m.implicit)).collect::<Vec<_>>(),
            vec![
                ("local-Mine".into(), "0.1.0".into(), false),
                ("a-A".into(), "1.5.0".into(), false),
                ("b-B".into(), "2.0.0".into(), true),
                ("c-C".into(), "1.0.0".into(), false)
            ]
        );
        assert!(p.mods.iter().all(|m| m.enabled));
        // Server mods are pinned: "Update all" never moves them off the server's version.
        assert!(p.mods.iter().filter(|m| m.managed).all(|m| m.pinned));
        // Publishing the adopted profile again reports the dependency as one, not as a pick of this player.
        let mut resolved = BTreeMap::new();
        resolved.insert("a-A".to_string(), res("1.5.0", &[]));
        resolved.insert("b-B".to_string(), res("2.0.0", &["a-A"]));
        resolved.insert("c-C".to_string(), res("1.0.0", &[]));
        let (mods, _) = manifest_mods(&p, &resolved, &HashMap::new());
        assert_eq!(mods.iter().map(|m| (m.id.as_str(), m.explicit)).collect::<Vec<_>>(), vec![("a-A", true), ("b-B", false), ("c-C", true)]);
    }

    #[test]
    fn adopt_replaces_the_servers_set_and_keeps_the_players_own_mods() {
        let ids = |p: &Profile| p.mods.iter().map(|m| (m.id(), m.version.clone(), m.managed)).collect::<Vec<_>>();
        let own = |id: &str, v: &str| (id.to_string(), v.to_string(), false);
        let srv = |id: &str, v: &str| (id.to_string(), v.to_string(), true);
        let mods = vec![ProfileMod::thunderstore("me", "Minimap", "1.0.0"), ProfileMod::thunderstore("a", "A", "1.0.0")];
        let mut p = Profile { name: "p".into(), mods, server: None };
        // first adoption: a-A takes the server's version, the player's Minimap stays
        adopt(&mut p, &[mm("a-A", "1.5.0"), mm("b-B", "2.0.0")]);
        assert_eq!(ids(&p), vec![own("me-Minimap", "1.0.0"), srv("a-A", "1.5.0"), srv("b-B", "2.0.0")]);
        // the server drops b-B and the player has added c-C meanwhile: b-B goes, c-C stays
        p.mods.push(ProfileMod::thunderstore("c", "C", "3.0.0"));
        adopt(&mut p, &[mm("a-A", "1.6.0")]);
        assert_eq!(ids(&p), vec![own("me-Minimap", "1.0.0"), own("c-C", "3.0.0"), srv("a-A", "1.6.0")]);
        assert!(p.mods.iter().all(|m| m.enabled));
    }

    #[test]
    fn adopt_reads_a_profile_adopted_before_managed_existed_as_the_server_list() {
        let link = ServerLink { last_adopted: Some("h:c".into()), ..Default::default() };
        let mods = vec![ProfileMod::thunderstore("a", "A", "1.0.0"), ProfileMod::thunderstore("old", "Gone", "1.0.0")];
        let mut p = Profile { name: "p".into(), mods, server: Some(link) };
        adopt(&mut p, &[mm("a-A", "1.0.0")]);
        assert_eq!(p.mods.iter().map(|m| (m.id(), m.managed)).collect::<Vec<_>>(), vec![("a-A".to_string(), true)]);
    }

    #[test]
    fn in_sync_ignores_a_players_own_mods_but_not_an_admins() {
        let extra = ServerDiff { only_local: vec![mm("me-Minimap", "1.0.0")], ..Default::default() };
        assert!(in_sync(&extra, false));
        assert!(!in_sync(&extra, true));
        let missing = ServerDiff { only_server: vec![mm("a-A", "1.0.0")], ..Default::default() };
        assert!(!in_sync(&missing, false));
        let dropped = ServerDiff { dropped: vec![mm("a-A", "1.0.0")], ..Default::default() };
        assert!(!in_sync(&dropped, false) && !in_sync(&dropped, true));
        assert!(is_admin(&ServerLink { gist_token: Some("g".into()), ..Default::default() }));
        assert!(!is_admin(&ServerLink { token: Some(" ".into()), ..Default::default() }));
    }

    #[test]
    fn url_rules() {
        assert_eq!(normalize_url(" http://10.10.10.123:9002/ ").unwrap(), "http://10.10.10.123:9002");
        assert!(normalize_url("10.10.10.123").is_err());
        assert!(normalize_url("ftp://x.y").is_err());
    }

    #[test]
    fn guess_base_accepts_what_players_paste() {
        for raw in ["10.10.10.123:9002", "http://10.10.10.123:9002/", "http://10.10.10.123:9002/api/manifest", "10.10.10.123:9002/configs#x"] {
            assert_eq!(guess_base(raw).unwrap(), "http://10.10.10.123:9002", "{raw}");
        }
        assert_eq!(guess_base("https://valheim.example.org/").unwrap(), "https://valheim.example.org");
        assert!(guess_base("   ").is_err());
        assert!(guess_base("http:///x").is_err());
    }

    #[test]
    fn manifest_json_shape() {
        let m: Manifest = serde_json::from_str(
            r#"{"schema":1,"server":{"name":"S","world":"W"},"mods":[{"id":"a-A","version":"1.0.0","explicit":false,"requiredBy":["b-B"]}],"hash":"sha256:x"}"#,
        )
        .unwrap();
        assert_eq!(m.server.name, "S");
        assert_eq!(m.mods[0].required_by, vec!["b-B"]);
        assert!(!m.mods[0].explicit);
        let body = StageBody { mods: vec![mm("a-A", "1.0.0")], configs: vec![encode_config("sub\\x.cfg", b"k=v")], name: "P".into() };
        let s = serde_json::to_string(&body).unwrap();
        assert!(s.contains("\"requiredBy\":[]") && s.contains("\"path\":\"sub/x.cfg\"") && s.contains("\"contentBase64\":\"az12\""));
    }
}

#[cfg(test)]
mod release_ref_tests {
    use super::*;

    #[test]
    fn manifest_carries_the_applied_release() {
        let m: Manifest = serde_json::from_str(r#"{"mods":[],"release":{"id":"r1","name":"Hardcore","appliedAt":5,"source":"client"}}"#).unwrap();
        assert_eq!(m.release, Some(ReleaseRef { id: "r1".into(), name: Some("Hardcore".into()), applied_at: 5, source: Some("client".into()) }));
        let old: Manifest = serde_json::from_str(r#"{"mods":[]}"#).unwrap();
        assert!(old.release.is_none());
    }
}
