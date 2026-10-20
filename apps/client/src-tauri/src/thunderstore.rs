//! Thunderstore index: fetched once, compacted, kept in RAM (O(1) lookups) and on
//! disk. The frontend receives a pre-rendered slim JSON.
use crate::error::{AppError, Result};
use crate::models::{Pkg, Store, Version};
use crate::resolver::canonical_id;
use crate::util::{cmp_version, now_ms, parse_full_name, write_atomic};
use futures::{StreamExt, TryStreamExt};
use serde::{Deserialize, Serialize};
use std::cmp::Ordering;
use std::collections::HashMap;
use std::path::Path;
use std::sync::{Arc, Mutex, RwLock};
use std::time::{Duration, Instant};

const RETRY_BACKOFF: Duration = Duration::from_secs(5 * 60);
const CHUNK_PARALLEL: usize = 4;

impl Store {
    fn host(self) -> &'static str {
        match self {
            Store::Thunderstore => "https://thunderstore.io/c/valheim",
            Store::Hexium => "https://valheim.hexium.gg",
        }
    }

    /// The old full index. Marked deprecated in Thunderstore's Swagger since release 0.182.0; kept as the
    /// fallback while it still answers. Hexium serves the same shape.
    pub fn v1_url(self) -> String {
        format!("{}/api/v1/package/", self.host())
    }

    /// The successor: a 302 to a gzip blob listing gzip JSON chunks on the CDN, same package shape as v1.
    /// Hexium answers the index directly (no redirect), so its change detector is the chunk list itself.
    pub fn listing_index_url(self) -> String {
        format!("{}/api/v1/package-listing-index/", self.host())
    }
}

pub fn download_url(ns: &str, name: &str, version: &str) -> String {
    format!("https://thunderstore.io/package/download/{ns}/{name}/{version}/")
}

/// The URL a release is downloaded from: as the store listed it (Hexium), else derived from the id
/// (Thunderstore). An unknown version falls back to Thunderstore's pattern, as before.
pub fn download_url_of(pkg: &Pkg, version: &str) -> String {
    match pkg.versions.iter().find(|v| v.v == version) {
        Some(v) if !v.dl.is_empty() => v.dl.clone(),
        _ => download_url(&pkg.ns, &pkg.name, version),
    }
}

/// Hexium names the audience categories differently; the browse filters and the server dialog know
/// Thunderstore's names, so Hexium's are mapped onto them.
pub fn normalize_category(store: Store, cat: &str) -> Vec<String> {
    let names: &[&str] = match (store, cat) {
        (Store::Thunderstore, c) => &[c],
        (Store::Hexium, "Client-only") => &["Client-side"],
        (Store::Hexium, "Server-only") => &["Server-side"],
        (Store::Hexium, "Client & Server" | "Client (& Server)") => &["Client-side", "Server-side"],
        (Store::Hexium, "Modpack") => &["Modpacks"],
        (Store::Hexium, "Npc") => &["NPCs"],
        (Store::Hexium, c) => &[c],
    };
    names.iter().map(|s| s.to_string()).collect()
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
    #[serde(default)]
    download_url: Option<String>,
}

fn parse_date(s: &Option<String>) -> i64 {
    s.as_deref().and_then(|d| chrono::DateTime::parse_from_rfc3339(d).ok()).map(|d| d.timestamp_millis()).unwrap_or(0)
}

#[cfg(test)]
pub fn parse_raw(bytes: &[u8]) -> Result<Vec<Pkg>> {
    parse_raw_from(bytes, Store::Thunderstore)
}

/// A store's v1 package list (or one listing chunk) as packages of that store.
pub fn parse_raw_from(bytes: &[u8], store: Store) -> Result<Vec<Pkg>> {
    let raw: Vec<RawPkg> = serde_json::from_slice(bytes)?;
    Ok(raw
        .into_iter()
        .map(|p| {
            let latest = p.versions.first();
            let mut cats: Vec<String> = vec![];
            for c in &p.categories {
                for n in normalize_category(store, c) {
                    if !cats.contains(&n) {
                        cats.push(n);
                    }
                }
            }
            let page = p.package_url.unwrap_or_default();
            let (url, hx_url) = match store {
                Store::Thunderstore => (page, String::new()),
                Store::Hexium => (String::new(), page),
            };
            Pkg {
                id: format!("{}-{}", p.owner, p.name),
                desc: latest.and_then(|v| v.description.clone()).unwrap_or_default(),
                icon: latest.and_then(|v| v.icon.clone()).unwrap_or_default(),
                web: latest.and_then(|v| v.website_url.clone()).unwrap_or_default(),
                dl: p.versions.iter().map(|v| v.downloads).sum(),
                upd: parse_date(&p.date_updated),
                created: parse_date(&p.date_created),
                cats,
                rating: p.rating_score,
                dep: p.is_deprecated,
                nsfw: p.has_nsfw_content,
                pinned: p.is_pinned,
                url,
                hx_url,
                stores: vec![store],
                versions: p
                    .versions
                    .iter()
                    .map(|v| Version {
                        v: v.version_number.clone(),
                        deps: v.dependencies.clone(),
                        size: v.file_size,
                        date: parse_date(&v.date_created),
                        src: store,
                        dl: if store == Store::Hexium { v.download_url.clone().unwrap_or_default() } else { String::new() },
                    })
                    .collect(),
                ns: p.owner,
                name: p.name,
            }
        })
        .collect())
}

/// The package lists per store, as fetched; the index is built from their merge.
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Parts {
    pub thunderstore: Vec<Pkg>,
    pub hexium: Vec<Pkg>,
}

impl Parts {
    pub fn thunderstore(pkgs: Vec<Pkg>) -> Self {
        Parts { thunderstore: pkgs, hexium: vec![] }
    }
}

/// One package per id. A package both stores list keeps Thunderstore's listing and gains the versions only
/// Hexium has (newest first again), Hexium's page and categories; counts take the larger value, and the
/// description follows the newer release. A release on both stores is downloaded from Thunderstore.
pub fn merge(parts: &Parts) -> Vec<Pkg> {
    let mut out: Vec<Pkg> = parts.thunderstore.clone();
    let mut at: HashMap<String, usize> = out.iter().enumerate().map(|(i, p)| (p.id.clone(), i)).collect();
    for h in &parts.hexium {
        let Some(&i) = at.get(&h.id) else {
            at.insert(h.id.clone(), out.len());
            out.push(h.clone());
            continue;
        };
        let p = &mut out[i];
        if !p.stores.contains(&Store::Hexium) {
            p.stores.push(Store::Hexium);
        }
        p.hx_url = h.hx_url.clone();
        for c in &h.cats {
            if !p.cats.contains(c) {
                p.cats.push(c.clone());
            }
        }
        p.dl = p.dl.max(h.dl);
        p.rating = p.rating.max(h.rating);
        p.upd = p.upd.max(h.upd);
        if p.created == 0 || (h.created > 0 && h.created < p.created) {
            p.created = h.created;
        }
        p.nsfw |= h.nsfw;
        let order = h.versions.first().zip(p.versions.first()).map(|(hv, pv)| cmp_version(&hv.v, &pv.v));
        let newer = order == Some(Ordering::Greater);
        // Deprecation follows the store with the newer release: a maintainer who moved to Hexium deprecates
        // the Thunderstore listing and keeps publishing. On a tie, both stores have to say so.
        p.dep = match order {
            Some(Ordering::Greater) => h.dep,
            Some(Ordering::Less) => p.dep,
            _ => p.dep && h.dep,
        };
        let mut added = false;
        for v in &h.versions {
            if !p.versions.iter().any(|x| x.v == v.v) {
                p.versions.push(v.clone());
                added = true;
            }
        }
        if added {
            p.versions.sort_by(|a, b| cmp_version(&b.v, &a.v));
        }
        if newer {
            p.desc = h.desc.clone();
            p.icon = h.icon.clone();
            if p.web.is_empty() {
                p.web = h.web.clone();
            }
        }
    }
    out
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
    /// Which stores list the package.
    stores: &'a [Store],
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

/// Where each part of the index came from: the listing-index blob URL per store (None for v1 or old
/// caches), the change detector of the next refresh.
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct IndexSource {
    pub thunderstore: Option<String>,
    pub hexium: Option<String>,
}

pub struct Index {
    pub fetched_at: i64,
    pub source: IndexSource,
    /// The lists per store, kept so a refresh that finds one store unchanged reuses its list.
    pub parts: Parts,
    pub by_id: HashMap<String, Pkg>,
    pub slim_json: Vec<u8>,
}

impl Index {
    /// True while Hexium's list was never merged in: a cache from before the second store, or a Hexium fetch
    /// that never succeeded. With Hexium on, such an index is refreshed regardless of its age.
    pub fn lacks_hexium(&self) -> bool {
        self.parts.hexium.is_empty() && self.source.hexium.is_none()
    }
}

pub fn build(fetched_at: i64, parts: Parts) -> Index {
    let pkgs = merge(&parts);
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
                    stores: &p.stores,
                }
            })
            .collect(),
    };
    let slim_json = serde_json::to_vec(&slim).expect("slim index is serializable");
    let by_id = pkgs.into_iter().map(|p| (p.id.clone(), p)).collect();
    Index { fetched_at, source: IndexSource::default(), parts, by_id, slim_json }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CacheRef<'a> {
    fetched_at: i64,
    source: &'a IndexSource,
    parts: &'a Parts,
}

/// Caches from before Hexium hold one list (`pkgs`) and one blob URL as a string.
#[derive(Deserialize)]
#[serde(untagged)]
enum CacheSource {
    Old(Option<String>),
    New(IndexSource),
}

impl Default for CacheSource {
    fn default() -> Self {
        CacheSource::Old(None)
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CacheOwned {
    fetched_at: i64,
    #[serde(default)]
    source: CacheSource,
    #[serde(default)]
    parts: Parts,
    #[serde(default)]
    pkgs: Vec<Pkg>,
}

pub fn load_cache(path: &Path) -> Option<Index> {
    let bytes = std::fs::read(path).ok()?;
    let c: CacheOwned = serde_json::from_slice(&bytes).ok()?;
    let (source, parts) = match c.source {
        CacheSource::New(s) => (s, c.parts),
        CacheSource::Old(url) => (IndexSource { thunderstore: url, hexium: None }, if c.pkgs.is_empty() { c.parts } else { Parts::thunderstore(c.pkgs) }),
    };
    let mut idx = build(c.fetched_at, parts);
    idx.source = source;
    Some(idx)
}

pub fn save_cache(path: &Path, fetched_at: i64, source: &IndexSource, parts: &Parts) -> Result<()> {
    write_atomic(path, &serde_json::to_vec(&CacheRef { fetched_at, source, parts })?)
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
pub async fn fetch(client: &reqwest::Client, store: Store, known_source: Option<&str>) -> Result<FetchOutcome> {
    match fetch_listing_index(client, store, known_source).await {
        Ok(outcome) => Ok(outcome),
        Err(e) => {
            eprintln!("{store:?} package-listing-index failed ({e}); falling back to {}", store.v1_url());
            Ok(FetchOutcome::Changed(Fetched { pkgs: fetch_v1(client, store).await?, source: None }))
        }
    }
}

async fn fetch_v1(client: &reqwest::Client, store: Store) -> Result<Vec<Pkg>> {
    let bytes = get_bytes_retry(client, &store.v1_url()).await?;
    tokio::task::spawn_blocking(move || parse_raw_from(&bytes, store)).await.map_err(|e| AppError::Invalid(e.to_string()))?
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

async fn fetch_listing_index(client: &reqwest::Client, store: Store, known_source: Option<&str>) -> Result<FetchOutcome> {
    // Resolve the redirect by hand: the target URL is the change detector.
    let probe = reqwest::Client::builder()
        .user_agent(concat!("valheim-modmanager/", env!("CARGO_PKG_VERSION")))
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(60))
        .build()?;
    let res = probe.get(store.listing_index_url()).send().await?;
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
            tokio::task::spawn_blocking(move || parse_raw_from(&maybe_gunzip(&bytes)?, store)).await.map_err(|e| AppError::Invalid(e.to_string()))?
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

/// Re-fetches the index: Thunderstore, and Hexium when `hexium` is on. Without `force`, a failure pauses
/// retries for 5 minutes as long as an (old) index is still available. Thunderstore failing is the error
/// it always was; Hexium failing keeps its last list (or goes without it), logged, so the second store
/// never costs the first.
pub async fn refresh(store: &IndexStore, client: &reqwest::Client, cache: &Path, force: bool, hexium: bool) -> Result<bool> {
    let _guard = store.refresh_lock.lock().await;
    if !force && store.get().is_some() {
        if let Some(t) = *store.last_failure.lock().unwrap() {
            if t.elapsed() < RETRY_BACKOFF {
                return Ok(false);
            }
        }
    }
    let old = store.get();
    let known = if force { IndexSource::default() } else { old.as_ref().map(|i| i.source.clone()).unwrap_or_default() };
    let (ts, hx) = futures::join!(fetch(client, Store::Thunderstore, known.thunderstore.as_deref()), async {
        if hexium {
            Some(fetch(client, Store::Hexium, known.hexium.as_deref()).await)
        } else {
            None
        }
    });
    let ts = match ts {
        Ok(o) => o,
        Err(e) => {
            *store.last_failure.lock().unwrap() = Some(Instant::now());
            return Err(e);
        }
    };
    let old_parts = old.as_ref().map(|i| &i.parts);
    let old_hexium = || old_parts.map(|p| p.hexium.clone()).unwrap_or_default();
    let had_hexium = old_parts.is_some_and(|p| !p.hexium.is_empty());
    let (ts_pkgs, ts_source, ts_changed) = match ts {
        FetchOutcome::Changed(f) => (f.pkgs, f.source, true),
        FetchOutcome::Unchanged => (old_parts.map(|p| p.thunderstore.clone()).unwrap_or_default(), known.thunderstore.clone(), false),
    };
    let (hx_pkgs, hx_source, hx_changed) = match hx {
        Some(Ok(FetchOutcome::Changed(f))) => (f.pkgs, f.source, true),
        Some(Ok(FetchOutcome::Unchanged)) => (old_hexium(), known.hexium.clone(), false),
        Some(Err(e)) => {
            eprintln!("Hexium index failed ({e}); keeping the last list");
            (old_hexium(), old.as_ref().and_then(|i| i.source.hexium.clone()), false)
        }
        None => (vec![], None, had_hexium),
    };
    if !ts_changed && !hx_changed {
        *store.last_check.lock().unwrap() = Some(Instant::now());
        *store.last_failure.lock().unwrap() = None;
        return Ok(false);
    }
    let at = now_ms();
    let cache = cache.to_path_buf();
    let idx = tokio::task::spawn_blocking(move || {
        let parts = Parts { thunderstore: ts_pkgs, hexium: hx_pkgs };
        let source = IndexSource { thunderstore: ts_source, hexium: hx_source };
        let _ = save_cache(&cache, at, &source, &parts);
        let mut idx = build(at, parts);
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
        let idx = build(1, Parts::thunderstore(pkgs));
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
        let source = IndexSource { thunderstore: Some("https://cdn/blob".into()), hexium: None };
        save_cache(&path, 5, &source, &Parts::thunderstore(pkgs)).unwrap();
        let idx = load_cache(&path).unwrap();
        assert_eq!((idx.fetched_at, idx.source), (5, source));
        // Caches from before Hexium: one list and one blob URL as a string, or no source at all.
        std::fs::write(&path, br#"{"fetchedAt":1,"source":"https://cdn/old","pkgs":[]}"#).unwrap();
        assert_eq!(load_cache(&path).unwrap().source.thunderstore.as_deref(), Some("https://cdn/old"));
        assert!(load_cache(&path).unwrap().lacks_hexium(), "a cache from before Hexium still has it to fetch");
        assert!(!build(1, Parts { thunderstore: vec![], hexium: parse_raw(RAW.as_bytes()).unwrap() }).lacks_hexium());
        std::fs::write(&path, br#"{"fetchedAt":1,"pkgs":[]}"#).unwrap();
        assert_eq!(load_cache(&path).unwrap().source, IndexSource::default());
    }

    const HX: &str = r#"[{
        "owner": "denikson", "name": "BepInExPack_Valheim", "package_url": "https://valheim.hexium.gg/mods/denikson/BepInExPack_Valheim",
        "categories": ["Client & Server", "Modpack"], "rating_score": 1,
        "versions": [
            {"version_number": "5.4.2400", "download_url": "https://cdn.hexium.gg/upload/1/5.4.2400.zip", "dependencies": [], "description": "newer on Hexium"},
            {"version_number": "5.4.2351", "download_url": "https://cdn.hexium.gg/upload/1/5.4.2351.zip", "dependencies": []}
        ]
    }, {
        "owner": "x", "name": "Only", "package_url": "https://valheim.hexium.gg/mods/x/Only", "categories": ["Server-only"],
        "versions": [{"version_number": "1.0.0", "download_url": "https://cdn.hexium.gg/upload/2/1.0.0.zip", "dependencies": []}]
    }]"#;

    #[test]
    fn hexium_listing_is_normalised_and_merged_by_id() {
        let hx = parse_raw_from(HX.as_bytes(), Store::Hexium).unwrap();
        assert_eq!(hx[0].cats, vec!["Client-side", "Server-side", "Modpacks"]);
        assert_eq!((hx[0].url.as_str(), hx[0].hx_url.as_str()), ("", "https://valheim.hexium.gg/mods/denikson/BepInExPack_Valheim"));
        assert_eq!((hx[0].versions[0].src, hx[0].versions[0].dl.as_str()), (Store::Hexium, "https://cdn.hexium.gg/upload/1/5.4.2400.zip"));
        let ts = parse_raw(RAW.as_bytes()).unwrap();
        let merged = merge(&Parts { thunderstore: ts.clone(), hexium: hx });
        let pack = merged.iter().find(|p| p.id == "denikson-BepInExPack_Valheim").unwrap();
        assert_eq!(pack.stores, vec![Store::Thunderstore, Store::Hexium]);
        assert_eq!(pack.url, "https://thunderstore.io/p");
        assert_eq!(pack.versions.len(), ts[0].versions.len() + 1, "the release both stores have is kept once");
        assert_eq!((pack.versions[0].v.as_str(), pack.versions[0].src), ("5.4.2400", Store::Hexium));
        assert_eq!(pack.versions.iter().find(|v| v.v == "5.4.2351").unwrap().src, Store::Thunderstore);
        assert_eq!(pack.desc, "newer on Hexium");
        assert_eq!(download_url_of(pack, "5.4.2400"), "https://cdn.hexium.gg/upload/1/5.4.2400.zip");
        assert_eq!(download_url_of(pack, "5.4.2351"), "https://thunderstore.io/package/download/denikson/BepInExPack_Valheim/5.4.2351/");
        let only = merged.iter().find(|p| p.id == "x-Only").unwrap();
        assert_eq!((only.stores.clone(), only.cats.clone()), (vec![Store::Hexium], vec!["Server-side".to_string()]));
        let idx = build(1, Parts { thunderstore: ts, hexium: parse_raw_from(HX.as_bytes(), Store::Hexium).unwrap() });
        let slim: serde_json::Value = serde_json::from_slice(&idx.slim_json).unwrap();
        let by: HashMap<&str, &serde_json::Value> = slim["packages"].as_array().unwrap().iter().map(|p| (p["id"].as_str().unwrap(), &p["stores"])).collect();
        assert_eq!(by["x-Only"], &serde_json::json!(["hexium"]));
        assert_eq!(by["denikson-BepInExPack_Valheim"], &serde_json::json!(["thunderstore", "hexium"]));
        assert_eq!(normalize_category(Store::Thunderstore, "Client-only"), vec!["Client-only"], "Thunderstore's names pass through");
    }

    #[test]
    fn deprecation_follows_the_store_with_the_newer_release() {
        let id = "denikson-BepInExPack_Valheim";
        let dep_of = |ts: &[Pkg], hx: &[Pkg]| merge(&Parts { thunderstore: ts.to_vec(), hexium: hx.to_vec() }).iter().find(|p| p.id == id).unwrap().dep;
        let mut ts = parse_raw(RAW.as_bytes()).unwrap();
        let mut hx = parse_raw_from(HX.as_bytes(), Store::Hexium).unwrap();
        // The maintainer moved to Hexium: deprecated on Thunderstore, newer and alive on Hexium.
        ts[0].dep = true;
        assert!(!dep_of(&ts, &hx));
        // The same newest release on both: deprecated only when both stores say so.
        hx[0].versions.retain(|v| v.v != "5.4.2400");
        assert_eq!((hx[0].versions[0].v.as_str(), ts[0].versions[0].v.as_str()), ("5.4.2351", "5.4.2351"));
        assert!(!dep_of(&ts, &hx));
        hx[0].dep = true;
        assert!(dep_of(&ts, &hx));
        // Thunderstore has the newer release: Hexium's older mirror cannot revive a deprecated listing.
        hx[0].dep = false;
        hx[0].versions[0].v = "5.4.2300".into();
        assert!(dep_of(&ts, &hx));
    }

    /// Network: `cargo test listing_index -- --ignored`. Downloads the real Valheim index both ways.
    #[tokio::test]
    #[ignore]
    async fn listing_index_matches_v1_in_size_and_detects_unchanged() {
        let client = http_client(Duration::from_secs(15), Duration::from_secs(60)).unwrap();
        let FetchOutcome::Changed(first) = fetch_listing_index(&client, Store::Thunderstore, None).await.unwrap() else { panic!("expected a download") };
        assert!(first.pkgs.len() > 10_000, "got {} packages", first.pkgs.len());
        assert!(first.source.as_deref().is_some_and(|s| s.contains("blob")));
        assert!(matches!(fetch_listing_index(&client, Store::Thunderstore, first.source.as_deref()).await.unwrap(), FetchOutcome::Unchanged));
        let FetchOutcome::Changed(hx) = fetch_listing_index(&client, Store::Hexium, None).await.unwrap() else { panic!("expected a download") };
        assert!(hx.pkgs.len() > 1_000 && hx.pkgs.iter().all(|p| p.stores == [Store::Hexium]), "got {} Hexium packages", hx.pkgs.len());
        let v1 = fetch_v1(&client, Store::Thunderstore).await.unwrap();
        let diff = (v1.len() as i64 - first.pkgs.len() as i64).abs();
        assert!(diff < 50, "v1 {} vs listing {}", v1.len(), first.pkgs.len());
        assert!(first.pkgs.iter().any(|p| p.id == "ValheimModding-Jotunn"));
    }

    /// Network: `cargo test hexium_refresh -- --ignored --nocapture`. A real refresh into a temp cache with
    /// Hexium on, then off: the merged index gains Hexium-only packages and loses them again; the cache follows.
    #[tokio::test]
    #[ignore]
    async fn hexium_refresh_on_and_off_against_the_live_stores() {
        let client = http_client(Duration::from_secs(15), Duration::from_secs(60)).unwrap();
        let dir = tempfile::tempdir().unwrap();
        let cache = dir.path().join("index.json");
        let store = IndexStore::new();
        assert!(refresh(&store, &client, &cache, true, true).await.unwrap());
        let on = store.get().unwrap();
        let hx_only = on.by_id.values().filter(|p| p.stores == [Store::Hexium]).count();
        let both = on.by_id.values().filter(|p| p.stores.len() == 2).count();
        eprintln!("hexium on: {} packages, {hx_only} Hexium-only, {both} in both stores", on.by_id.len());
        assert!(hx_only > 0 && both > 1_000, "merge produced {hx_only} Hexium-only and {both} shared packages");
        assert_eq!(load_cache(&cache).unwrap().parts.hexium.len(), on.parts.hexium.len());
        assert!(refresh(&store, &client, &cache, true, false).await.unwrap(), "turning Hexium off must rebuild the index");
        let off = store.get().unwrap();
        assert!(off.by_id.values().all(|p| p.stores == [Store::Thunderstore]), "Hexium entries survived the switch-off");
        assert!(off.by_id.len() < on.by_id.len());
        assert!(load_cache(&cache).unwrap().parts.hexium.is_empty());
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
        let idx = build(1000, Parts::thunderstore(pkgs.clone()));
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
        save_cache(&cache, 1000, &IndexSource::default(), &Parts::thunderstore(pkgs.clone())).unwrap();
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
        s.set(build(crate::util::now_ms() - 5_000, Parts::default()));
        assert!(s.age_ms().unwrap() >= 5_000);
    }
}
