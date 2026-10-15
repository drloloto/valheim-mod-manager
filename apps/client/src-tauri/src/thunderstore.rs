//! Thunderstore index: fetched once, compacted, kept in RAM (O(1) lookups) and on
//! disk. The frontend receives a pre-rendered slim JSON.
use crate::error::{AppError, Result};
use crate::models::{Pkg, Version};
use crate::resolver::canonical_id;
use crate::util::{now_ms, parse_full_name, write_atomic};
use futures::{StreamExt, TryStreamExt};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;
use std::sync::{Arc, Mutex, RwLock};
use std::time::{Duration, Instant};

/// The old full index. Marked deprecated in Thunderstore's Swagger since release 0.182.0; kept as the
/// fallback while it still answers.
pub const API_URL: &str = "https://thunderstore.io/c/valheim/api/v1/package/";
/// The successor: a 302 to a gzip blob listing gzip JSON chunks on the CDN, same package shape as v1.
pub const LISTING_INDEX_URL: &str = "https://thunderstore.io/c/valheim/api/v1/package-listing-index/";
const RETRY_BACKOFF: Duration = Duration::from_secs(5 * 60);
const CHUNK_PARALLEL: usize = 4;

pub fn download_url(ns: &str, name: &str, version: &str) -> String {
    format!("https://thunderstore.io/package/download/{ns}/{name}/{version}/")
}

const EXPERIMENTAL_API: &str = "https://thunderstore.io/api/experimental";

/// Readme or changelog of one package version, as Thunderstore serves it.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DocKind {
    Readme,
    Changelog,
}

impl DocKind {
    pub fn as_str(self) -> &'static str {
        match self {
            DocKind::Readme => "readme",
            DocKind::Changelog => "changelog",
        }
    }
}

pub fn doc_url(ns: &str, name: &str, version: &str, kind: DocKind) -> String {
    format!("{EXPERIMENTAL_API}/package/{ns}/{name}/{version}/{}/", kind.as_str())
}

pub fn wiki_url(ns: &str, name: &str) -> String {
    format!("{EXPERIMENTAL_API}/package/{ns}/{name}/wiki/")
}

pub fn wiki_page_url(page_id: &str) -> String {
    format!("{EXPERIMENTAL_API}/wiki/page/{page_id}/")
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct WikiPage {
    pub id: String,
    pub title: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Wiki {
    pub title: String,
    pub pages: Vec<WikiPage>,
}

/// Markdown of a readme or changelog; an empty string when the package has none.
pub async fn fetch_doc(client: &reqwest::Client, ns: &str, name: &str, version: &str, kind: DocKind) -> Result<String> {
    #[derive(Deserialize)]
    struct Body {
        markdown: Option<String>,
    }
    let res = client.get(doc_url(ns, name, version, kind)).send().await?;
    if res.status() == reqwest::StatusCode::NOT_FOUND {
        return Ok(String::new());
    }
    if !res.status().is_success() {
        return Err(AppError::Network(format!("Thunderstore responded with {}", res.status())));
    }
    Ok(res.json::<Body>().await?.markdown.unwrap_or_default())
}

/// The package's wiki index, `None` when it has no wiki.
pub async fn fetch_wiki(client: &reqwest::Client, ns: &str, name: &str) -> Result<Option<Wiki>> {
    let res = client.get(wiki_url(ns, name)).send().await?;
    if res.status() == reqwest::StatusCode::NOT_FOUND {
        return Ok(None);
    }
    if !res.status().is_success() {
        return Err(AppError::Network(format!("Thunderstore responded with {}", res.status())));
    }
    Ok(Some(res.json::<Wiki>().await?))
}

pub async fn fetch_wiki_page(client: &reqwest::Client, page_id: &str) -> Result<String> {
    #[derive(Deserialize)]
    struct Body {
        markdown_content: Option<String>,
    }
    if page_id.is_empty() || !page_id.chars().all(|c| c.is_ascii_digit()) {
        return Err(AppError::Invalid(format!("Invalid wiki page id \"{page_id}\".")));
    }
    let res = client.get(wiki_page_url(page_id)).send().await?;
    if !res.status().is_success() {
        return Err(AppError::Network(format!("Thunderstore responded with {}", res.status())));
    }
    Ok(res.json::<Body>().await?.markdown_content.unwrap_or_default())
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
    /// How many packages list this one as a dependency (latest versions only).
    ndependants: usize,
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
    /// Listing-index blob URL this index was built from (None for v1 or old caches).
    pub source: Option<String>,
    pub by_id: HashMap<String, Pkg>,
    pub slim_json: Vec<u8>,
}

pub fn build(fetched_at: i64, pkgs: Vec<Pkg>) -> Index {
    let mut dependants: HashMap<&str, usize> = HashMap::new();
    let dep_lists: Vec<Vec<String>> = pkgs.iter().map(|p| p.versions.first().map(|v| dep_ids(&v.deps)).unwrap_or_default()).collect();
    for ids in &dep_lists {
        for id in ids {
            *dependants.entry(id.as_str()).or_default() += 1;
        }
    }
    let slim = SlimPayload {
        fetched_at,
        packages: pkgs
            .iter()
            .zip(dep_lists.iter())
            .map(|(p, deps)| {
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
                    deps: deps.clone(),
                    ndependants: dependants.get(p.id.as_str()).copied().unwrap_or(0),
                }
            })
            .collect(),
    };
    let slim_json = serde_json::to_vec(&slim).expect("slim index is serializable");
    let by_id = pkgs.into_iter().map(|p| (p.id.clone(), p)).collect();
    Index { fetched_at, source: None, by_id, slim_json }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CacheRef<'a> {
    fetched_at: i64,
    source: &'a Option<String>,
    pkgs: &'a [Pkg],
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CacheOwned {
    fetched_at: i64,
    #[serde(default)]
    source: Option<String>,
    pkgs: Vec<Pkg>,
}

pub fn load_cache(path: &Path) -> Option<Index> {
    let bytes = std::fs::read(path).ok()?;
    let c: CacheOwned = serde_json::from_slice(&bytes).ok()?;
    let mut idx = build(c.fetched_at, c.pkgs);
    idx.source = c.source;
    Some(idx)
}

pub fn save_cache(path: &Path, fetched_at: i64, source: &Option<String>, pkgs: &[Pkg]) -> Result<()> {
    write_atomic(path, &serde_json::to_vec(&CacheRef { fetched_at, source, pkgs })?)
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

/// A freshly downloaded index and where it came from: the listing-index blob URL carries the content
/// hash, so the next refresh can skip the download when the redirect still points at the same blob.
pub struct Fetched {
    pub pkgs: Vec<Pkg>,
    pub source: Option<String>,
}

pub enum FetchOutcome {
    Changed(Fetched),
    Unchanged,
}

/// Listing index first, v1 as the fallback (logged, so a broken successor does not go unnoticed).
pub async fn fetch(client: &reqwest::Client, known_source: Option<&str>) -> Result<FetchOutcome> {
    match fetch_listing_index(client, known_source).await {
        Ok(outcome) => Ok(outcome),
        Err(e) => {
            eprintln!("package-listing-index failed ({e}); falling back to {API_URL}");
            Ok(FetchOutcome::Changed(Fetched { pkgs: fetch_v1(client).await?, source: None }))
        }
    }
}

async fn fetch_v1(client: &reqwest::Client) -> Result<Vec<Pkg>> {
    let bytes = get_bytes_retry(client, API_URL).await?;
    tokio::task::spawn_blocking(move || parse_raw(&bytes)).await.map_err(|e| AppError::Invalid(e.to_string()))?
}

/// Thunderstore's CDN has documented outages; one retry after a short pause covers the usual blip.
async fn get_bytes_retry(client: &reqwest::Client, url: &str) -> Result<Vec<u8>> {
    let mut last = AppError::Network(format!("{url}: no attempt"));
    for attempt in 0..2 {
        if attempt > 0 {
            tokio::time::sleep(Duration::from_secs(2)).await;
        }
        match client.get(url).send().await {
            Ok(res) if res.status().is_success() => match res.bytes().await {
                Ok(b) => return Ok(b.to_vec()),
                Err(e) => last = AppError::Network(format!("{url}: {e}")),
            },
            Ok(res) => last = AppError::Network(format!("{url}: HTTP {}", res.status())),
            Err(e) => last = AppError::Network(format!("{url}: {e}")),
        }
    }
    Err(last)
}

/// CDN blobs are gzip without a Content-Encoding header, so reqwest leaves them compressed.
pub fn maybe_gunzip(bytes: &[u8]) -> Result<Vec<u8>> {
    use std::io::Read;
    if !bytes.starts_with(&[0x1f, 0x8b]) {
        return Ok(bytes.to_vec());
    }
    let mut out = Vec::with_capacity(bytes.len() * 8);
    flate2::read::GzDecoder::new(bytes).read_to_end(&mut out)?;
    Ok(out)
}

async fn fetch_listing_index(client: &reqwest::Client, known_source: Option<&str>) -> Result<FetchOutcome> {
    // Resolve the redirect by hand: the target URL is the change detector.
    let probe = reqwest::Client::builder()
        .user_agent(concat!("valheim-modmanager/", env!("CARGO_PKG_VERSION")))
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(60))
        .build()?;
    let res = probe.get(LISTING_INDEX_URL).send().await?;
    let (blob_url, index_bytes) = if res.status().is_redirection() {
        let loc = res
            .headers()
            .get(reqwest::header::LOCATION)
            .and_then(|v| v.to_str().ok())
            .map(str::to_string)
            .ok_or_else(|| AppError::Network("listing index redirect without Location".into()))?;
        if known_source == Some(loc.as_str()) {
            return Ok(FetchOutcome::Unchanged);
        }
        let bytes = get_bytes_retry(client, &loc).await?;
        (Some(loc), bytes)
    } else if res.status().is_success() {
        (None, res.bytes().await?.to_vec())
    } else {
        return Err(AppError::Network(format!("listing index responded with {}", res.status())));
    };
    let urls: Vec<String> = serde_json::from_slice(&maybe_gunzip(&index_bytes)?)?;
    if urls.is_empty() {
        return Err(AppError::Network("listing index has no chunks".into()));
    }
    // Owned captures only: a borrowed async closure here is not `Send` enough for the index worker.
    let chunks: Vec<Vec<Pkg>> = futures::stream::iter(urls.into_iter().map(|u| {
        let client = client.clone();
        async move {
            let bytes = get_bytes_retry(&client, &u).await?;
            tokio::task::spawn_blocking(move || parse_raw(&maybe_gunzip(&bytes)?)).await.map_err(|e| AppError::Invalid(e.to_string()))?
        }
    }))
    .buffered(CHUNK_PARALLEL)
    .try_collect()
    .await?;
    let pkgs = merge_chunks(chunks);
    if pkgs.is_empty() {
        return Err(AppError::Network("listing index chunks were empty".into()));
    }
    Ok(FetchOutcome::Changed(Fetched { pkgs, source: blob_url }))
}

/// Concatenates chunks in index order; a package listed twice (chunk boundary during an upload) keeps
/// its first occurrence.
pub fn merge_chunks(chunks: Vec<Vec<Pkg>>) -> Vec<Pkg> {
    let mut seen = std::collections::HashSet::new();
    chunks.into_iter().flatten().filter(|p| seen.insert(p.id.clone())).collect()
}

pub struct IndexStore {
    current: RwLock<Option<Arc<Index>>>,
    refresh_lock: tokio::sync::Mutex<()>,
    last_failure: Mutex<Option<Instant>>,
    /// Last time the listing index was probed and found unchanged; the worker treats that like a refresh.
    last_check: Mutex<Option<Instant>>,
}

impl Default for IndexStore {
    fn default() -> Self {
        Self::new()
    }
}

impl IndexStore {
    pub fn new() -> Self {
        IndexStore { current: RwLock::new(None), refresh_lock: tokio::sync::Mutex::new(()), last_failure: Mutex::new(None), last_check: Mutex::new(None) }
    }

    /// Milliseconds since the index was fetched or last confirmed unchanged.
    pub fn staleness_ms(&self) -> Option<i64> {
        let age = self.age_ms()?;
        let checked = self.last_check.lock().unwrap().map(|t| t.elapsed().as_millis() as i64);
        Some(checked.map_or(age, |c| c.min(age)))
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
    let known = store.get().and_then(|i| i.source.clone());
    match fetch(client, if force { None } else { known.as_deref() }).await {
        Ok(FetchOutcome::Unchanged) => {
            *store.last_check.lock().unwrap() = Some(Instant::now());
            *store.last_failure.lock().unwrap() = None;
            Ok(false)
        }
        Ok(FetchOutcome::Changed(Fetched { pkgs, source })) => {
            let at = now_ms();
            let cache = cache.to_path_buf();
            let idx = tokio::task::spawn_blocking(move || {
                let _ = save_cache(&cache, at, &source, &pkgs);
                let mut idx = build(at, pkgs);
                idx.source = source;
                idx
            })
            .await
            .map_err(|e| AppError::Invalid(e.to_string()))?;
            store.set(idx);
            *store.last_check.lock().unwrap() = Some(Instant::now());
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

    #[test]
    fn slim_index_counts_dependants() {
        let pkgs = vec![
            crate::models::test_pkg("a-Lib", &[("1.0.0", &[])]),
            crate::models::test_pkg("b-One", &[("1.0.0", &["a-Lib-1.0.0"])]),
            crate::models::test_pkg("c-Two", &[("2.0.0", &["a-Lib-0.9.0", "b-One-1.0.0"]), ("1.0.0", &["a-Lib-0.9.0"])]),
        ];
        let idx = build(1, pkgs);
        let slim: serde_json::Value = serde_json::from_slice(&idx.slim_json).unwrap();
        let by: std::collections::HashMap<&str, u64> =
            slim["packages"].as_array().unwrap().iter().map(|p| (p["id"].as_str().unwrap(), p["ndependants"].as_u64().unwrap())).collect();
        assert_eq!((by["a-Lib"], by["b-One"], by["c-Two"]), (2, 1, 0));
    }

    #[test]
    fn gunzip_is_transparent_and_chunks_merge_in_order() {
        use std::io::Write;
        let mut enc = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::fast());
        enc.write_all(RAW.as_bytes()).unwrap();
        let gz = enc.finish().unwrap();
        assert_eq!(maybe_gunzip(&gz).unwrap(), RAW.as_bytes());
        assert_eq!(maybe_gunzip(b"[]").unwrap(), b"[]");
        let a = parse_raw(RAW.as_bytes()).unwrap();
        let b = parse_raw(RAW.as_bytes()).unwrap();
        let merged = merge_chunks(vec![a.clone(), b]);
        assert_eq!(merged.len(), a.len(), "duplicates across chunks collapse");
        assert_eq!(merged[0].id, a[0].id);
    }

    #[test]
    fn cache_round_trips_the_source() {
        let d = tempfile::tempdir().unwrap();
        let path = d.path().join("index.json");
        let pkgs = parse_raw(RAW.as_bytes()).unwrap();
        save_cache(&path, 5, &Some("https://cdn/blob".into()), &pkgs).unwrap();
        let idx = load_cache(&path).unwrap();
        assert_eq!((idx.fetched_at, idx.source.as_deref()), (5, Some("https://cdn/blob")));
        // Old caches without a source still load.
        std::fs::write(&path, br#"{"fetchedAt":1,"pkgs":[]}"#).unwrap();
        assert_eq!(load_cache(&path).unwrap().source, None);
    }

    /// Network: `cargo test listing_index -- --ignored`. Downloads the real Valheim index both ways.
    #[tokio::test]
    #[ignore]
    async fn listing_index_matches_v1_in_size_and_detects_unchanged() {
        let client = http_client(Duration::from_secs(15), Duration::from_secs(60)).unwrap();
        let FetchOutcome::Changed(first) = fetch_listing_index(&client, None).await.unwrap() else { panic!("expected a download") };
        assert!(first.pkgs.len() > 10_000, "got {} packages", first.pkgs.len());
        assert!(first.source.as_deref().is_some_and(|s| s.contains("blob")));
        assert!(matches!(fetch_listing_index(&client, first.source.as_deref()).await.unwrap(), FetchOutcome::Unchanged));
        let v1 = fetch_v1(&client).await.unwrap();
        let diff = (v1.len() as i64 - first.pkgs.len() as i64).abs();
        assert!(diff < 50, "v1 {} vs listing {}", v1.len(), first.pkgs.len());
        assert!(first.pkgs.iter().any(|p| p.id == "ValheimModding-Jotunn"));
    }

    #[test]
    fn doc_urls_follow_the_experimental_api() {
        assert_eq!(
            doc_url("ValheimModding", "Jotunn", "2.26.0", DocKind::Readme),
            "https://thunderstore.io/api/experimental/package/ValheimModding/Jotunn/2.26.0/readme/"
        );
        assert_eq!(
            doc_url("ValheimModding", "Jotunn", "2.26.0", DocKind::Changelog),
            "https://thunderstore.io/api/experimental/package/ValheimModding/Jotunn/2.26.0/changelog/"
        );
        assert_eq!(wiki_url("ValheimModding", "Jotunn"), "https://thunderstore.io/api/experimental/package/ValheimModding/Jotunn/wiki/");
        assert_eq!(wiki_page_url("417"), "https://thunderstore.io/api/experimental/wiki/page/417/");
        assert_eq!(serde_json::to_string(&DocKind::Readme).unwrap(), "\"readme\"");
    }

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
        save_cache(&cache, 1000, &None, &pkgs).unwrap();
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
