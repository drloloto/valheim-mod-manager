//! The package index: the Thunderstore (and Hexium) listings, compacted and kept on disk per store as one JSON
//! line per package. In memory stay the slim list the frontend renders and an offset table, so a lookup by id
//! is one positional read plus a small cache; nothing iterates the 100k versions at runtime. A refresh streams
//! the new listing into a new generation of files and swaps it in.
use crate::error::{AppError, Result};
use crate::models::{Pkg, PkgSource, Store, Version};
use crate::resolver::canonical_id;
use crate::util::{cmp_version, now_ms, parse_full_name, write_atomic};
use futures::stream::BoxStream;
use futures::{StreamExt, TryStreamExt};
use serde::{Deserialize, Serialize};
use std::cmp::Ordering;
use std::collections::{HashMap, HashSet};
use std::fs::File;
use std::io::{BufRead, BufReader, BufWriter, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, RwLock};
use std::time::{Duration, Instant};

const RETRY_BACKOFF: Duration = Duration::from_secs(5 * 60);
const CHUNK_PARALLEL: usize = 4;
/// Full records kept in memory per index generation: a profile's packages and their dependency closure.
const RECORD_CACHE_MAX: usize = 4096;
/// Packages per chunk when a record file is re-read.
const RECORD_CHUNK: usize = 256;

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

/// The package lists per store, as fetched. Tests and the one-off migration of the old single-file cache
/// build an index from them; a refresh streams instead.
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

/// Merges Hexium's listing of a package into Thunderstore's: the package keeps Thunderstore's listing and
/// gains the versions only Hexium has (newest first again), Hexium's page and categories; counts take the
/// larger value, and the description follows the newer release. A release on both stores is downloaded
/// from Thunderstore.
pub fn merge_into(p: &mut Pkg, h: &Pkg) {
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

/// The two stores' records of one package as the index serves it.
fn merge_pair(ts: Option<Pkg>, hx: Option<Pkg>) -> Option<Pkg> {
    match (ts, hx) {
        (Some(mut t), Some(h)) => {
            merge_into(&mut t, &h);
            Some(t)
        }
        (t, h) => t.or(h),
    }
}

/// One package per id: Thunderstore's list, Hexium merged in by id, Hexium-only packages appended.
#[cfg(test)]
pub fn merge(parts: &Parts) -> Vec<Pkg> {
    let mut out: Vec<Pkg> = parts.thunderstore.clone();
    let mut at: HashMap<String, usize> = out.iter().enumerate().map(|(i, p)| (p.id.clone(), i)).collect();
    for h in &parts.hexium {
        match at.get(&h.id) {
            Some(&i) => merge_into(&mut out[i], h),
            None => {
                at.insert(h.id.clone(), out.len());
                out.push(h.clone());
            }
        }
    }
    out
}

/// The frontend's view of a package: the listing plus the latest version, no version history.
#[derive(Serialize)]
struct SlimPkg {
    id: String,
    ns: String,
    name: String,
    desc: String,
    icon: String,
    ver: String,
    cats: Vec<String>,
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
    stores: Vec<Store>,
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

/// The slim entry of a merged package; counts its latest dependencies into `dependants`.
fn slim_of(p: &Pkg, dependants: &mut HashMap<String, usize>) -> SlimPkg {
    let latest = p.versions.first();
    let deps = latest.map(|v| dep_ids(&v.deps)).unwrap_or_default();
    for d in &deps {
        *dependants.entry(d.clone()).or_default() += 1;
    }
    SlimPkg {
        id: p.id.clone(),
        ns: p.ns.clone(),
        name: p.name.clone(),
        desc: p.desc.clone(),
        icon: p.icon.clone(),
        ver: latest.map(|v| v.v.clone()).unwrap_or_default(),
        cats: p.cats.clone(),
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
        deps,
        ndependants: 0,
        stores: p.stores.clone(),
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SlimPayload {
    fetched_at: i64,
    packages: Vec<SlimPkg>,
}

/// Where each part of the index came from: the listing-index blob URL per store (None for v1 or old
/// caches), the change detector of the next refresh.
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct IndexSource {
    pub thunderstore: Option<String>,
    pub hexium: Option<String>,
}

// ---- Generations on disk ----
//
// A generation is named by its fetch time and consists of `<gen>.thunderstore.jsonl` and `<gen>.hexium.jsonl`
// (one package per line, the store's own listing), `<gen>.slim.json` (what `get_index` serves) and
// `<gen>.meta.json` (fetch time, sources and the byte offsets of every record), written last: a generation
// without its meta file is incomplete and ignored.

const STORES: [Store; 2] = [Store::Thunderstore, Store::Hexium];

fn slot(store: Store) -> usize {
    match store {
        Store::Thunderstore => 0,
        Store::Hexium => 1,
    }
}

fn records_path(dir: &Path, gen: i64, store: Store) -> PathBuf {
    dir.join(format!(
        "{gen}.{}.jsonl",
        match store {
            Store::Thunderstore => "thunderstore",
            Store::Hexium => "hexium",
        }
    ))
}

fn slim_path(dir: &Path, gen: i64) -> PathBuf {
    dir.join(format!("{gen}.slim.json"))
}

fn meta_path(dir: &Path, gen: i64) -> PathBuf {
    dir.join(format!("{gen}.meta.json"))
}

/// Byte offset and length of one record in its store's file.
type Loc = (String, u64, u32);

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Meta {
    fetched_at: i64,
    source: IndexSource,
    thunderstore: Vec<Loc>,
    hexium: Vec<Loc>,
}

/// Appends packages as JSON lines and remembers where each one went.
struct RecordWriter {
    w: BufWriter<File>,
    pos: u64,
    locs: Vec<Loc>,
}

impl RecordWriter {
    fn create(path: &Path) -> Result<Self> {
        Ok(RecordWriter { w: BufWriter::new(File::create(path)?), pos: 0, locs: vec![] })
    }

    fn push(&mut self, p: &Pkg) -> Result<()> {
        let mut line = serde_json::to_vec(p)?;
        line.push(b'\n');
        self.w.write_all(&line)?;
        self.locs.push((p.id.clone(), self.pos, (line.len() - 1) as u32));
        self.pos += line.len() as u64;
        Ok(())
    }

    fn finish(mut self) -> Result<Vec<Loc>> {
        self.w.flush()?;
        Ok(self.locs)
    }
}

fn read_at(file: &File, off: u64, buf: &mut [u8]) -> std::io::Result<()> {
    #[cfg(windows)]
    {
        use std::os::windows::fs::FileExt;
        let mut done = 0;
        while done < buf.len() {
            let n = file.seek_read(&mut buf[done..], off + done as u64)?;
            if n == 0 {
                return Err(std::io::Error::new(std::io::ErrorKind::UnexpectedEof, "record file truncated"));
            }
            done += n;
        }
        Ok(())
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::FileExt;
        file.read_exact_at(buf, off)
    }
}

/// Re-reads a record file in chunks.
fn stream_records(path: &Path) -> Result<impl Iterator<Item = Result<Vec<Pkg>>>> {
    let mut lines = BufReader::new(File::open(path)?).split(b'\n');
    Ok(std::iter::from_fn(move || {
        let mut chunk = Vec::with_capacity(RECORD_CHUNK);
        for line in lines.by_ref() {
            match line {
                Ok(l) if l.is_empty() => continue,
                Ok(l) => match serde_json::from_slice::<Pkg>(&l) {
                    Ok(p) => chunk.push(p),
                    Err(e) => return Some(Err(e.into())),
                },
                Err(e) => return Some(Err(e.into())),
            }
            if chunk.len() == RECORD_CHUNK {
                break;
            }
        }
        (!chunk.is_empty()).then_some(Ok(chunk))
    }))
}

fn read_records(path: &Path) -> Result<Vec<Pkg>> {
    let mut out = vec![];
    for chunk in stream_records(path)? {
        out.extend(chunk?);
    }
    Ok(out)
}

/// Deletes the files of every generation `doomed` says so for (open files go when their last reader closes).
fn remove_generations(dir: &Path, doomed: impl Fn(i64) -> bool) {
    let Ok(rd) = std::fs::read_dir(dir) else { return };
    for e in rd.flatten() {
        let name = e.file_name().to_string_lossy().to_string();
        if name.split('.').next().and_then(|g| g.parse::<i64>().ok()).is_some_and(&doomed) {
            let _ = std::fs::remove_file(e.path());
        }
    }
}

/// Deletes every generation other than `keep`.
fn cleanup(dir: &Path, keep: Option<i64>) {
    remove_generations(dir, |g| Some(g) != keep);
}

/// The loaded index: the slim list in memory, the full records on disk, read by id.
pub struct Index {
    pub fetched_at: i64,
    pub source: IndexSource,
    pub slim_json: Vec<u8>,
    files: [File; 2],
    paths: [PathBuf; 2],
    locs: HashMap<String, [Option<(u64, u32)>; 2]>,
    hexium_count: usize,
    cache: Mutex<HashMap<String, Arc<Pkg>>>,
}

impl Index {
    /// True while Hexium's list was never merged in: a cache from before the second store, or a Hexium fetch
    /// that never succeeded. With Hexium on, such an index is refreshed regardless of its age.
    pub fn lacks_hexium(&self) -> bool {
        self.hexium_count == 0 && self.source.hexium.is_none()
    }

    /// Packages in the index (both stores, merged by id).
    #[cfg(test)]
    pub fn len(&self) -> usize {
        self.locs.len()
    }

    fn read_record(&self, store: Store, loc: (u64, u32)) -> Result<Pkg> {
        let mut buf = vec![0u8; loc.1 as usize];
        read_at(&self.files[slot(store)], loc.0, &mut buf)?;
        Ok(serde_json::from_slice(&buf)?)
    }

    /// The merged package: one positional read per store that lists it, cached per generation.
    pub fn get(&self, id: &str) -> Option<Arc<Pkg>> {
        if let Some(p) = self.cache.lock().unwrap().get(id) {
            return Some(p.clone());
        }
        let locs = self.locs.get(id)?;
        let mut parts = [None, None];
        for store in STORES {
            if let Some(loc) = locs[slot(store)] {
                match self.read_record(store, loc) {
                    Ok(p) => parts[slot(store)] = Some(p),
                    Err(e) => eprintln!("index record {id} ({store:?}) unreadable: {e}"),
                }
            }
        }
        let [ts, hx] = parts;
        let pkg = Arc::new(merge_pair(ts, hx)?);
        let mut cache = self.cache.lock().unwrap();
        if cache.len() < RECORD_CACHE_MAX {
            cache.insert(id.to_string(), pkg.clone());
        }
        Some(pkg)
    }
}

impl PkgSource for Index {
    fn pkg(&self, id: &str) -> Option<Arc<Pkg>> {
        self.get(id)
    }
}

fn open_generation(dir: &Path, gen: i64) -> Result<Index> {
    let meta: Meta = serde_json::from_slice(&std::fs::read(meta_path(dir, gen))?)?;
    let paths = [records_path(dir, gen, Store::Thunderstore), records_path(dir, gen, Store::Hexium)];
    let files = [File::open(&paths[0])?, File::open(&paths[1])?];
    let slim_json = std::fs::read(slim_path(dir, gen))?;
    let mut locs: HashMap<String, [Option<(u64, u32)>; 2]> = HashMap::with_capacity(meta.thunderstore.len() + meta.hexium.len());
    for (store, list) in [(Store::Thunderstore, &meta.thunderstore), (Store::Hexium, &meta.hexium)] {
        for (id, off, len) in list {
            locs.entry(id.clone()).or_default()[slot(store)] = Some((*off, *len));
        }
    }
    let hexium_count = meta.hexium.len();
    Ok(Index { fetched_at: meta.fetched_at, source: meta.source, slim_json, files, paths, locs, hexium_count, cache: Mutex::new(HashMap::new()) })
}

/// Writes a generation from Thunderstore's listing as a stream of chunks and Hexium's list, then opens it.
/// Duplicates across chunks (a package listed twice around a chunk boundary during an upload) keep their first
/// occurrence. Files of a failed build are removed again.
fn build_generation(dir: &Path, gen: i64, source: &IndexSource, ts_chunks: impl Iterator<Item = Result<Vec<Pkg>>>, hexium: Vec<Pkg>) -> Result<Index> {
    std::fs::create_dir_all(dir)?;
    let result = (|| {
        let mut hx_w = RecordWriter::create(&records_path(dir, gen, Store::Hexium))?;
        let mut hx_order: Vec<String> = Vec::with_capacity(hexium.len());
        let mut hx_map: HashMap<String, Pkg> = HashMap::with_capacity(hexium.len());
        for h in hexium {
            if hx_map.contains_key(&h.id) {
                continue;
            }
            hx_w.push(&h)?;
            hx_order.push(h.id.clone());
            hx_map.insert(h.id.clone(), h);
        }
        let mut ts_w = RecordWriter::create(&records_path(dir, gen, Store::Thunderstore))?;
        let mut seen: HashSet<String> = HashSet::new();
        let mut slim: Vec<SlimPkg> = vec![];
        let mut dependants: HashMap<String, usize> = HashMap::new();
        for chunk in ts_chunks {
            for mut p in chunk? {
                if !seen.insert(p.id.clone()) {
                    continue;
                }
                ts_w.push(&p)?;
                if let Some(h) = hx_map.remove(&p.id) {
                    merge_into(&mut p, &h);
                }
                slim.push(slim_of(&p, &mut dependants));
            }
        }
        for id in hx_order {
            if let Some(h) = hx_map.get(&id) {
                slim.push(slim_of(h, &mut dependants));
            }
        }
        for s in &mut slim {
            s.ndependants = dependants.get(&s.id).copied().unwrap_or(0);
        }
        let (thunderstore, hexium) = (ts_w.finish()?, hx_w.finish()?);
        write_atomic(&slim_path(dir, gen), &serde_json::to_vec(&SlimPayload { fetched_at: gen, packages: slim })?)?;
        let meta = Meta { fetched_at: gen, source: source.clone(), thunderstore, hexium };
        write_atomic(&meta_path(dir, gen), &serde_json::to_vec(&meta)?)?;
        open_generation(dir, gen)
    })();
    if result.is_err() {
        remove_generations(dir, |g| g == gen);
    }
    result
}

/// An index from lists in memory (tests, the migration of the old cache).
pub fn build_from_parts(dir: &Path, fetched_at: i64, source: &IndexSource, parts: Parts) -> Result<Index> {
    build_generation(dir, fetched_at, source, std::iter::once(Ok(parts.thunderstore)), parts.hexium)
}

/// The cache before generations: one `index.json` with both lists. Older still: one list (`pkgs`) and the
/// blob URL as a string.
#[derive(Deserialize)]
#[serde(untagged)]
enum OldSource {
    Old(Option<String>),
    New(IndexSource),
}

impl Default for OldSource {
    fn default() -> Self {
        OldSource::Old(None)
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct OldCache {
    fetched_at: i64,
    #[serde(default)]
    source: OldSource,
    #[serde(default)]
    parts: Parts,
    #[serde(default)]
    pkgs: Vec<Pkg>,
}

fn load_old_cache(path: &Path) -> Option<(i64, IndexSource, Parts)> {
    let c: OldCache = serde_json::from_slice(&std::fs::read(path).ok()?).ok()?;
    let (source, parts) = match c.source {
        OldSource::New(s) => (s, c.parts),
        OldSource::Old(url) => (IndexSource { thunderstore: url, hexium: None }, if c.pkgs.is_empty() { c.parts } else { Parts::thunderstore(c.pkgs) }),
    };
    Some((c.fetched_at, source, parts))
}

/// The newest complete generation in `dir`; older ones are removed. Without one, the old single-file cache
/// next to the folder (`cache/index.json`) is converted once and deleted.
pub fn load(dir: &Path) -> Option<Index> {
    let mut gens: Vec<i64> = std::fs::read_dir(dir)
        .map(|rd| {
            rd.flatten()
                .filter_map(|e| {
                    let name = e.file_name().to_string_lossy().to_string();
                    name.strip_suffix(".meta.json").and_then(|g| g.parse().ok())
                })
                .collect()
        })
        .unwrap_or_default();
    gens.sort_unstable_by(|a, b| b.cmp(a));
    for gen in gens {
        match open_generation(dir, gen) {
            Ok(idx) => {
                cleanup(dir, Some(gen));
                return Some(idx);
            }
            Err(e) => eprintln!("index generation {gen} unreadable, skipped: {e}"),
        }
    }
    let old = dir.parent()?.join("index.json");
    if !old.is_file() {
        return None;
    }
    let converted = load_old_cache(&old).and_then(|(at, source, parts)| build_from_parts(dir, at, &source, parts).ok());
    let _ = std::fs::remove_file(&old);
    converted
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

/// Chunks of a store's listing as they arrive (and are parsed).
pub type ChunkStream = BoxStream<'static, Result<Vec<Pkg>>>;

pub enum FetchOutcome {
    /// The listing blob is the one the index was built from: nothing to download.
    Unchanged,
    /// A new listing: its chunks and the blob URL it came from (None for the v1 fallback).
    Changed { source: Option<String>, chunks: ChunkStream },
}

/// Fetches a store's listing. The listing index (chunked, CDN-cached) is tried first and compared with
/// `known_source`; the v1 API is the fallback.
pub async fn fetch(client: &reqwest::Client, store: Store, known_source: Option<&str>) -> Result<FetchOutcome> {
    match fetch_listing_index(client, store, known_source).await {
        Ok(outcome) => Ok(outcome),
        Err(e) => {
            eprintln!("{store:?} package-listing-index failed ({e}); falling back to {}", store.v1_url());
            let pkgs = fetch_v1(client, store).await?;
            Ok(FetchOutcome::Changed { source: None, chunks: futures::stream::once(async move { Ok(pkgs) }).boxed() })
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
    let chunks = futures::stream::iter(urls.into_iter().map({
        let client = client.clone();
        move |u| {
            let client = client.clone();
            async move {
                let bytes = get_bytes_retry(&client, &u).await?;
                tokio::task::spawn_blocking(move || parse_raw_from(&maybe_gunzip(&bytes)?, store)).await.map_err(|e| AppError::Invalid(e.to_string()))?
            }
        }
    }))
    .buffered(CHUNK_PARALLEL)
    .boxed();
    Ok(FetchOutcome::Changed { source: blob_url, chunks })
}

/// Concatenates chunks in index order; a package listed twice (chunk boundary during an upload) keeps
/// its first occurrence.
pub fn merge_chunks(chunks: Vec<Vec<Pkg>>) -> Vec<Pkg> {
    let mut seen = std::collections::HashSet::new();
    chunks.into_iter().flatten().filter(|p| seen.insert(p.id.clone())).collect()
}

async fn collect_chunks(chunks: ChunkStream) -> Result<Vec<Pkg>> {
    let all: Vec<Vec<Pkg>> = chunks.try_collect().await?;
    Ok(merge_chunks(all))
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

/// Re-fetches the index into a new generation in `dir`: Thunderstore, and Hexium when `hexium` is on.
/// Without `force`, a failure pauses retries for 5 minutes as long as an (old) index is still available.
/// Thunderstore failing is the error it always was; Hexium failing keeps its last list (or goes without
/// it), logged, so the second store never costs the first. Returns whether the index changed.
pub async fn refresh(store: &IndexStore, client: &reqwest::Client, dir: &Path, force: bool, hexium: bool) -> Result<bool> {
    let _guard = store.refresh_lock.lock().await;
    if !force && store.get().is_some() {
        if let Some(t) = *store.last_failure.lock().unwrap() {
            if t.elapsed() < RETRY_BACKOFF {
                return Ok(false);
            }
        }
    }
    let result = refresh_inner(store, client, dir, force, hexium).await;
    match &result {
        Ok(_) => {
            *store.last_check.lock().unwrap() = Some(Instant::now());
            *store.last_failure.lock().unwrap() = None;
        }
        Err(_) => *store.last_failure.lock().unwrap() = Some(Instant::now()),
    }
    result
}

async fn refresh_inner(store: &IndexStore, client: &reqwest::Client, dir: &Path, force: bool, hexium: bool) -> Result<bool> {
    let old = store.get();
    let known = if force { IndexSource::default() } else { old.as_ref().map(|i| i.source.clone()).unwrap_or_default() };
    let (ts, hx) = futures::join!(fetch(client, Store::Thunderstore, known.thunderstore.as_deref()), async {
        if hexium {
            Some(fetch(client, Store::Hexium, known.hexium.as_deref()).await)
        } else {
            None
        }
    });
    apply(store, dir, old, &known, ts?, hx).await
}

/// Builds the next generation from what the stores answered (`hx` is None with Hexium off) and swaps it in.
/// An unchanged store is re-streamed from the current generation's record file.
async fn apply(
    store: &IndexStore,
    dir: &Path,
    old: Option<Arc<Index>>,
    known: &IndexSource,
    ts: FetchOutcome,
    hx: Option<Result<FetchOutcome>>,
) -> Result<bool> {
    let had_hexium = old.as_ref().is_some_and(|i| i.hexium_count > 0);
    // Hexium's last list comes back from its record file; nothing of it is held in memory.
    let old_hexium = || -> Result<Vec<Pkg>> { old.as_ref().map(|i| read_records(&i.paths[slot(Store::Hexium)])).unwrap_or(Ok(vec![])) };
    let (hx_pkgs, hx_source, hx_changed) = match hx {
        Some(Ok(FetchOutcome::Changed { source, chunks })) => match collect_chunks(chunks).await {
            Ok(pkgs) => (pkgs, source, true),
            Err(e) => {
                eprintln!("Hexium index failed ({e}); keeping the last list");
                (old_hexium()?, old.as_ref().and_then(|i| i.source.hexium.clone()), false)
            }
        },
        Some(Ok(FetchOutcome::Unchanged)) => (old_hexium()?, known.hexium.clone(), false),
        Some(Err(e)) => {
            eprintln!("Hexium index failed ({e}); keeping the last list");
            (old_hexium()?, old.as_ref().and_then(|i| i.source.hexium.clone()), false)
        }
        None => (vec![], None, had_hexium),
    };
    let (ts_source, ts_changed) = match &ts {
        FetchOutcome::Changed { source, .. } => (source.clone(), true),
        FetchOutcome::Unchanged => (known.thunderstore.clone(), false),
    };
    if !ts_changed && !hx_changed {
        return Ok(false);
    }
    let gen = now_ms();
    let source = IndexSource { thunderstore: ts_source, hexium: hx_source };
    // The builder runs on a blocking thread and takes Thunderstore's chunks through a small channel, so at
    // most a few chunks are in memory at once; the chunks come from the download or from the last
    // generation's record file.
    let (tx, mut rx) = tokio::sync::mpsc::channel::<Result<Vec<Pkg>>>(2);
    let build_dir = dir.to_path_buf();
    let builder = tokio::task::spawn_blocking(move || build_generation(&build_dir, gen, &source, std::iter::from_fn(move || rx.blocking_recv()), hx_pkgs));
    match ts {
        FetchOutcome::Changed { mut chunks, .. } => {
            let mut any = false;
            while let Some(chunk) = chunks.next().await {
                any |= chunk.as_ref().is_ok_and(|c| !c.is_empty());
                if tx.send(chunk).await.is_err() {
                    break;
                }
            }
            if !any {
                let _ = tx.send(Err(AppError::Network("listing index chunks were empty".into()))).await;
            }
        }
        FetchOutcome::Unchanged => {
            let path = old.as_ref().map(|i| i.paths[slot(Store::Thunderstore)].clone());
            let tx = tx.clone();
            tokio::task::spawn_blocking(move || {
                let Some(path) = path else { return };
                match stream_records(&path) {
                    Ok(chunks) => {
                        for chunk in chunks {
                            if tx.blocking_send(chunk).is_err() {
                                break;
                            }
                        }
                    }
                    Err(e) => {
                        let _ = tx.blocking_send(Err(e));
                    }
                }
            })
            .await
            .map_err(|e| AppError::Invalid(e.to_string()))?;
        }
    }
    drop(tx);
    let idx = builder.await.map_err(|e| AppError::Invalid(e.to_string()))??;
    store.set(idx);
    cleanup(dir, Some(gen));
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp() -> tempfile::TempDir {
        tempfile::tempdir().unwrap()
    }

    fn slim_of_index(idx: &Index) -> serde_json::Value {
        serde_json::from_slice(&idx.slim_json).unwrap()
    }

    #[test]
    fn slim_index_counts_dependants() {
        let pkgs = vec![
            crate::models::test_pkg("a-Lib", &[("1.0.0", &[])]),
            crate::models::test_pkg("b-One", &[("1.0.0", &["a-Lib-1.0.0"])]),
            crate::models::test_pkg("c-Two", &[("2.0.0", &["a-Lib-0.9.0", "b-One-1.0.0"]), ("1.0.0", &["a-Lib-0.9.0"])]),
        ];
        let d = tmp();
        let idx = build_from_parts(d.path(), 1, &IndexSource::default(), Parts::thunderstore(pkgs)).unwrap();
        let slim = slim_of_index(&idx);
        let by: HashMap<&str, u64> =
            slim["packages"].as_array().unwrap().iter().map(|p| (p["id"].as_str().unwrap(), p["ndependants"].as_u64().unwrap())).collect();
        assert_eq!((by["a-Lib"], by["b-One"], by["c-Two"]), (2, 1, 0));
    }

    #[test]
    fn gunzip_is_transparent_and_chunks_merge_in_order() {
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
    fn generations_round_trip_and_the_old_cache_migrates() {
        let d = tmp();
        let dir = d.path().join("cache").join("index");
        let pkgs = parse_raw(RAW.as_bytes()).unwrap();
        let source = IndexSource { thunderstore: Some("https://cdn/blob".into()), hexium: None };
        build_from_parts(&dir, 5, &source, Parts::thunderstore(pkgs.clone())).unwrap();
        let idx = load(&dir).unwrap();
        assert_eq!((idx.fetched_at, idx.source.clone()), (5, source));
        assert_eq!(*idx.get("denikson-BepInExPack_Valheim").unwrap(), pkgs[0]);
        assert!(idx.get("nobody-Nothing").is_none());
        drop(idx);

        // A newer generation wins and the older one is swept; an incomplete one (no meta) is ignored.
        build_from_parts(&dir, 9, &IndexSource::default(), Parts::thunderstore(pkgs.clone())).unwrap();
        std::fs::write(records_path(&dir, 11, Store::Thunderstore), b"").unwrap();
        let idx = load(&dir).unwrap();
        assert_eq!(idx.fetched_at, 9);
        drop(idx);
        let names: Vec<String> = std::fs::read_dir(&dir).unwrap().flatten().map(|e| e.file_name().to_string_lossy().to_string()).collect();
        assert!(names.iter().all(|n| n.starts_with("9.")), "{names:?}");

        // Caches from before generations: one `index.json` next to the folder, converted once and deleted.
        for n in &names {
            std::fs::remove_file(dir.join(n)).unwrap();
        }
        let old = d.path().join("cache").join("index.json");
        std::fs::write(&old, br#"{"fetchedAt":1,"source":"https://cdn/old","pkgs":[]}"#).unwrap();
        let idx = load(&dir).unwrap();
        assert_eq!(idx.source.thunderstore.as_deref(), Some("https://cdn/old"));
        assert!(idx.lacks_hexium(), "a cache from before Hexium still has it to fetch");
        assert!(!old.exists());
        drop(idx);
        cleanup(&dir, None);
        std::fs::write(&old, serde_json::to_vec(&serde_json::json!({"fetchedAt": 2, "source": {"thunderstore": null, "hexium": "https://hx/blob"}, "parts": {"thunderstore": [], "hexium": parse_raw_from(HX.as_bytes(), Store::Hexium).unwrap()}})).unwrap()).unwrap();
        let idx = load(&dir).unwrap();
        assert!(!idx.lacks_hexium());
        assert_eq!(idx.get("x-Only").unwrap().stores, vec![Store::Hexium]);
        assert!(load(&d.path().join("elsewhere")).is_none());
    }

    #[test]
    fn records_are_read_by_id_and_cached() {
        let d = tmp();
        let ts = parse_raw(RAW.as_bytes()).unwrap();
        let hx = parse_raw_from(HX.as_bytes(), Store::Hexium).unwrap();
        let idx = build_from_parts(d.path(), 1, &IndexSource::default(), Parts { thunderstore: ts.clone(), hexium: hx }).unwrap();
        assert_eq!(idx.len(), 2);
        let pack = idx.get("denikson-BepInExPack_Valheim").unwrap();
        assert_eq!(pack.stores, vec![Store::Thunderstore, Store::Hexium]);
        assert_eq!(pack.versions.len(), ts[0].versions.len() + 1, "merged at read time");
        assert!(Arc::ptr_eq(&pack, &idx.get("denikson-BepInExPack_Valheim").unwrap()), "second read comes from the cache");
        assert_eq!(idx.get("x-Only").unwrap().cats, vec!["Server-side".to_string()]);
        // Re-reading a record file streams every package once.
        let again = read_records(&records_path(d.path(), 1, Store::Thunderstore)).unwrap();
        assert_eq!(again, ts);
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
        let d = tmp();
        let idx =
            build_from_parts(d.path(), 1, &IndexSource::default(), Parts { thunderstore: ts, hexium: parse_raw_from(HX.as_bytes(), Store::Hexium).unwrap() })
                .unwrap();
        let slim = slim_of_index(&idx);
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
        let FetchOutcome::Changed { source, chunks } = fetch_listing_index(&client, Store::Thunderstore, None).await.unwrap() else {
            panic!("expected a download")
        };
        let first = collect_chunks(chunks).await.unwrap();
        assert!(first.len() > 10_000, "got {} packages", first.len());
        assert!(source.as_deref().is_some_and(|s| s.contains("blob")));
        assert!(matches!(fetch_listing_index(&client, Store::Thunderstore, source.as_deref()).await.unwrap(), FetchOutcome::Unchanged));
        let FetchOutcome::Changed { chunks, .. } = fetch_listing_index(&client, Store::Hexium, None).await.unwrap() else { panic!("expected a download") };
        let hx = collect_chunks(chunks).await.unwrap();
        assert!(hx.len() > 1_000 && hx.iter().all(|p| p.stores == [Store::Hexium]), "got {} Hexium packages", hx.len());
        let v1 = fetch_v1(&client, Store::Thunderstore).await.unwrap();
        let diff = (v1.len() as i64 - first.len() as i64).abs();
        assert!(diff < 50, "v1 {} vs listing {}", v1.len(), first.len());
        assert!(first.iter().any(|p| p.id == "ValheimModding-Jotunn"));
    }

    /// Network: `cargo test hexium_refresh -- --ignored --nocapture`. A real refresh into a temp folder with
    /// Hexium on, then off: the index gains Hexium-only packages and loses them again; the generation on disk
    /// follows and the previous one is swept.
    #[tokio::test]
    #[ignore]
    async fn hexium_refresh_on_and_off_against_the_live_stores() {
        let client = http_client(Duration::from_secs(15), Duration::from_secs(60)).unwrap();
        let dir = tmp();
        let store = IndexStore::new();
        let stores_of = |idx: &Index| -> Vec<Vec<String>> {
            slim_of_index(idx)["packages"]
                .as_array()
                .unwrap()
                .iter()
                .map(|p| p["stores"].as_array().unwrap().iter().map(|s| s.as_str().unwrap().to_string()).collect())
                .collect()
        };
        assert!(refresh(&store, &client, dir.path(), true, true).await.unwrap());
        let on = store.get().unwrap();
        let on_stores = stores_of(&on);
        let hx_only = on_stores.iter().filter(|s| **s == ["hexium"]).count();
        let both = on_stores.iter().filter(|s| s.len() == 2).count();
        eprintln!("hexium on: {} packages, {hx_only} Hexium-only, {both} in both stores", on.len());
        assert!(hx_only > 0 && both > 1_000, "merge produced {hx_only} Hexium-only and {both} shared packages");
        assert!(refresh(&store, &client, dir.path(), true, false).await.unwrap(), "turning Hexium off must rebuild the index");
        let off = store.get().unwrap();
        assert!(stores_of(&off).iter().all(|s| *s == ["thunderstore"]), "Hexium entries survived the switch-off");
        assert!(off.len() < on.len());
        drop(on);
        let loaded = load(dir.path()).unwrap();
        assert_eq!(loaded.fetched_at, off.fetched_at);
        assert!(loaded.hexium_count == 0);
    }

    fn once(pkgs: Vec<Pkg>) -> ChunkStream {
        futures::stream::once(async move { Ok(pkgs) }).boxed()
    }

    #[tokio::test]
    async fn an_unchanged_store_is_restreamed_from_the_last_generation() {
        let d = tmp();
        let ts = parse_raw(RAW.as_bytes()).unwrap();
        let hx = parse_raw_from(HX.as_bytes(), Store::Hexium).unwrap();
        let store = IndexStore::new();
        let known = IndexSource { thunderstore: Some("https://cdn/ts".into()), hexium: None };
        store.set(build_from_parts(d.path(), 1, &known, Parts::thunderstore(ts.clone())).unwrap());
        // Thunderstore unchanged, Hexium arrives: the records come back from the file, Hexium is merged in.
        let changed = FetchOutcome::Changed { source: Some("https://cdn/hx".into()), chunks: once(hx.clone()) };
        assert!(apply(&store, d.path(), store.get(), &known, FetchOutcome::Unchanged, Some(Ok(changed))).await.unwrap());
        let idx = store.get().unwrap();
        assert!(idx.fetched_at > 1 && idx.len() == 2);
        assert_eq!(idx.source, IndexSource { thunderstore: Some("https://cdn/ts".into()), hexium: Some("https://cdn/hx".into()) });
        let pack = idx.get("denikson-BepInExPack_Valheim").unwrap();
        assert_eq!((pack.stores.clone(), pack.versions.len()), (vec![Store::Thunderstore, Store::Hexium], ts[0].versions.len() + 1));
        assert!(!meta_path(d.path(), 1).exists(), "the previous generation is swept");
        // Both unchanged: nothing is rebuilt.
        let known = idx.source.clone();
        assert!(!apply(&store, d.path(), store.get(), &known, FetchOutcome::Unchanged, Some(Ok(FetchOutcome::Unchanged))).await.unwrap());
        assert!(Arc::ptr_eq(&idx, &store.get().unwrap()));
        // Hexium failing keeps its last list; a new Thunderstore listing streams in.
        let err = Some(Err(AppError::Network("down".into())));
        assert!(apply(&store, d.path(), store.get(), &known, FetchOutcome::Changed { source: Some("https://cdn/ts2".into()), chunks: once(ts.clone()) }, err)
            .await
            .unwrap());
        let idx = store.get().unwrap();
        assert_eq!((idx.hexium_count, idx.source.thunderstore.as_deref(), idx.source.hexium.as_deref()), (2, Some("https://cdn/ts2"), Some("https://cdn/hx")));
        // Hexium switched off with Thunderstore unchanged: rebuilt without it.
        assert!(apply(&store, d.path(), store.get(), &idx.source.clone(), FetchOutcome::Unchanged, None).await.unwrap());
        let idx = store.get().unwrap();
        assert_eq!((idx.hexium_count, idx.len(), idx.source.hexium.as_deref()), (0, 1, None));
        assert!(idx.get("x-Only").is_none());
        // A failing Thunderstore chunk leaves the current generation in place.
        let broken: ChunkStream = futures::stream::iter(vec![Ok(ts.clone()), Err(AppError::Network("cut".into()))]).boxed();
        assert!(apply(&store, d.path(), store.get(), &idx.source.clone(), FetchOutcome::Changed { source: None, chunks: broken }, None).await.is_err());
        assert!(Arc::ptr_eq(&idx, &store.get().unwrap()));
        assert_eq!(load(d.path()).unwrap().fetched_at, idx.fetched_at);
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
    fn builds_slim_payload() {
        let pkgs = parse_raw(RAW.as_bytes()).unwrap();
        let d = tmp();
        let idx = build_from_parts(d.path(), 1000, &IndexSource::default(), Parts::thunderstore(pkgs.clone())).unwrap();
        let slim = slim_of_index(&idx);
        assert_eq!(slim["fetchedAt"], 1000);
        assert_eq!(slim["packages"][0]["ver"], "5.4.2351");
        assert_eq!(slim["packages"][0]["size"], 123);
        assert_eq!(slim["packages"][0]["created"], 1612224000000i64);
        assert_eq!(slim["packages"][0]["nver"], 2);
        assert_eq!(slim["packages"][0]["deps"], serde_json::json!([]));
        assert_eq!(dep_ids(&["a-B-1.0.0".into(), "x-BepInExPack_Foo-1.0.0".into(), "a-B-2.0.0".into()]), vec!["a-B", "denikson-BepInExPack_Valheim"]);
        assert!(slim["packages"][0].get("versions").is_none());
        // A package listed twice (chunk boundary) keeps its first occurrence.
        let twice = build_generation(d.path(), 1001, &IndexSource::default(), vec![Ok(pkgs.clone()), Ok(pkgs.clone())].into_iter(), vec![]).unwrap();
        assert_eq!(twice.len(), 1);
        assert_eq!(slim_of_index(&twice)["packages"].as_array().unwrap().len(), 1);
        // A failing chunk leaves no half-written generation behind.
        assert!(build_generation(d.path(), 1002, &IndexSource::default(), vec![Ok(pkgs), Err(AppError::Network("boom".into()))].into_iter(), vec![]).is_err());
        assert!(!meta_path(d.path(), 1002).exists() && !records_path(d.path(), 1002, Store::Thunderstore).exists());
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
        let d = tmp();
        s.set(build_from_parts(d.path(), crate::util::now_ms() - 5_000, &IndexSource::default(), Parts::default()).unwrap());
        assert!(s.age_ms().unwrap() >= 5_000);
    }
}
