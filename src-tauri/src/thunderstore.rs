//! Thunderstore index: fetched once, compacted, kept in RAM (O(1) lookups) and on
//! disk. The frontend receives a pre-rendered slim JSON.
use crate::error::{AppError, Result};
use crate::models::{Pkg, Version};
use crate::resolver::canonical_id;
use crate::util::{now_ms, parse_full_name, write_atomic};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;
use std::sync::{Arc, Mutex, RwLock};
use std::time::{Duration, Instant};

pub const API_URL: &str = "https://thunderstore.io/c/valheim/api/v1/package/";
const RETRY_BACKOFF: Duration = Duration::from_secs(5 * 60);

pub fn download_url(ns: &str, name: &str, version: &str) -> String {
    format!("https://thunderstore.io/package/download/{ns}/{name}/{version}/")
}

#[derive(Deserialize)]
struct RawPkg {
    owner: String,
    name: String,
    #[serde(default)]
    package_url: Option<String>,
    #[serde(default)]
    date_created: Option<String>,
    #[serde(default)]
    date_updated: Option<String>,
    #[serde(default)]
    rating_score: i64,
    #[serde(default)]
    is_pinned: bool,
    #[serde(default)]
    is_deprecated: bool,
    #[serde(default)]
    has_nsfw_content: bool,
    #[serde(default)]
    categories: Vec<String>,
    #[serde(default)]
    versions: Vec<RawVersion>,
}

#[derive(Deserialize)]
struct RawVersion {
    version_number: String,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    icon: Option<String>,
    #[serde(default)]
    dependencies: Vec<String>,
    #[serde(default)]
    downloads: u64,
    #[serde(default)]
    file_size: u64,
    #[serde(default)]
    date_created: Option<String>,
    #[serde(default)]
    website_url: Option<String>,
}

fn parse_date(s: &Option<String>) -> i64 {
    s.as_deref().and_then(|d| chrono::DateTime::parse_from_rfc3339(d).ok()).map(|d| d.timestamp_millis()).unwrap_or(0)
}

pub fn parse_raw(bytes: &[u8]) -> Result<Vec<Pkg>> {
    let raw: Vec<RawPkg> = serde_json::from_slice(bytes)?;
    Ok(raw
        .into_iter()
        .map(|p| {
            let latest = p.versions.first();
            Pkg {
                id: format!("{}-{}", p.owner, p.name),
                desc: latest.and_then(|v| v.description.clone()).unwrap_or_default(),
                icon: latest.and_then(|v| v.icon.clone()).unwrap_or_default(),
                web: latest.and_then(|v| v.website_url.clone()).unwrap_or_default(),
                dl: p.versions.iter().map(|v| v.downloads).sum(),
                upd: parse_date(&p.date_updated),
                created: parse_date(&p.date_created),
                cats: p.categories,
                rating: p.rating_score,
                dep: p.is_deprecated,
                nsfw: p.has_nsfw_content,
                pinned: p.is_pinned,
                url: p.package_url.unwrap_or_default(),
                versions: p
                    .versions
                    .iter()
                    .map(|v| Version { v: v.version_number.clone(), deps: v.dependencies.clone(), size: v.file_size, date: parse_date(&v.date_created) })
                    .collect(),
                ns: p.owner,
                name: p.name,
            }
        })
        .collect())
}

#[derive(Serialize)]
struct SlimPkg<'a> {
    id: &'a str,
    ns: &'a str,
    name: &'a str,
    desc: &'a str,
    icon: &'a str,
    ver: &'a str,
    cats: &'a [String],
    rating: i64,
    dl: u64,
    upd: i64,
    dep: bool,
    nsfw: bool,
    pinned: bool,
    ndeps: usize,
    size: u64,
    created: i64,
    nver: usize,
    /// Dependency IDs of the latest version, without version, BepInExPack canonicalized.
    deps: Vec<String>,
}

fn dep_ids(deps: &[String]) -> Vec<String> {
    let mut out: Vec<String> = Vec::with_capacity(deps.len());
    for d in deps {
        if let Some(f) = parse_full_name(d) {
            let id = canonical_id(&f.ns, &f.name);
            if !out.contains(&id) {
                out.push(id);
            }
        }
    }
    out
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SlimPayload<'a> {
    fetched_at: i64,
    packages: Vec<SlimPkg<'a>>,
}

pub struct Index {
    pub fetched_at: i64,
    pub by_id: HashMap<String, Pkg>,
    pub slim_json: Vec<u8>,
}

pub fn build(fetched_at: i64, pkgs: Vec<Pkg>) -> Index {
    let slim = SlimPayload {
        fetched_at,
        packages: pkgs
            .iter()
            .map(|p| {
                let latest = p.versions.first();
                SlimPkg {
                    id: &p.id,
                    ns: &p.ns,
                    name: &p.name,
                    desc: &p.desc,
                    icon: &p.icon,
                    ver: latest.map(|v| v.v.as_str()).unwrap_or(""),
                    cats: &p.cats,
                    rating: p.rating,
                    dl: p.dl,
                    upd: p.upd,
                    dep: p.dep,
                    nsfw: p.nsfw,
                    pinned: p.pinned,
                    ndeps: latest.map(|v| v.deps.len()).unwrap_or(0),
                    size: latest.map(|v| v.size).unwrap_or(0),
                    created: p.created,
                    nver: p.versions.len(),
                    deps: latest.map(|v| dep_ids(&v.deps)).unwrap_or_default(),
                }
            })
            .collect(),
    };
    let slim_json = serde_json::to_vec(&slim).expect("slim index is serializable");
    let by_id = pkgs.into_iter().map(|p| (p.id.clone(), p)).collect();
    Index { fetched_at, by_id, slim_json }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CacheRef<'a> {
    fetched_at: i64,
    pkgs: &'a [Pkg],
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CacheOwned {
    fetched_at: i64,
    pkgs: Vec<Pkg>,
}

pub fn load_cache(path: &Path) -> Option<Index> {
    let bytes = std::fs::read(path).ok()?;
    let c: CacheOwned = serde_json::from_slice(&bytes).ok()?;
    Some(build(c.fetched_at, c.pkgs))
}

pub fn save_cache(path: &Path, fetched_at: i64, pkgs: &[Pkg]) -> Result<()> {
    write_atomic(path, &serde_json::to_vec(&CacheRef { fetched_at, pkgs })?)
}

/// The app's HTTP client. The timeouts keep a stalled connection from blocking the
/// sync (and thus "Play") forever; the read timeout applies per read, so large
/// downloads still work.
pub fn http_client(connect_timeout: Duration, read_timeout: Duration) -> Result<reqwest::Client> {
    Ok(reqwest::Client::builder()
        .user_agent(concat!("valheim-modmanager/", env!("CARGO_PKG_VERSION")))
        .connect_timeout(connect_timeout)
        .read_timeout(read_timeout)
        .build()?)
}

pub async fn fetch(client: &reqwest::Client) -> Result<Vec<Pkg>> {
    let res = client.get(API_URL).send().await?;
    if !res.status().is_success() {
        return Err(AppError::Network(format!("Thunderstore API responded with {}", res.status())));
    }
    let bytes = res.bytes().await?;
    tokio::task::spawn_blocking(move || parse_raw(&bytes)).await.map_err(|e| AppError::Invalid(e.to_string()))?
}

pub struct IndexStore {
    current: RwLock<Option<Arc<Index>>>,
    refresh_lock: tokio::sync::Mutex<()>,
    last_failure: Mutex<Option<Instant>>,
}

impl Default for IndexStore {
    fn default() -> Self {
        Self::new()
    }
}

impl IndexStore {
    pub fn new() -> Self {
        IndexStore { current: RwLock::new(None), refresh_lock: tokio::sync::Mutex::new(()), last_failure: Mutex::new(None) }
    }

    pub fn get(&self) -> Option<Arc<Index>> {
        self.current.read().unwrap().clone()
    }

    pub fn set(&self, idx: Index) {
        *self.current.write().unwrap() = Some(Arc::new(idx));
    }

    pub fn age_ms(&self) -> Option<i64> {
        self.get().map(|i| now_ms() - i.fetched_at)
    }
}

/// Re-fetches the index. Without `force`, a failure pauses retries for 5 minutes
/// as long as an (old) index is still available.
pub async fn refresh(store: &IndexStore, client: &reqwest::Client, cache: &Path, force: bool) -> Result<bool> {
    let _guard = store.refresh_lock.lock().await;
    if !force && store.get().is_some() {
        if let Some(t) = *store.last_failure.lock().unwrap() {
            if t.elapsed() < RETRY_BACKOFF {
                return Ok(false);
            }
        }
    }
    match fetch(client).await {
        Ok(pkgs) => {
            let at = now_ms();
            let cache = cache.to_path_buf();
            let idx = tokio::task::spawn_blocking(move || {
                let _ = save_cache(&cache, at, &pkgs);
                build(at, pkgs)
            })
            .await
            .map_err(|e| AppError::Invalid(e.to_string()))?;
            store.set(idx);
            *store.last_failure.lock().unwrap() = None;
            Ok(true)
        }
        Err(e) => {
            *store.last_failure.lock().unwrap() = Some(Instant::now());
            Err(e)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const RAW: &str = r#"[{
        "owner": "denikson", "name": "BepInExPack_Valheim", "package_url": "https://thunderstore.io/p",
        "date_created": "2021-02-02T00:00:00.000000Z", "date_updated": "2025-01-01T12:00:00Z",
        "rating_score": 42, "is_pinned": true, "is_deprecated": false, "has_nsfw_content": false,
        "categories": ["Libraries"], "unknown_field": 1,
        "versions": [
          {"version_number": "5.4.2351", "description": "BepInEx", "icon": "i.png", "dependencies": [],
           "downloads": 10, "file_size": 123, "date_created": "2025-01-01T12:00:00Z", "website_url": "https://x"},
          {"version_number": "5.4.2333", "description": "alt", "icon": "", "dependencies": ["a-B-1.0.0"],
           "downloads": 5, "file_size": 100, "date_created": "2024-01-01T00:00:00Z", "website_url": ""}
        ]}]"#;

    #[test]
    fn compacts_raw_api_json() {
        let pkgs = parse_raw(RAW.as_bytes()).unwrap();
        let p = &pkgs[0];
        assert_eq!(p.id, "denikson-BepInExPack_Valheim");
        assert_eq!(p.dl, 15);
        assert_eq!(p.rating, 42);
        assert_eq!(p.desc, "BepInEx");
        assert_eq!(p.web, "https://x");
        assert_eq!(p.upd, 1735732800000);
        assert_eq!(p.versions[1].deps, vec!["a-B-1.0.0"]);
        assert!(p.pinned);
    }

    #[test]
    fn builds_slim_payload_and_roundtrips_cache() {
        let pkgs = parse_raw(RAW.as_bytes()).unwrap();
        let idx = build(1000, pkgs.clone());
        let slim: serde_json::Value = serde_json::from_slice(&idx.slim_json).unwrap();
        assert_eq!(slim["fetchedAt"], 1000);
        assert_eq!(slim["packages"][0]["ver"], "5.4.2351");
        assert_eq!(slim["packages"][0]["size"], 123);
        assert_eq!(slim["packages"][0]["created"], 1612224000000i64);
        assert_eq!(slim["packages"][0]["nver"], 2);
        assert_eq!(slim["packages"][0]["deps"], serde_json::json!([]));
        assert_eq!(dep_ids(&["a-B-1.0.0".into(), "x-BepInExPack_Foo-1.0.0".into(), "a-B-2.0.0".into()]), vec!["a-B", "denikson-BepInExPack_Valheim"]);
        assert!(slim["packages"][0].get("versions").is_none());

        let dir = tempfile::tempdir().unwrap();
        let cache = dir.path().join("cache").join("index.json");
        assert!(load_cache(&cache).is_none());
        save_cache(&cache, 1000, &pkgs).unwrap();
        let loaded = load_cache(&cache).unwrap();
        assert_eq!(loaded.fetched_at, 1000);
        assert_eq!(loaded.by_id["denikson-BepInExPack_Valheim"], pkgs[0]);
    }

    /// A server that accepts connections but never answers must not block the app.
    #[tokio::test]
    async fn client_gives_up_on_stalled_server() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        std::thread::spawn(move || {
            let _held: Vec<_> = listener.incoming().take(1).collect();
            std::thread::sleep(Duration::from_secs(30));
        });
        let client = http_client(Duration::from_millis(500), Duration::from_millis(500)).unwrap();
        let res = tokio::time::timeout(Duration::from_secs(5), client.get(format!("http://{addr}/")).send()).await;
        assert!(matches!(res, Ok(Err(_))), "request must end with a timeout error, not hang");
    }

    #[test]
    fn store_reports_age() {
        let s = IndexStore::new();
        assert!(s.get().is_none() && s.age_ms().is_none());
        s.set(build(crate::util::now_ms() - 5_000, vec![]));
        assert!(s.age_ms().unwrap() >= 5_000);
    }
}
