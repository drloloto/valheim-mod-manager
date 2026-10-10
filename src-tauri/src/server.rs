//! Linked server (the companion container): fetch its manifest, compare it with the local plan,
//! adopt its versions, publish the local plan. The manifest is the lock both sides agree on.
use crate::error::{AppError, Result};
use crate::models::{Profile, ProfileMod, Resolved, ServerLink, Source};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

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
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ServerInfo {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub world: String,
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
    /// Resolved locally, not on the server.
    pub only_local: Vec<ManifestMod>,
    pub changed: Vec<Changed>,
}

impl ServerDiff {
    pub fn is_empty(&self) -> bool {
        self.only_server.is_empty() && self.only_local.is_empty() && self.changed.is_empty()
    }
}

/// Local resolved set vs the server manifest; the BepInEx pack is ignored on both sides.
pub fn diff(local: &BTreeMap<String, Resolved>, manifest: &[ManifestMod]) -> ServerDiff {
    let mut d = ServerDiff::default();
    let server: BTreeMap<&str, &ManifestMod> = manifest.iter().filter(|m| !is_pack(&m.id)).map(|m| (m.id.as_str(), m)).collect();
    for (id, r) in local.iter().filter(|(id, _)| !is_pack(id)) {
        match server.get(id.as_str()) {
            None => d.only_local.push(ManifestMod {
                id: id.clone(),
                version: r.version.clone(),
                explicit: r.required_by.is_empty(),
                required_by: r.required_by.clone(),
            }),
            Some(m) if m.version != r.version => d.changed.push(Changed { id: id.clone(), local: r.version.clone(), server: m.version.clone() }),
            Some(_) => {}
        }
    }
    for (id, m) in server {
        if !local.contains_key(id) {
            d.only_server.push((*m).clone());
        }
    }
    d
}

/// The lock to publish: every resolved package, `explicit` from the profile. Local mods cannot be
/// installed on the server and are returned separately.
pub fn manifest_mods(profile: &Profile, resolved: &BTreeMap<String, Resolved>) -> (Vec<ManifestMod>, Vec<String>) {
    let explicit: Vec<String> = profile.mods.iter().filter(|m| m.source == Source::Thunderstore && m.enabled).map(ProfileMod::id).collect();
    let local: Vec<String> = profile.mods.iter().filter(|m| m.source == Source::Local).map(ProfileMod::id).collect();
    let mods = resolved
        .iter()
        .filter(|(id, _)| !local.contains(id))
        .map(|(id, r)| ManifestMod { id: id.clone(), version: r.version.clone(), explicit: explicit.contains(id), required_by: r.required_by.clone() })
        .collect();
    (mods, local)
}

/// Rewrites the profile to the manifest: every entry becomes an explicit, pinned, enabled Thunderstore
/// mod (so the resolver cannot drift from the server); local mods are kept.
pub fn adopt(profile: &mut Profile, manifest: &[ManifestMod]) {
    let mut mods: Vec<ProfileMod> = profile.mods.iter().filter(|m| m.source == Source::Local).cloned().collect();
    for m in manifest {
        if let Some((ns, name)) = m.id.split_once('-') {
            mods.push(ProfileMod::thunderstore(ns, name, &m.version));
        }
    }
    profile.mods = mods;
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

#[derive(Serialize)]
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
    /// Normalized base URL to link.
    pub url: String,
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

pub async fn discover(client: &reqwest::Client, raw: &str) -> Result<Discovery> {
    let url = guess_base(raw)?;
    let link = ServerLink { url: url.clone(), name: String::new(), token: None };
    let m = fetch_manifest(client, &link).await.map_err(|e| AppError::Network(format!("No companion found at {url}: {e}")))?;
    Ok(Discovery { url, name: m.server.name, world: m.server.world, mods: m.mods.iter().filter(|x| !is_pack(&x.id)).count(), features: m.features })
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
        Resolved { version: v.into(), required_by: by.iter().map(|s| s.to_string()).collect() }
    }
    fn mm(id: &str, v: &str) -> ManifestMod {
        ManifestMod { id: id.into(), version: v.into(), explicit: true, required_by: vec![] }
    }

    #[test]
    fn diff_ignores_pack_and_reports_three_kinds() {
        let mut local = BTreeMap::new();
        local.insert("a-A".to_string(), res("1.0.0", &[]));
        local.insert("b-B".to_string(), res("1.0.0", &["a-A"]));
        local.insert("denikson-BepInExPack_Valheim".to_string(), res("5.4.2351", &[]));
        let manifest = vec![mm("a-A", "2.0.0"), mm("c-C", "1.0.0")];
        let d = diff(&local, &manifest);
        assert_eq!(d.changed, vec![Changed { id: "a-A".into(), local: "1.0.0".into(), server: "2.0.0".into() }]);
        assert_eq!(d.only_local.iter().map(|m| m.id.as_str()).collect::<Vec<_>>(), vec!["b-B"]);
        assert!(!d.only_local[0].explicit);
        assert_eq!(d.only_server, vec![mm("c-C", "1.0.0")]);
        assert!(diff(&local, &[mm("a-A", "1.0.0"), mm("b-B", "1.0.0")]).is_empty());
    }

    #[test]
    fn manifest_mods_and_adopt_round_trip() {
        let mut p = Profile { name: "p".into(), mods: vec![ProfileMod::thunderstore("a", "A", "1.0.0")], server: None };
        p.mods.push(ProfileMod { namespace: "local".into(), name: "Mine".into(), version: "0.1.0".into(), enabled: true, source: Source::Local, deps: vec![] });
        let mut resolved = BTreeMap::new();
        resolved.insert("a-A".to_string(), res("1.0.0", &[]));
        resolved.insert("b-B".to_string(), res("2.0.0", &["a-A"]));
        resolved.insert("local-Mine".to_string(), res("0.1.0", &[]));
        let (mods, local) = manifest_mods(&p, &resolved);
        assert_eq!(local, vec!["local-Mine"]);
        assert_eq!(mods.len(), 2);
        assert!(mods[0].explicit && !mods[1].explicit);
        assert_eq!(mods[1].required_by, vec!["a-A"]);

        adopt(&mut p, &[mm("a-A", "1.5.0"), mm("b-B", "2.0.0")]);
        assert_eq!(
            p.mods.iter().map(|m| (m.id(), m.version.clone())).collect::<Vec<_>>(),
            vec![("local-Mine".into(), "0.1.0".into()), ("a-A".into(), "1.5.0".into()), ("b-B".into(), "2.0.0".into())]
        );
        assert!(p.mods.iter().all(|m| m.enabled));
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
        let body = StageBody { mods: vec![mm("a-A", "1.0.0")], configs: vec![encode_config("sub\\x.cfg", b"k=v")] };
        let s = serde_json::to_string(&body).unwrap();
        assert!(s.contains("\"requiredBy\":[]") && s.contains("\"path\":\"sub/x.cfg\"") && s.contains("\"contentBase64\":\"az12\""));
    }
}
