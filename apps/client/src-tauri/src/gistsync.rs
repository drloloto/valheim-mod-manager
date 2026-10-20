//! Sync through a sealed GitHub gist: the same intent as server.rs, a different transport. Two
//! files live in one unlisted gist: `release.json` (admin → companion: the lock, configs, when to apply)
//! and `server.json` (companion → everyone: what the server runs, its configs, the release status). Both
//! are sealed with a key derived from the sync code's secret, so the gist id alone reveals nothing. The
//! formats match the companion's `synccrypto.ts` / `gistsync.ts` byte for byte.
use crate::error::{AppError, Result};
use crate::server::{ManifestMod, PublishConfig, Schedule, ServerInfo};
use crate::util::now_ms;
use aes_gcm::aead::{Aead, AeadCore, KeyInit, OsRng, Payload};
use aes_gcm::{Aes256Gcm, Nonce};
use base64::engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD};
use base64::Engine;
use hkdf::Hkdf;
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, HashMap};
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};

pub const SYNC_CODE_PREFIX: &str = "vmm1";
pub const RELEASE_FILE: &str = "release.json";
pub const SERVER_FILE: &str = "server.json";
pub const GITHUB_API: &str = "https://api.github.com";
const KDF_SALT: &[u8] = b"valheim-mod-manager-sync/v1";
const KDF_INFO: &[u8] = b"aes-256-gcm";
const NONCE_BYTES: usize = 12;
const TAG_BYTES: usize = 16;

pub type Key = [u8; 32];

// ---- Sync code and key ----

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SyncCode {
    pub gist_id: String,
    /// base64url, 32 random bytes
    pub secret: String,
}

/// The sync code inside whatever was pasted: alone, at the end of a URL (`http://host:9002/vmm1.…`), behind a
/// label, with whitespace around it. Only a code that parses counts.
pub fn find_sync_code(text: &str) -> Option<String> {
    let prefix = format!("{SYNC_CODE_PREFIX}.");
    let mut rest = text;
    while let Some(i) = rest.find(&prefix) {
        let tail = &rest[i..];
        let end = tail.find(|c: char| !(c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))).unwrap_or(tail.len());
        let candidate = tail[..end].trim_end_matches('.');
        if parse_sync_code(candidate).is_ok() {
            return Some(candidate.to_string());
        }
        rest = &rest[i + prefix.len()..];
    }
    None
}

/// `vmm1.<gist id>.<secret>`; whitespace around it is ignored.
pub fn parse_sync_code(raw: &str) -> Result<SyncCode> {
    let parts: Vec<&str> = raw.trim().split('.').collect();
    if parts.len() != 3 || parts[0] != SYNC_CODE_PREFIX {
        return Err(AppError::Invalid(format!("The sync code must look like {SYNC_CODE_PREFIX}.<gist id>.<secret>.")));
    }
    let (gist_id, secret) = (parts[1], parts[2]);
    if !(20..=40).contains(&gist_id.len()) || !gist_id.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f')) {
        return Err(AppError::Invalid("Sync code: the gist id is not valid.".into()));
    }
    if secret.len() != 43 || !secret.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-') {
        return Err(AppError::Invalid("Sync code: the secret is not valid.".into()));
    }
    Ok(SyncCode { gist_id: gist_id.to_string(), secret: secret.to_string() })
}

/// HKDF-SHA256(secret, salt "valheim-mod-manager-sync/v1", info "aes-256-gcm") → 32 bytes.
pub fn derive_key(secret: &str) -> Result<Key> {
    let ikm = URL_SAFE_NO_PAD.decode(secret).map_err(|_| AppError::Invalid("Sync code: the secret is not base64url.".into()))?;
    if ikm.len() < 16 {
        return Err(AppError::Invalid("Sync code: the secret is too short.".into()));
    }
    let mut key = [0u8; 32];
    Hkdf::<Sha256>::new(Some(KDF_SALT), &ikm).expand(KDF_INFO, &mut key).map_err(|_| AppError::Invalid("Key derivation failed.".into()))?;
    Ok(key)
}

// ---- Envelope ----

/// The sealed form of a gist file. `data` = AES-256-GCM(key, nonce, gzip(plaintext), aad = file name) ‖ tag.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Envelope {
    pub v: u8,
    pub alg: String,
    pub kdf: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub comp: Option<String>,
    pub nonce: String,
    pub data: String,
}

fn bad(msg: &str) -> AppError {
    AppError::Invalid(format!("Cannot open the sync file: {msg}."))
}

/// Seals `plaintext` for the gist file `name`; the name is the AAD, so a file cannot be moved to the other slot.
pub fn seal(key: &Key, name: &str, plaintext: &[u8]) -> Result<Envelope> {
    let mut gz = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
    gz.write_all(plaintext)?;
    let packed = gz.finish()?;
    let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
    let body =
        Aes256Gcm::new(key.into()).encrypt(&nonce, Payload { msg: &packed, aad: name.as_bytes() }).map_err(|_| AppError::Invalid("Sealing failed.".into()))?;
    Ok(Envelope {
        v: 1,
        alg: "A256GCM".into(),
        kdf: "HKDF-SHA256".into(),
        comp: Some("gzip".into()),
        nonce: STANDARD.encode(nonce),
        data: STANDARD.encode(body),
    })
}

/// Opens an envelope; fails on a wrong key, a tampered body or a foreign slot name.
pub fn open(key: &Key, name: &str, env: &Envelope) -> Result<Vec<u8>> {
    if env.v != 1 || env.alg != "A256GCM" {
        return Err(bad("not a sealed sync file"));
    }
    let gzip = match env.comp.as_deref() {
        None => false,
        Some("gzip") => true,
        Some(other) => return Err(bad(&format!("unknown compression {other}"))),
    };
    let nonce = STANDARD.decode(&env.nonce).map_err(|_| bad("malformed"))?;
    let body = STANDARD.decode(&env.data).map_err(|_| bad("malformed"))?;
    if nonce.len() != NONCE_BYTES || body.len() < TAG_BYTES {
        return Err(bad("malformed"));
    }
    let plain = Aes256Gcm::new(key.into())
        .decrypt(Nonce::from_slice(&nonce), Payload { msg: &body, aad: name.as_bytes() })
        .map_err(|_| bad("wrong secret or tampered content"))?;
    if !gzip {
        return Ok(plain);
    }
    let mut out = Vec::new();
    flate2::read::GzDecoder::new(plain.as_slice()).read_to_end(&mut out)?;
    Ok(out)
}

/// True for text that at least claims to be an envelope; the placeholder `{}` is not one and is ignored.
pub fn is_envelope(text: &str) -> bool {
    serde_json::from_str::<serde_json::Value>(text).ok().and_then(|v| v.get("alg")?.as_str().map(|a| a == "A256GCM")).unwrap_or(false)
}

pub fn seal_json<T: Serialize>(key: &Key, name: &str, value: &T) -> Result<String> {
    Ok(serde_json::to_string(&seal(key, name, &serde_json::to_vec(value)?)?)?)
}

pub fn open_json<T: DeserializeOwned>(key: &Key, name: &str, text: &str) -> Result<T> {
    let env: Envelope = serde_json::from_str(text).map_err(|_| bad("not a sealed sync file"))?;
    Ok(serde_json::from_slice(&open(key, name, &env)?)?)
}

// ---- File shapes (see the companion's gistsync.ts) ----

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PlanCounts {
    #[serde(default)]
    pub install: usize,
    #[serde(default)]
    pub remove: usize,
    #[serde(default)]
    pub configs: usize,
}

/// `server.json.release`: what became of the last release.json the companion saw.
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseStatus {
    pub id: String,
    #[serde(default)]
    pub companion_id: Option<String>,
    /// staged | scheduled | applied | failed | rejected | discarded
    pub state: String,
    #[serde(default)]
    pub handled_at: i64,
    #[serde(default)]
    pub problems: Vec<String>,
    #[serde(default)]
    pub error: Option<String>,
    #[serde(default)]
    pub schedule: Option<Schedule>,
    #[serde(default)]
    pub plan: Option<PlanCounts>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct GistManifest {
    #[serde(default)]
    pub hash: String,
    #[serde(default)]
    pub generated_at: i64,
    #[serde(default)]
    pub mods: Vec<ManifestMod>,
    #[serde(default)]
    pub release: Option<crate::server::ReleaseRef>,
}

/// `server.json` as the companion writes it.
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct ServerFile {
    pub v: u8,
    #[serde(default)]
    pub updated_at: i64,
    #[serde(default)]
    pub server: ServerInfo,
    #[serde(default)]
    pub manifest: Option<GistManifest>,
    /// Relative to BepInEx/config, forward slashes.
    #[serde(default)]
    pub configs: Vec<PublishConfig>,
    #[serde(default)]
    pub configs_skipped: Vec<String>,
    #[serde(default)]
    pub release: Option<ReleaseStatus>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Apply {
    pub when: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub at: Option<i64>,
}

/// `release.json` as the admin writes it. The companion handles each id once, so every publish gets a new one.
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseFile {
    pub v: u8,
    pub id: String,
    pub created_at: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    /// What the admin calls the release: the profile's name.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    pub mods: Vec<ManifestMod>,
    #[serde(default)]
    pub configs: Vec<PublishConfig>,
    pub apply: Apply,
}

/// `rel-<unix ms, base36>`
pub fn new_release_id() -> String {
    let mut n = now_ms().max(0) as u64;
    let mut digits = Vec::new();
    loop {
        digits.push(std::char::from_digit((n % 36) as u32, 36).unwrap());
        n /= 36;
        if n == 0 {
            break;
        }
    }
    format!("rel-{}", digits.iter().rev().collect::<String>())
}

/// sha256 over every config's path and content, hex; the second half of `ServerLink.last_adopted`.
pub fn config_hash(configs: &[PublishConfig]) -> String {
    let mut h = Sha256::new();
    for c in configs {
        h.update(c.path.as_bytes());
        h.update([0]);
        h.update(c.content_base64.as_bytes());
        h.update([0]);
    }
    h.finalize().iter().map(|b| format!("{b:02x}")).collect()
}

// ---- The mailbox ----

/// The gist as a set of files; HTTP sits behind this so the flow can be tested without the network.
pub(crate) trait Mailbox {
    async fn fetch(&self) -> Result<BTreeMap<String, String>>;
    async fn put(&self, name: &str, text: &str) -> Result<()>;
}

/// Per gist: the ETag of the last read and the files it carried, so a 304 costs no rate-limit budget.
pub type EtagCache = Arc<Mutex<HashMap<String, (String, BTreeMap<String, String>)>>>;

pub struct GistMailbox {
    client: reqwest::Client,
    api: String,
    gist_id: String,
    token: Option<String>,
    cache: EtagCache,
}

/// `VMM_GIST_API` points the client at a stand-in (the companion's fakegist.ts) instead of api.github.com.
pub fn api_base() -> String {
    std::env::var("VMM_GIST_API").ok().map(|s| s.trim().trim_end_matches('/').to_string()).filter(|s| !s.is_empty()).unwrap_or_else(|| GITHUB_API.to_string())
}

#[derive(Deserialize)]
struct GistFile {
    #[serde(default)]
    content: Option<String>,
    #[serde(default)]
    truncated: bool,
    #[serde(default)]
    raw_url: Option<String>,
}

#[derive(Deserialize)]
struct GistBody {
    #[serde(default)]
    files: BTreeMap<String, Option<GistFile>>,
}

/// GitHub's answer when a limit is used up: which bucket and when it resets. The gist write bucket
/// (`gist_update`) is 100 per hour per user, shared by the companion and the admin's Mod Manager.
fn rate_limited(res: &reqwest::Response) -> Option<String> {
    let h = |n: &str| res.headers().get(n).and_then(|v| v.to_str().ok()).map(String::from);
    if res.status() != reqwest::StatusCode::FORBIDDEN || h("x-ratelimit-remaining").as_deref() != Some("0") {
        return None;
    }
    let resource = h("x-ratelimit-resource").unwrap_or_else(|| "api".into());
    let limit = h("x-ratelimit-limit").unwrap_or_default();
    let reset = h("x-ratelimit-reset").and_then(|r| r.parse::<i64>().ok()).map(|r| ((r - now_ms() / 1000).max(0) + 59) / 60).unwrap_or(0);
    Some(format!("GitHub's {resource} limit ({limit} per hour per user) is used up; it resets in {reset} min."))
}

impl GistMailbox {
    pub fn new(client: reqwest::Client, gist_id: &str, token: Option<String>, cache: EtagCache) -> Self {
        let token = token.map(|t| t.trim().to_string()).filter(|t| !t.is_empty());
        Self { client, api: api_base(), gist_id: gist_id.to_string(), token, cache }
    }

    fn request(&self, method: reqwest::Method, url: &str) -> reqwest::RequestBuilder {
        let mut r = self
            .client
            .request(method, url)
            .header("Accept", "application/vnd.github+json")
            .header("X-GitHub-Api-Version", "2022-11-28")
            .header("User-Agent", concat!("valheim-mod-manager/", env!("CARGO_PKG_VERSION")));
        if let Some(t) = &self.token {
            r = r.bearer_auth(t);
        }
        r
    }
}

impl Mailbox for GistMailbox {
    async fn fetch(&self) -> Result<BTreeMap<String, String>> {
        let url = format!("{}/gists/{}", self.api, self.gist_id);
        let cached = self.cache.lock().unwrap().get(&self.gist_id).cloned();
        let mut req = self.request(reqwest::Method::GET, &url);
        if let Some((etag, _)) = &cached {
            req = req.header("If-None-Match", etag);
        }
        let res = req.send().await?;
        if res.status() == reqwest::StatusCode::NOT_MODIFIED {
            if let Some((_, files)) = cached {
                return Ok(files);
            }
        }
        if let Some(msg) = rate_limited(&res) {
            return Err(AppError::Network(msg));
        }
        if !res.status().is_success() {
            let hint = if res.status() == reqwest::StatusCode::NOT_FOUND { " (wrong sync code, or a private gist without a token)" } else { "" };
            return Err(AppError::Network(format!("gist {}: HTTP {}{hint}", self.gist_id, res.status())));
        }
        let etag = res.headers().get("etag").and_then(|v| v.to_str().ok()).map(String::from);
        let body: GistBody = res.json().await?;
        let mut files = BTreeMap::new();
        for (name, f) in body.files {
            let Some(f) = f else { continue };
            let text = match (f.truncated, f.raw_url) {
                // Files over 1 MB come back cut off; raw_url has the whole thing.
                (true, Some(raw)) => {
                    let r = self.request(reqwest::Method::GET, &raw).send().await?;
                    if !r.status().is_success() {
                        return Err(AppError::Network(format!("gist {}/{name}: raw HTTP {}", self.gist_id, r.status())));
                    }
                    r.text().await?
                }
                _ => f.content.unwrap_or_default(),
            };
            files.insert(name, text);
        }
        if let Some(etag) = etag {
            self.cache.lock().unwrap().insert(self.gist_id.clone(), (etag, files.clone()));
        }
        Ok(files)
    }

    async fn put(&self, name: &str, text: &str) -> Result<()> {
        if self.token.is_none() {
            return Err(AppError::Invalid("Publishing through the gist needs the gist token. Set it under Server → Link.".into()));
        }
        let url = format!("{}/gists/{}", self.api, self.gist_id);
        let body = serde_json::json!({ "files": { name: { "content": text } } });
        let res = self.request(reqwest::Method::PATCH, &url).json(&body).send().await?;
        if let Some(msg) = rate_limited(&res) {
            return Err(AppError::Network(msg));
        }
        if !res.status().is_success() {
            return Err(AppError::Network(format!("gist {}: PATCH HTTP {}", self.gist_id, res.status())));
        }
        // Our own write changed the gist-wide ETag; the next fetch sees everything again.
        self.cache.lock().unwrap().remove(&self.gist_id);
        Ok(())
    }
}

/// `server.json` decrypted, or None while the companion has not written one (placeholder `{}`).
pub(crate) async fn read_server<M: Mailbox>(m: &M, key: &Key) -> Result<Option<ServerFile>> {
    let files = m.fetch().await?;
    match files.get(SERVER_FILE) {
        Some(text) if is_envelope(text) => Ok(Some(open_json(key, SERVER_FILE, text)?)),
        _ => Ok(None),
    }
}

pub(crate) async fn publish_release<M: Mailbox>(m: &M, key: &Key, rel: &ReleaseFile) -> Result<()> {
    m.put(RELEASE_FILE, &seal_json(key, RELEASE_FILE, rel)?).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    const FIXTURE_CODE: &str = include_str!("../tests/fixtures/gist/sync-code.txt");
    const SERVER_SEALED: &str = include_str!("../tests/fixtures/gist/server.json.sealed");
    const SERVER_PLAIN: &str = include_str!("../tests/fixtures/gist/server.json.plain");
    const RELEASE_SEALED: &str = include_str!("../tests/fixtures/gist/release.json.sealed");
    const RELEASE_PLAIN: &str = include_str!("../tests/fixtures/gist/release.json.plain");

    fn hex(k: &Key) -> String {
        k.iter().map(|b| format!("{b:02x}")).collect()
    }
    fn fixture_key() -> Key {
        derive_key(&parse_sync_code(FIXTURE_CODE).unwrap().secret).unwrap()
    }

    #[test]
    fn sync_code_parsing() {
        let c = parse_sync_code("  vmm1.671708cb09dad340730fb73488dffd92.hfFxxz-YNqSSGnvFPdysxEi1aUHXD7KDQzFO9wSb238\n").unwrap();
        assert_eq!(c.gist_id, "671708cb09dad340730fb73488dffd92");
        assert_eq!(c.secret.len(), 43);
        let code = std::fs::read_to_string("tests/fixtures/gist/sync-code.txt").unwrap().trim().to_string();
        for text in [code.clone(), format!("http://127.0.0.1:9002/{code}"), format!("  {code}\n"), format!("Sync code: {code}."), format!("vmm1.broken {code}")]
        {
            assert_eq!(find_sync_code(&text).as_deref(), Some(code.as_str()), "{text}");
        }
        assert_eq!(find_sync_code("http://127.0.0.1:9002"), None);
        assert_eq!(find_sync_code("vmm1.5f2964a03b693a8655578dfdcbd4b6b6.tooshort"), None);
        for bad in [
            "vmm2.671708cb09dad340730fb73488dffd92.hfFxxz-YNqSSGnvFPdysxEi1aUHXD7KDQzFO9wSb238",
            "vmm1.ZZZ.x",
            "vmm1.671708cb09dad340730fb73488dffd92.short",
            "",
        ] {
            assert!(parse_sync_code(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn key_vectors_match_the_companion() {
        assert_eq!(
            hex(&derive_key("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA").unwrap()),
            "07c49509ba52d94805d55e48337efacccf1c69bb752024dd94238bdd60f9bbf3"
        );
        assert_eq!(hex(&fixture_key()), "60c0d8921085d5b0b5df62a35dc918d3545dfb065cc1f1334143caec66c06e58");
    }

    #[test]
    fn seal_open_round_trip_and_rejections() {
        let key = fixture_key();
        let env = seal(&key, SERVER_FILE, b"{\"hello\":1}").unwrap();
        assert_eq!(open(&key, SERVER_FILE, &env).unwrap(), b"{\"hello\":1}");
        assert_ne!(seal(&key, SERVER_FILE, b"x").unwrap().nonce, seal(&key, SERVER_FILE, b"x").unwrap().nonce);
        let other = derive_key("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA").unwrap();
        assert!(open(&other, SERVER_FILE, &env).is_err(), "wrong key");
        assert!(open(&key, RELEASE_FILE, &env).is_err(), "wrong file name");
        let mut tampered = env.clone();
        let mut bytes = STANDARD.decode(&tampered.data).unwrap();
        bytes[0] ^= 1;
        tampered.data = STANDARD.encode(bytes);
        assert!(open(&key, SERVER_FILE, &tampered).is_err(), "tampered");
        let mut comp = env.clone();
        comp.comp = Some("br".into());
        assert!(open(&key, SERVER_FILE, &comp).is_err(), "unknown compression");
        assert!(is_envelope(&serde_json::to_string(&env).unwrap()) && !is_envelope("{}") && !is_envelope("nope"));
    }

    #[test]
    fn both_fixtures_decrypt() {
        let key = fixture_key();
        let server: serde_json::Value = open_json(&key, SERVER_FILE, SERVER_SEALED).unwrap();
        assert_eq!(server, serde_json::from_str::<serde_json::Value>(SERVER_PLAIN).unwrap());
        let release: serde_json::Value = open_json(&key, RELEASE_FILE, RELEASE_SEALED).unwrap();
        assert_eq!(release, serde_json::from_str::<serde_json::Value>(RELEASE_PLAIN).unwrap());
        // And the typed shapes hold what the flow needs.
        let s: ServerFile = open_json(&key, SERVER_FILE, SERVER_SEALED).unwrap();
        assert!(s.manifest.as_ref().is_some_and(|m| !m.mods.is_empty() && !m.hash.is_empty()));
        assert!(!s.configs.is_empty() && s.release.is_some());
        let r: ReleaseFile = open_json(&key, RELEASE_FILE, RELEASE_SEALED).unwrap();
        assert_eq!((r.id.as_str(), r.apply.when.as_str(), r.mods.len()), ("rel-spike-1", "now", 7));
    }

    /// In-memory gist: what the companion would see after a publish, and placeholders are ignored.
    struct MemMailbox(RefCell<BTreeMap<String, String>>);
    impl Mailbox for MemMailbox {
        async fn fetch(&self) -> Result<BTreeMap<String, String>> {
            Ok(self.0.borrow().clone())
        }
        async fn put(&self, name: &str, text: &str) -> Result<()> {
            self.0.borrow_mut().insert(name.into(), text.into());
            Ok(())
        }
    }

    #[test]
    fn mailbox_flow_without_network() {
        let key = fixture_key();
        let m = MemMailbox(RefCell::new(BTreeMap::from([(SERVER_FILE.to_string(), "{}".to_string()), (RELEASE_FILE.to_string(), "{}".to_string())])));
        futures::executor::block_on(async {
            assert!(read_server(&m, &key).await.unwrap().is_none(), "placeholder is ignored");
            let rel = ReleaseFile {
                v: 1,
                id: new_release_id(),
                created_at: now_ms(),
                name: None,
                mods: vec![],
                apply: Apply { when: "idle".into(), at: None },
                ..Default::default()
            };
            publish_release(&m, &key, &rel).await.unwrap();
            let text = m.0.borrow()[RELEASE_FILE].clone();
            assert!(is_envelope(&text) && !text.contains("idle"), "sealed, not plaintext");
            let back: ReleaseFile = open_json(&key, RELEASE_FILE, &text).unwrap();
            assert_eq!(back.id, rel.id);
            assert!(back.id.starts_with("rel-"));
            m.put(SERVER_FILE, SERVER_SEALED).await.unwrap();
            assert!(read_server(&m, &key).await.unwrap().is_some());
        });
        assert_eq!(config_hash(&[]), config_hash(&[]));
        assert_ne!(config_hash(&[PublishConfig { path: "a".into(), content_base64: "x".into() }]), config_hash(&[]));
    }

    /// Against a real gist: `VMM_TEST_SYNC_CODE=vmm1.… cargo test -- --ignored reads_a_real_gist`
    /// (reading needs no token; `VMM_GIST_API` points at the fake gist instead).
    #[test]
    #[ignore]
    fn reads_a_real_gist() {
        let code = parse_sync_code(&std::env::var("VMM_TEST_SYNC_CODE").expect("VMM_TEST_SYNC_CODE")).unwrap();
        let key = derive_key(&code.secret).unwrap();
        let m = GistMailbox::new(reqwest::Client::new(), &code.gist_id, None, EtagCache::default());
        let rt = tokio::runtime::Runtime::new().unwrap();
        let s = rt.block_on(read_server(&m, &key)).unwrap().expect("server.json");
        println!(
            "server {:?} world {:?} mods {} configs {} release {:?}",
            s.server.name,
            s.server.world,
            s.manifest.as_ref().map_or(0, |m| m.mods.len()),
            s.configs.len(),
            s.release.as_ref().map(|r| (&r.id, &r.state))
        );
        // Second read goes through the ETag cache.
        let again = rt.block_on(read_server(&m, &key)).unwrap().expect("server.json (cached)");
        assert_eq!(again.updated_at, s.updated_at);
    }

    /// Publish end to end: a no-op release (the server's own lock, stage only) goes into the gist and
    /// the companion reports it back. `VMM_TEST_SYNC_CODE=… VMM_TEST_GIST_TOKEN=… cargo test -- --ignored publishes_to_a_real_gist`
    #[test]
    #[ignore]
    fn publishes_to_a_real_gist() {
        let code = parse_sync_code(&std::env::var("VMM_TEST_SYNC_CODE").expect("VMM_TEST_SYNC_CODE")).unwrap();
        let token = std::env::var("VMM_TEST_GIST_TOKEN").expect("VMM_TEST_GIST_TOKEN");
        let key = derive_key(&code.secret).unwrap();
        let m = GistMailbox::new(reqwest::Client::new(), &code.gist_id, Some(token), EtagCache::default());
        let rt = tokio::runtime::Runtime::new().unwrap();
        let before = rt.block_on(read_server(&m, &key)).unwrap().expect("server.json");
        let rel = ReleaseFile {
            v: 1,
            id: new_release_id(),
            created_at: now_ms(),
            name: None,
            message: Some("client spike: no-op, stage only".into()),
            mods: before.manifest.map(|m| m.mods).unwrap_or_default(),
            configs: vec![],
            apply: Apply { when: "none".into(), at: None },
        };
        rt.block_on(publish_release(&m, &key, &rel)).unwrap();
        println!("published {}", rel.id);
        for _ in 0..12 {
            std::thread::sleep(std::time::Duration::from_secs(10));
            let s = rt.block_on(read_server(&m, &key)).unwrap().expect("server.json");
            if let Some(r) = s.release.filter(|r| r.id == rel.id) {
                println!("companion answered: state {} plan {:?} problems {:?} error {:?}", r.state, r.plan, r.problems, r.error);
                assert!(matches!(r.state.as_str(), "staged" | "scheduled" | "applied"), "{}", r.state);
                return;
            }
        }
        panic!("the companion did not report {} within two minutes", rel.id);
    }
}
