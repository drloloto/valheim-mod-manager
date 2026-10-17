//! Tauri commands: a thin facade over the core modules.
use crate::config::{self, ConfigChange, ParsedConfig};
use crate::error::{AppError, Result};
use crate::game::{self, GameInfo};
use crate::gistsync;
use crate::health::{self, HealthIssue};
use crate::install;
use crate::localmod;
use crate::logs;
use crate::migrate::{self, ForeignProfile};
use crate::models::{Pkg, Plan, Profile, ProfileMod, ServerLink, Source};
use crate::paths::Paths;
use crate::profiles;
use crate::publish;
use crate::resolver;
use crate::server::{self, ApplyResponse, ReleaseSummary, ServerDiff, StageResponse};
use crate::settings::{self, Settings};
use crate::share::{self, ImportSummary};
use crate::sync::{self, SyncHandle, SyncJob, SyncStatus};
use crate::thunderstore::{self, Index, IndexStore};
use serde::Serialize;
use std::collections::{BTreeMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, RwLock};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_opener::OpenerExt;

pub struct AppCtx {
    pub paths: Paths,
    pub settings: RwLock<Settings>,
    pub detected: RwLock<GameInfo>,
    pub index: IndexStore,
    pub sync: SyncHandle,
    pub client: reqwest::Client,
    pub log_tail: Mutex<Option<tauri::async_runtime::JoinHandle<()>>>,
    pub portable: bool,
    /// Built with `tauri.dev.conf.json`: own data dir, marked window, test hooks in the frontend.
    pub dev: bool,
    pub gist_cache: gistsync::EtagCache,
}

impl AppCtx {
    fn game(&self) -> GameInfo {
        game::resolve(&self.settings.read().unwrap(), &self.detected.read().unwrap())
    }

    fn active(&self) -> Result<String> {
        profiles::active(&self.paths).ok_or_else(|| AppError::Invalid("No active profile.".into()))
    }

    async fn ensure_index(&self) -> Result<Arc<Index>> {
        if self.index.get().is_none() {
            let cache = self.paths.index_cache();
            if let Ok(Some(idx)) = tokio::task::spawn_blocking(move || thunderstore::load_cache(&cache)).await {
                self.index.set(idx);
            }
        }
        let hexium = self.settings.read().unwrap().hexium;
        match self.index.get() {
            // An index from before the second store: merge Hexium in before answering, so a lock that names a
            // Hexium mod resolves on the first adoption after the update (the worker does the same in time).
            Some(i) if hexium && i.lacks_hexium() => {
                if let Err(e) = thunderstore::refresh(&self.index, &self.client, &self.paths.index_cache(), false, true).await {
                    eprintln!("Hexium could not be merged into the index: {e}");
                }
            }
            Some(i) => return Ok(i),
            None => {
                thunderstore::refresh(&self.index, &self.client, &self.paths.index_cache(), true, hexium).await?;
            }
        }
        self.index.get().ok_or_else(|| AppError::Network("The mod index is not available.".into()))
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GameStatus {
    valheim_dir: Option<String>,
    found: bool,
    /// Steam's LastUpdated for the game (ms), from appmanifest_892970.acf
    last_updated: Option<i64>,
    build_id: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    version: &'static str,
    portable: bool,
    dev: bool,
    data_dir: String,
}

/// The active profile's linked companion server, without the token.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerLinkInfo {
    url: String,
    name: String,
    has_token: bool,
    /// Linked through a sealed gist (sync code) instead of the companion's HTTP API.
    gist: bool,
    has_gist_token: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppState {
    profiles: Vec<String>,
    active: Option<String>,
    mods: Vec<ProfileMod>,
    server: Option<ServerLinkInfo>,
    installed: BTreeMap<String, String>,
    plan: Option<Plan>,
    updates: BTreeMap<String, String>,
    index_age: Option<i64>,
    sync: SyncStatus,
    game: GameStatus,
    /// Mod IDs per profile (all profiles), for the profile filter on the Browse page.
    profile_mods: BTreeMap<String, Vec<String>>,
    /// Entries adopted from the server as its dependencies (`ProfileMod::implicit`): pinned in the plan,
    /// listed as dependencies in the UI even when nothing local requires them.
    implicit_mods: Vec<String>,
    health: Vec<HealthIssue>,
    app: AppInfo,
}

fn build_state(ctx: &AppCtx) -> Result<AppState> {
    let active = profiles::active(&ctx.paths);
    let (mut mods, server) = match &active {
        Some(n) => {
            let p = profiles::load(&ctx.paths, n)?;
            let server = p.server.map(|s| ServerLinkInfo {
                has_token: s.token.as_deref().is_some_and(|t| !t.trim().is_empty()),
                gist: s.sync_code.is_some(),
                has_gist_token: s.gist_token.as_deref().is_some_and(|t| !t.trim().is_empty()),
                url: s.url,
                name: s.name,
            });
            (p.mods, server)
        }
        None => (vec![], None),
    };
    let installed = active.as_deref().map(|n| profiles::load_installed(&ctx.paths, n)).unwrap_or_default();
    let (plan, updates) = match (ctx.index.get(), &active) {
        (Some(i), Some(_)) => (Some(resolver::plan(&mods, &i.by_id, &installed)), resolver::updates(&mods, &i.by_id)),
        _ => (None, BTreeMap::new()),
    };
    let game = ctx.game();
    let found = game.valheim_dir.as_deref().is_some_and(|d| game::is_valheim_dir(Path::new(d)));
    let manifest = game.valheim_dir.as_deref().and_then(|d| game::app_manifest(Path::new(d)));
    let health_ids = health::ids_to_check(&mods, plan.as_ref().map(|p| &p.resolved));
    let health = health::check(&health_ids, &installed, ctx.index.get().as_deref().map(|i| &i.by_id), manifest.as_ref().map(|m| m.0));
    let names = profiles::list(&ctx.paths);
    let profile_mods = names
        .iter()
        .filter_map(|n| profiles::load(&ctx.paths, n).ok().map(|p| (n.clone(), p.mods.iter().filter(|m| !m.implicit).map(ProfileMod::id).collect())))
        .collect();
    // Implicit entries pin a server's dependencies for the plan above; the UI sees them as dependencies.
    let implicit_mods = mods.iter().filter(|m| m.implicit).map(ProfileMod::id).collect();
    mods.retain(|m| !m.implicit);
    Ok(AppState {
        profiles: names,
        active,
        mods,
        server,
        installed: installed.into_iter().map(|(k, v)| (k, v.version)).collect(),
        plan,
        updates,
        index_age: ctx.index.age_ms(),
        sync: ctx.sync.status(),
        game: GameStatus { valheim_dir: game.valheim_dir, found, last_updated: manifest.as_ref().map(|m| m.0), build_id: manifest.map(|m| m.1) },
        profile_mods,
        implicit_mods,
        health,
        app: AppInfo { version: env!("CARGO_PKG_VERSION"), portable: ctx.portable, dev: ctx.dev, data_dir: ctx.paths.root.to_string_lossy().to_string() },
    })
}

#[derive(Serialize)]
pub struct ImportResponse {
    #[serde(flatten)]
    state: AppState,
    imported: ImportSummary,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportResult {
    code: Option<String>,
    skipped_local: Vec<String>,
}

/// What `publish_gist` wrote: the release id the companion will report back, and the local mods that
/// stayed out because the server cannot install them.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GistPublishResult {
    id: String,
    skipped_local: Vec<String>,
}

fn emit_index_updated(app: &AppHandle, ctx: &AppCtx) {
    if let Some(i) = ctx.index.get() {
        let _ = app.emit("index://updated", serde_json::json!({ "fetchedAt": i.fetched_at }));
    }
}

/// Queues a sync and starts the worker if it is not running.
pub fn request_sync(app: &AppHandle, profile: &str, repair: bool) {
    let ctx = app.state::<AppCtx>();
    if !ctx.sync.enqueue(profile, repair) {
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let ctx = app.state::<AppCtx>();
        while let Some((profile, repair)) = ctx.sync.next() {
            let _guard = ctx.sync.lock.lock().await;
            let concurrency = ctx.settings.read().unwrap().download_concurrency;
            let job = SyncJob { paths: ctx.paths.clone(), profile: profile.clone(), index: ctx.index.get(), client: ctx.client.clone(), concurrency, repair };
            let emitter = app.clone();
            let progress: sync::ProgressFn = Arc::new(move |p| {
                let _ = emitter.emit("sync://progress", p);
            });
            let result = sync::run_sync(job, progress).await.unwrap_or_else(|e| sync::SyncResult {
                profile: profile.clone(),
                errors: vec![e.to_string()],
                ..Default::default()
            });
            let _ = app.emit("sync://done", result);
        }
    });
}

/// Loads the index cache at startup and keeps the index fresh afterwards.
pub async fn index_worker(app: AppHandle) {
    let ctx = app.state::<AppCtx>();
    if ctx.index.get().is_none() {
        let cache = ctx.paths.index_cache();
        if let Ok(Some(idx)) = tokio::task::spawn_blocking(move || thunderstore::load_cache(&cache)).await {
            ctx.index.set(idx);
            emit_index_updated(&app, &ctx);
        }
    }
    loop {
        let (ttl, hexium) = {
            let s = ctx.settings.read().unwrap();
            (s.index_ttl_minutes as i64 * 60_000, s.hexium)
        };
        let stale = ctx.index.staleness_ms().is_none_or(|age| age > ttl);
        // Hexium on but never fetched (a cache from before the second store): refresh regardless of the age.
        let missing_store = hexium && ctx.index.get().is_some_and(|i| i.lacks_hexium());
        if stale || missing_store {
            match thunderstore::refresh(&ctx.index, &ctx.client, &ctx.paths.index_cache(), false, hexium).await {
                Ok(true) => emit_index_updated(&app, &ctx),
                Ok(false) => {}
                Err(e) => eprintln!("Index refresh failed: {e}"),
            }
        }
        tokio::time::sleep(Duration::from_secs(60)).await;
    }
}

/// Removes copies of local mods that are no longer in the profile.
fn prune_local_copies(paths: &Paths, profile: &str, mods: &[ProfileMod]) {
    let Ok(rd) = std::fs::read_dir(paths.local_dir(profile)) else { return };
    for e in rd.flatten() {
        let name = e.file_name().to_string_lossy().to_string();
        if !mods.iter().any(|m| m.source == Source::Local && m.id() == name) {
            let _ = std::fs::remove_dir_all(e.path());
        }
    }
}

// ---- Index ----

#[tauri::command]
pub fn get_state(ctx: State<'_, AppCtx>) -> Result<AppState> {
    build_state(&ctx)
}

#[tauri::command]
pub async fn get_index(ctx: State<'_, AppCtx>, since: Option<i64>) -> Result<tauri::ipc::Response> {
    let idx = ctx.ensure_index().await?;
    let body = if since == Some(idx.fetched_at) { Vec::new() } else { idx.slim_json.clone() };
    Ok(tauri::ipc::Response::new(body))
}

#[tauri::command]
pub async fn refresh_index(app: AppHandle, ctx: State<'_, AppCtx>) -> Result<Option<i64>> {
    let hexium = ctx.settings.read().unwrap().hexium;
    thunderstore::refresh(&ctx.index, &ctx.client, &ctx.paths.index_cache(), true, hexium).await?;
    emit_index_updated(&app, &ctx);
    Ok(ctx.index.age_ms())
}

#[tauri::command]
pub async fn get_package(ctx: State<'_, AppCtx>, id: String) -> Result<Pkg> {
    let idx = ctx.ensure_index().await?;
    idx.by_id.get(&id).cloned().ok_or_else(|| AppError::NotFound(format!("Package {id} not found.")))
}

/// Readme or changelog markdown of one version; cached on disk forever (a version never changes).
#[tauri::command]
pub async fn get_package_doc(ctx: State<'_, AppCtx>, id: String, version: String, kind: thunderstore::DocKind) -> Result<String> {
    if version.is_empty() || !version.chars().all(|c| c.is_ascii_alphanumeric() || c == '.') {
        return Err(AppError::Invalid(format!("Invalid version \"{version}\".")));
    }
    // Authors can edit readme and changelog on Thunderstore after the upload, so a cached copy is
    // trusted for a week, not forever.
    const DOC_TTL: Duration = Duration::from_secs(7 * 24 * 3600);
    let cache = ctx.paths.doc_cache(&id, &version, kind.as_str());
    let fresh = std::fs::metadata(&cache).and_then(|m| m.modified()).ok().and_then(|t| t.elapsed().ok()).is_some_and(|age| age < DOC_TTL);
    if fresh {
        if let Ok(md) = std::fs::read_to_string(&cache) {
            return Ok(md);
        }
    }
    let pkg = get_package(ctx.clone(), id).await?;
    let md = thunderstore::fetch_doc(&ctx.client, &pkg.ns, &pkg.name, &version, kind).await?;
    let _ = crate::util::write_atomic(&cache, md.as_bytes());
    Ok(md)
}

// ---- Publish as a Thunderstore modpack ----

#[tauri::command]
pub async fn thunderstore_categories(ctx: State<'_, AppCtx>) -> Result<Vec<publish::Category>> {
    publish::fetch_categories(&ctx.client).await
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModpackPreview {
    /// `Namespace-Name-1.2.3` for every resolved package, what the manifest will list.
    dependencies: Vec<String>,
    readme: String,
    configs: usize,
    has_token: bool,
}

#[tauri::command]
pub async fn modpack_preview(ctx: State<'_, AppCtx>, profile: String, name: String, description: String) -> Result<ModpackPreview> {
    let index = ctx.ensure_index().await?;
    let p = profiles::load(&ctx.paths, &profile)?;
    let plan = resolver::plan(&p.mods, &index.by_id, &profiles::load_installed(&ctx.paths, &profile));
    if !plan.errors.is_empty() {
        return Err(AppError::Invalid(format!("The profile has unresolved mods: {}", plan.errors.join(", "))));
    }
    let mods: Vec<(String, String, String)> = plan
        .resolved
        .iter()
        .map(|(id, r)| {
            let pkg = index.by_id.get(id);
            (pkg.map(|p| p.ns.clone()).unwrap_or_default(), pkg.map(|p| p.name.clone()).unwrap_or_else(|| id.clone()), r.version.clone())
        })
        .collect();
    let title = if name.trim().is_empty() { p.name.clone() } else { name };
    Ok(ModpackPreview {
        dependencies: publish::dependency_strings(&plan),
        readme: publish::default_readme(&title, &description, &mods),
        configs: config::list_files_with_ext(&ctx.paths.config_dir(&profile), &share::CONFIG_EXTS).len(),
        has_token: ctx.settings.read().unwrap().thunderstore_token.as_deref().is_some_and(|t| !t.trim().is_empty()),
    })
}

#[tauri::command]
pub async fn publish_modpack(ctx: State<'_, AppCtx>, profile: String, meta: publish::PublishMeta) -> Result<publish::PublishResult> {
    let token = ctx
        .settings
        .read()
        .unwrap()
        .thunderstore_token
        .clone()
        .filter(|t| !t.trim().is_empty())
        .ok_or_else(|| AppError::Invalid("Set a Thunderstore service-account token in the settings first.".into()))?;
    let index = ctx.ensure_index().await?;
    let p = profiles::load(&ctx.paths, &profile)?;
    let plan = resolver::plan(&p.mods, &index.by_id, &profiles::load_installed(&ctx.paths, &profile));
    if !plan.errors.is_empty() {
        return Err(AppError::Invalid(format!("The profile has unresolved mods: {}", plan.errors.join(", "))));
    }
    let icon = match &meta.icon_path {
        Some(path) if !path.trim().is_empty() => std::fs::read(path)?,
        _ => publish::DEFAULT_ICON.to_vec(),
    };
    let configs = if meta.include_configs {
        let dir = ctx.paths.config_dir(&profile);
        config::list_files_with_ext(&dir, &share::CONFIG_EXTS)
            .into_iter()
            .filter_map(|rel| crate::util::safe_join(&dir, &rel).ok().and_then(|p| std::fs::read(p).ok()).map(|b| (rel, b)))
            .collect()
    } else {
        Vec::new()
    };
    publish::publish(&ctx.client, token.trim(), &meta, &plan, icon, configs).await
}

#[tauri::command]
pub async fn get_package_wiki(ctx: State<'_, AppCtx>, id: String) -> Result<Option<thunderstore::Wiki>> {
    let pkg = get_package(ctx.clone(), id).await?;
    thunderstore::fetch_wiki(&ctx.client, &pkg.ns, &pkg.name).await
}

#[tauri::command]
pub async fn get_wiki_page(ctx: State<'_, AppCtx>, page: String) -> Result<String> {
    thunderstore::fetch_wiki_page(&ctx.client, &page).await
}

// ---- Profile ----

#[tauri::command]
pub fn create_profile(ctx: State<'_, AppCtx>, name: String) -> Result<AppState> {
    let name = profiles::create(&ctx.paths, &name)?;
    profiles::set_active(&ctx.paths, &name)?;
    build_state(&ctx)
}

#[tauri::command]
pub async fn delete_profile(ctx: State<'_, AppCtx>, name: String) -> Result<AppState> {
    let guard = ctx.sync.lock.lock().await;
    profiles::delete(&ctx.paths, &name)?;
    drop(guard);
    build_state(&ctx)
}

#[tauri::command]
pub fn activate_profile(ctx: State<'_, AppCtx>, name: String) -> Result<AppState> {
    if !profiles::exists(&ctx.paths, &name) {
        return Err(AppError::NotFound(format!("Profile \"{name}\" does not exist.")));
    }
    profiles::set_active(&ctx.paths, &name)?;
    build_state(&ctx)
}

#[tauri::command]
pub async fn rename_profile(ctx: State<'_, AppCtx>, from: String, to: String) -> Result<AppState> {
    let guard = ctx.sync.lock.lock().await;
    profiles::rename(&ctx.paths, &from, &to)?;
    drop(guard);
    build_state(&ctx)
}

#[tauri::command]
pub async fn clone_profile(ctx: State<'_, AppCtx>, from: String, to: String) -> Result<AppState> {
    let guard = ctx.sync.lock.lock().await;
    let name = profiles::clone_profile(&ctx.paths, &from, &to)?;
    profiles::set_active(&ctx.paths, &name)?;
    drop(guard);
    build_state(&ctx)
}

#[tauri::command]
pub fn set_mods(app: AppHandle, ctx: State<'_, AppCtx>, profile: String, mods: Vec<ProfileMod>) -> Result<AppState> {
    let mut p = profiles::load(&ctx.paths, &profile)?;
    // The UI edits the list but never the server's claim on an entry: `managed` survives any round trip.
    let managed: HashSet<String> = p.mods.iter().filter(|m| m.managed).map(ProfileMod::id).collect();
    let mut mods = mods;
    for m in &mut mods {
        m.managed |= managed.contains(&m.id());
    }
    p.mods = merge_implicit(&p.mods, mods);
    profiles::save(&ctx.paths, &p)?;
    prune_local_copies(&ctx.paths, &profile, &p.mods);
    request_sync(&app, &profile, false);
    build_state(&ctx)
}

/// The list the UI sends back holds only the mods it shows. Implicit entries (a server's dependencies,
/// see `ProfileMod::implicit`) are what the server runs, so they are carried over as they are until the
/// next adoption replaces them; a pick the UI made explicit replaces its implicit twin.
fn merge_implicit(old: &[ProfileMod], mut new: Vec<ProfileMod>) -> Vec<ProfileMod> {
    let explicit: HashSet<String> = new.iter().map(ProfileMod::id).collect();
    new.extend(old.iter().filter(|m| m.implicit && !explicit.contains(&m.id())).cloned());
    new
}

#[tauri::command]
pub async fn set_mod_enabled(ctx: State<'_, AppCtx>, profile: String, id: String, enabled: bool) -> Result<AppState> {
    let guard = ctx.sync.lock.lock().await;
    let mut p = profiles::load(&ctx.paths, &profile)?;
    let m = p.mods.iter_mut().find(|m| m.id() == id).ok_or_else(|| AppError::NotFound(format!("{id} is not in the profile.")))?;
    m.enabled = enabled;
    profiles::save(&ctx.paths, &p)?;
    if let Some(entry) = profiles::load_installed(&ctx.paths, &profile).get(&id) {
        install::set_enabled(&ctx.paths.profile_dir(&profile), &entry.files, enabled)?;
    }
    drop(guard);
    build_state(&ctx)
}

#[tauri::command]
pub fn repair_profile(app: AppHandle, ctx: State<'_, AppCtx>, profile: String) -> Result<AppState> {
    profiles::load(&ctx.paths, &profile)?;
    request_sync(&app, &profile, true);
    build_state(&ctx)
}

#[tauri::command]
pub async fn add_local_mods(app: AppHandle, ctx: State<'_, AppCtx>, profile: String, paths: Vec<String>) -> Result<AppState> {
    let guard = ctx.sync.lock.lock().await;
    let mut p = profiles::load(&ctx.paths, &profile)?;
    let mut installed = profiles::load_installed(&ctx.paths, &profile);
    let dir = ctx.paths.profile_dir(&profile);
    for src in &paths {
        let m = localmod::import_local(&ctx.paths, &profile, Path::new(src))?;
        let id = m.id();
        // New file → drop the old installation so the sync installs it fresh.
        if let Some(old) = installed.remove(&id) {
            install::remove_files(&dir, &old.files)?;
        }
        match p.mods.iter_mut().find(|x| x.id() == id) {
            Some(x) => *x = m,
            None => p.mods.push(m),
        }
    }
    profiles::save_installed(&ctx.paths, &profile, &installed)?;
    profiles::save(&ctx.paths, &p)?;
    drop(guard);
    request_sync(&app, &profile, false);
    build_state(&ctx)
}

// ---- Sharing ----

/// `install_all`: enable every imported mod and start the sync right away. Otherwise the profile is
/// created as exported and nothing is downloaded until the user asks (readiness banner).
fn finish_import(app: &AppHandle, ctx: &AppCtx, contents: share::R2zContents, name: &str, with_configs: bool, install_all: bool) -> Result<ImportResponse> {
    let imported = share::apply_import(&ctx.paths, name, contents, with_configs, install_all)?;
    profiles::set_active(&ctx.paths, &imported.name)?;
    if install_all {
        request_sync(app, &imported.name, false);
    }
    Ok(ImportResponse { state: build_state(ctx)?, imported })
}

fn import_bytes(app: &AppHandle, ctx: &AppCtx, bytes: &[u8], name: &str, with_configs: bool, install_all: bool) -> Result<ImportResponse> {
    finish_import(app, ctx, share::read_r2z(bytes)?, name, with_configs, install_all)
}

#[tauri::command]
pub async fn import_profile_code(
    app: AppHandle,
    ctx: State<'_, AppCtx>,
    code: String,
    name: String,
    with_configs: bool,
    install_all: bool,
) -> Result<ImportResponse> {
    let bytes = share::fetch_code(&ctx.client, &code).await?;
    import_bytes(&app, &ctx, &bytes, &name, with_configs, install_all)
}

#[tauri::command]
pub fn import_profile_file(
    app: AppHandle,
    ctx: State<'_, AppCtx>,
    path: String,
    name: String,
    with_configs: bool,
    install_all: bool,
) -> Result<ImportResponse> {
    let bytes = std::fs::read(&path)?;
    import_bytes(&app, &ctx, &bytes, &name, with_configs, install_all)
}

/// Deep link / companion landing page: download the server's .r2z, import it, remember the server.
#[tauri::command]
pub async fn import_profile_url(
    app: AppHandle,
    ctx: State<'_, AppCtx>,
    url: String,
    name: String,
    with_configs: bool,
    install_all: bool,
    link: Option<ServerLink>,
) -> Result<ImportResponse> {
    let bytes = server::fetch_bytes(&ctx.client, &url).await?;
    let mut r = import_bytes(&app, &ctx, &bytes, &name, with_configs, install_all)?;
    if let Some(link) = link {
        let mut p = profiles::load(&ctx.paths, &r.imported.name)?;
        p.server = Some(ServerLink {
            url: server::normalize_url(&link.url)?,
            name: link.name,
            token: link.token.filter(|t| !t.trim().is_empty()),
            ..Default::default()
        });
        profiles::save(&ctx.paths, &p)?;
        r.state = build_state(&ctx)?;
    }
    Ok(r)
}

// ---- Linked server (companion) ----

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerCheck {
    reachable: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
    name: String,
    world: String,
    in_sync: bool,
    diff: ServerDiff,
    server_mods: usize,
    /// Config files the server knows, the manifest hash and its timestamp (for display).
    server_configs: usize,
    hash: String,
    generated_at: i64,
    /// Companion switches, e.g. `publish: false` when the admin turned publishing off.
    features: BTreeMap<String, bool>,
    /// A staged release waiting to be applied on the server.
    release: Option<ReleaseSummary>,
    /// Players online according to the server log; None when unknown.
    online: Option<usize>,
    /// Gist links: server config files that differ from the profile's (relative to BepInEx/config).
    configs_changed: Vec<String>,
    /// Gist links: what became of the last published release.
    gist_release: Option<gistsync::ReleaseStatus>,
}

fn unreachable_check(link: &ServerLink, e: AppError) -> ServerCheck {
    ServerCheck {
        reachable: false,
        error: Some(e.to_string()),
        name: link.name.clone(),
        world: String::new(),
        in_sync: false,
        diff: ServerDiff::default(),
        server_mods: 0,
        server_configs: 0,
        hash: String::new(),
        generated_at: 0,
        features: BTreeMap::new(),
        release: None,
        online: None,
        configs_changed: vec![],
        gist_release: None,
    }
}

/// The gist behind a link, when it has a sync code.
fn gist_of(ctx: &AppCtx, link: &ServerLink) -> Result<Option<(gistsync::GistMailbox, gistsync::Key)>> {
    let Some(code) = link.sync_code.as_deref() else { return Ok(None) };
    let code = gistsync::parse_sync_code(code)?;
    let key = gistsync::derive_key(&code.secret)?;
    Ok(Some((gistsync::GistMailbox::new(ctx.client.clone(), &code.gist_id, link.gist_token.clone(), ctx.gist_cache.clone()), key)))
}

/// Config files in server.json whose content differs from the profile's copy (or is missing there).
fn configs_changed(ctx: &AppCtx, profile: &str, configs: &[server::PublishConfig]) -> Vec<String> {
    let dir = ctx.paths.config_dir(profile);
    configs
        .iter()
        .filter(|c| {
            let Some(remote) = server::decode_config(c) else { return true };
            crate::util::safe_join(&dir, &c.path).ok().and_then(|p| std::fs::read(p).ok()).as_deref() != Some(remote.as_slice())
        })
        .map(|c| c.path.clone())
        .collect()
}

/// Gist transport of check_link: server.json instead of /api/manifest + /api/status.
async fn check_gist(ctx: &AppCtx, profile: &str, link: &ServerLink, m: &gistsync::GistMailbox, key: &gistsync::Key) -> ServerCheck {
    let index = match ctx.ensure_index().await {
        Ok(i) => i,
        Err(e) => return unreachable_check(link, e),
    };
    let (p, installed) = match profiles::load(&ctx.paths, profile) {
        Ok(p) => (p, profiles::load_installed(&ctx.paths, profile)),
        Err(e) => return unreachable_check(link, e),
    };
    let plan = resolver::plan(&server_mods(&p), &index.by_id, &installed);
    let s = match gistsync::read_server(m, key).await {
        Ok(Some(s)) => s,
        Ok(None) => return unreachable_check(link, AppError::Network("The server has not written to the gist yet.".into())),
        Err(e) => return unreachable_check(link, e),
    };
    let manifest = s.manifest.unwrap_or_default();
    let diff = server::diff(&p, &plan.resolved, &manifest.mods);
    let changed = configs_changed(ctx, profile, &s.configs);
    // Mods and versions must match. Configs are the server's business: synced mods hand them to the
    // client at join, and a profile created from the server took the rest once (see adopt_server).
    let in_sync = server::in_sync(&diff, server::is_admin(link));
    ServerCheck {
        reachable: true,
        error: None,
        name: s.server.name,
        world: s.server.world,
        in_sync,
        diff,
        server_mods: manifest.mods.len(),
        server_configs: s.configs.len(),
        hash: manifest.hash,
        generated_at: manifest.generated_at,
        features: BTreeMap::from([("publish".to_string(), true)]),
        release: None,
        online: None,
        configs_changed: changed,
        gist_release: s.release,
    }
}

fn link_of(ctx: &AppCtx, profile: &str) -> Result<ServerLink> {
    profiles::load(&ctx.paths, profile)?.server.ok_or_else(|| AppError::Invalid("This profile is not linked to a server.".into()))
}

/// `link = None` unlinks. Tokens are kept when the new link carries none. A sync code (`vmm1.…`) links
/// through the gist; the URL may then be empty.
#[tauri::command]
pub fn set_server_link(ctx: State<'_, AppCtx>, profile: String, link: Option<ServerLink>) -> Result<AppState> {
    let mut p = profiles::load(&ctx.paths, &profile)?;
    p.server = link.map(|l| merge_link(p.server.as_ref(), l)).transpose()?;
    profiles::save(&ctx.paths, &p)?;
    build_state(&ctx)
}

/// The invite for a gist-linked profile: the server's sync code and name, nothing else (no companion address, no
/// token). Whoever opens it links read-only through the gist; the code cannot write to it.
#[tauri::command]
pub fn invite_link(ctx: State<'_, AppCtx>, profile: String) -> Result<String> {
    let link = link_of(&ctx, &profile)?;
    let code = link.sync_code.as_deref().ok_or_else(|| AppError::Invalid("This profile is not linked through a sync code.".into()))?;
    let name = if link.name.trim().is_empty() { profile.as_str() } else { link.name.trim() };
    Ok(invite_url(code, name))
}

/// `valheim-mod-manager://import?code=…&name=…`, percent-encoded like `encodeURIComponent`.
pub fn invite_url(code: &str, name: &str) -> String {
    fn enc(s: &str) -> String {
        let mut out = String::with_capacity(s.len());
        for b in s.bytes() {
            match b {
                b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'!' | b'~' | b'*' | b'\'' | b'(' | b')' => out.push(b as char),
                _ => out.push_str(&format!("%{b:02X}")),
            }
        }
        out
    }
    format!("valheim-mod-manager://import?code={}&name={}", enc(code), enc(name))
}

/// What the server should run: the profile without its disabled mods (and whatever only they pulled in).
fn server_mods(p: &Profile) -> Vec<ProfileMod> {
    p.mods.iter().filter(|m| m.enabled).cloned().collect()
}

/// The new link over the old one. A sync code is recognised wherever and however it was pasted (address,
/// token or sync-code field, alone or inside a URL); with one, the URL is dropped. Tokens survive an edit
/// that leaves them blank, and `last_adopted` survives as long as the gist stays the same.
fn merge_link(old: Option<&ServerLink>, l: ServerLink) -> Result<ServerLink> {
    let blank = |s: &Option<String>| !s.as_deref().is_some_and(|t| !t.trim().is_empty());
    let (raw_url, raw_code, raw_token) = if let Some(c) = gistsync::find_sync_code(&l.url) {
        (String::new(), Some(c), l.token)
    } else if let Some(c) = l.token.as_deref().and_then(gistsync::find_sync_code).filter(|_| blank(&l.sync_code)) {
        (l.url, Some(c), None)
    } else {
        (l.url, l.sync_code, l.token)
    };
    let sync_code = raw_code
        .filter(|c| !c.trim().is_empty())
        .map(|c| gistsync::find_sync_code(&c).ok_or_else(|| AppError::Invalid("That is not a sync code (vmm1.<gist id>.<secret>).".into())))
        .transpose()?;
    // The admin's gist token may land in the token field as well; with a sync code it is the gist token.
    let (raw_token, raw_gist_token) = if sync_code.is_some() && blank(&l.gist_token) { (None, raw_token) } else { (raw_token, l.gist_token) };
    let keep = |new: Option<String>, old: Option<&String>| new.filter(|t| !t.trim().is_empty()).or_else(|| old.cloned());
    let token = keep(raw_token, old.and_then(|s| s.token.as_ref()));
    let gist_token = keep(raw_gist_token, old.and_then(|s| s.gist_token.as_ref()));
    // One transport per link: with a sync code the gist is the server, a leftover URL would only confuse.
    let url = if sync_code.is_some() { String::new() } else { server::normalize_url(&raw_url)? };
    let same_gist = old.is_some_and(|s| s.sync_code == sync_code);
    let last_adopted = if same_gist { old.and_then(|s| s.last_adopted.clone()) } else { None };
    Ok(ServerLink { url, name: l.name, token, sync_code, gist_token, last_adopted })
}

/// Compares the local resolved plan with the server manifest. Unreachable servers are reported, not errors.
async fn check_link(ctx: &AppCtx, profile: &str) -> Result<ServerCheck> {
    let link = link_of(ctx, profile)?;
    if let Some((m, key)) = gist_of(ctx, &link)? {
        return Ok(check_gist(ctx, profile, &link, &m, &key).await);
    }
    let index = ctx.ensure_index().await?;
    let p = profiles::load(&ctx.paths, profile)?;
    let plan = resolver::plan(&server_mods(&p), &index.by_id, &profiles::load_installed(&ctx.paths, profile));
    let quick = thunderstore::http_client(Duration::from_secs(2), Duration::from_secs(4))?;
    match server::fetch_manifest(&quick, &link).await {
        Ok(m) => {
            let diff = server::diff(&p, &plan.resolved, &m.mods);
            let status = server::fetch_status(&quick, &link).await.unwrap_or_default();
            Ok(ServerCheck {
                reachable: true,
                error: None,
                name: m.server.name,
                world: m.server.world,
                in_sync: server::in_sync(&diff, server::is_admin(&link)),
                diff,
                server_mods: m.mods.len(),
                server_configs: m.configs.len(),
                hash: m.hash,
                generated_at: m.generated_at,
                features: m.features,
                release: status.release,
                online: status.online,
                configs_changed: vec![],
                gist_release: None,
            })
        }
        Err(e) => Ok(unreachable_check(&link, e)),
    }
}

#[tauri::command]
pub async fn check_server(ctx: State<'_, AppCtx>, profile: String) -> Result<ServerCheck> {
    check_link(&ctx, &profile).await
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileServerCheck {
    profile: String,
    check: ServerCheck,
}

/// App start: every linked profile is compared with its server, so "new versions" shows up before Play.
#[tauri::command]
pub async fn check_all_servers(ctx: State<'_, AppCtx>) -> Result<Vec<ProfileServerCheck>> {
    let linked: Vec<String> =
        profiles::list(&ctx.paths).into_iter().filter(|n| profiles::load(&ctx.paths, n).ok().is_some_and(|p| p.server.is_some())).collect();
    let checks = futures::future::join_all(linked.iter().map(|n| check_link(&ctx, n))).await;
    Ok(linked.into_iter().zip(checks).filter_map(|(profile, c)| c.ok().map(|check| ProfileServerCheck { profile, check })).collect())
}

/// "Autoconfig": anything that points at a companion becomes a link candidate. The companion is the only
/// source of its sync code: a pasted code is used as is, an address is asked for one (`/api/sync`), and
/// only a companion without the gist sync is linked over HTTP.
#[tauri::command]
pub async fn discover_server(ctx: State<'_, AppCtx>, url: String) -> Result<server::Discovery> {
    let quick = thunderstore::http_client(Duration::from_secs(3), Duration::from_secs(6))?;
    let code = match gistsync::find_sync_code(&url) {
        Some(c) => Some(c),
        None => match server::guess_base(&url) {
            Ok(base) => server::fetch_sync_code(&quick, &base).await,
            Err(_) => None,
        },
    };
    if let Some(code) = code {
        let parsed = gistsync::parse_sync_code(&code)?;
        let link = ServerLink { sync_code: Some(code.clone()), ..Default::default() };
        let (m, key) = gist_of(&ctx, &link)?.ok_or_else(|| AppError::Invalid("That is not a sync code.".into()))?;
        let s = gistsync::read_server(&m, &key).await?.ok_or_else(|| AppError::Network("The server has not written to the gist yet.".into()))?;
        let mods = s.manifest.as_ref().map_or(0, |m| m.mods.iter().filter(|x| !server::is_pack(&x.id)).count());
        let features = BTreeMap::from([("publish".to_string(), true)]);
        let gist = Some(parsed.gist_id.chars().take(8).collect());
        return Ok(server::Discovery { url: String::new(), sync_code: Some(code), gist, name: s.server.name, world: s.server.world, mods, features });
    }
    server::discover(&quick, &url).await
}

/// Rewrites the profile (or a fresh clone named `into_new`) to the server manifest, every entry explicit and
/// pinned, optionally with the server's config files, then syncs. The clone becomes the active profile.
/// `install = Some(false)` rewrites the profile and links it but starts no download yet ("Add server…"
/// without "install all"); the default installs right away.
#[tauri::command]
pub async fn adopt_server(
    app: AppHandle,
    ctx: State<'_, AppCtx>,
    profile: String,
    with_configs: bool,
    into_new: Option<String>,
    install: Option<bool>,
) -> Result<AppState> {
    let link = link_of(&ctx, &profile)?;
    // (server info, mods, config files, what to remember as adopted)
    let (info, mods, configs, adopted) = match gist_of(&ctx, &link)? {
        Some((m, key)) => {
            let s = gistsync::read_server(&m, &key).await?.ok_or_else(|| AppError::Network("The server has not written to the gist yet.".into()))?;
            // No lock yet (a companion before its first release) is not "the server runs nothing": adopting
            // that would uninstall every server mod.
            let manifest = s.manifest.ok_or_else(|| AppError::Invalid("The server has not published a mod list yet.".into()))?;
            let adopted = format!("{}:{}", manifest.hash, gistsync::config_hash(&s.configs));
            let configs = if with_configs { s.configs.iter().filter_map(|c| server::decode_config(c).map(|b| (c.path.clone(), b))).collect() } else { vec![] };
            (s.server, manifest.mods, configs, adopted)
        }
        None => {
            let m = server::fetch_manifest(&ctx.client, &link).await?;
            let configs = if with_configs {
                let bytes = server::fetch_bytes(&ctx.client, &format!("{}/api/profile.r2z", server::normalize_url(&link.url)?)).await?;
                share::read_r2z(&bytes)?.configs
            } else {
                vec![]
            };
            let adopted = server::adopted_stamp(&m.hash, &m.configs);
            (m.server, m.mods, configs, adopted)
        }
    };
    let guard = ctx.sync.lock.lock().await;
    let target = match into_new {
        Some(name) => {
            let name = profiles::unique_name(&ctx.paths, &name);
            let name = profiles::clone_profile(&ctx.paths, &profile, &name)?;
            profiles::set_active(&ctx.paths, &name)?;
            name
        }
        None => profile,
    };
    // Undo path: the previous mod list and configs survive in <profile>/.snapshots/.
    profiles::snapshot(&ctx.paths, &target, "adopt-server")?;
    let mut p = profiles::load(&ctx.paths, &target)?;
    server::adopt(&mut p, &mods);
    if let Some(s) = p.server.as_mut() {
        if !info.name.is_empty() {
            s.name = info.name.clone();
        }
        s.last_adopted = Some(adopted);
    }
    profiles::save(&ctx.paths, &p)?;
    let dir = ctx.paths.config_dir(&target);
    for (rel, bytes) in configs {
        let Ok(dest) = crate::util::safe_join(&dir, &rel) else { continue };
        std::fs::create_dir_all(dest.parent().unwrap())?;
        std::fs::write(dest, bytes)?;
    }
    drop(guard);
    if install.unwrap_or(true) {
        request_sync(&app, &target, false);
    }
    build_state(&ctx)
}

/// Stages the local resolved plan (and optionally the profile's config files) on the server. Nothing
/// changes live until `apply_release`; players are never kicked by a publish.
#[tauri::command]
pub async fn publish_profile(ctx: State<'_, AppCtx>, profile: String, with_configs: bool) -> Result<StageResponse> {
    let link = link_of(&ctx, &profile)?;
    if link.sync_code.is_some() {
        return Err(AppError::Invalid("This profile syncs through a gist; use publish_gist.".into()));
    }
    let index = ctx.ensure_index().await?;
    let p = profiles::load(&ctx.paths, &profile)?;
    let plan = resolver::plan(&server_mods(&p), &index.by_id, &profiles::load_installed(&ctx.paths, &profile));
    if !plan.errors.is_empty() {
        return Err(AppError::Invalid(format!("The profile cannot be resolved: {}", plan.errors.join("; "))));
    }
    let (mods, skipped_local) = server::manifest_mods(&p, &plan.resolved, &index.by_id);
    let mut configs = vec![];
    if with_configs {
        let dir = ctx.paths.config_dir(&profile);
        for rel in config::list_files_with_ext(&dir, &share::CONFIG_EXTS) {
            configs.push(server::encode_config(&rel, &std::fs::read(crate::util::safe_join(&dir, &rel)?)?));
        }
    }
    let slow = thunderstore::http_client(Duration::from_secs(10), Duration::from_secs(600))?;
    let mut r = server::stage(&slow, &link, &server::StageBody { mods, configs }).await?;
    r.skipped_local = skipped_local;
    Ok(r)
}

/// Gist transport of publish + apply in one step: seals release.json (lock, configs, `when`) into the gist.
/// The companion picks it up on its next poll and reports back through server.json (`gist_release`).
#[tauri::command]
pub async fn publish_gist(ctx: State<'_, AppCtx>, profile: String, with_configs: bool, when: String, at: Option<i64>) -> Result<GistPublishResult> {
    let link = link_of(&ctx, &profile)?;
    let (m, key) = gist_of(&ctx, &link)?.ok_or_else(|| AppError::Invalid("This profile is not linked through a sync code.".into()))?;
    if !matches!(when.as_str(), "now" | "idle" | "at" | "none") || (when == "at" && at.is_none()) {
        return Err(AppError::Invalid("apply must be now, idle, at (with a time) or none.".into()));
    }
    let index = ctx.ensure_index().await?;
    let p = profiles::load(&ctx.paths, &profile)?;
    let plan = resolver::plan(&server_mods(&p), &index.by_id, &profiles::load_installed(&ctx.paths, &profile));
    if !plan.errors.is_empty() {
        return Err(AppError::Invalid(format!("The profile cannot be resolved: {}", plan.errors.join("; "))));
    }
    let (mods, skipped_local) = server::manifest_mods(&p, &plan.resolved, &index.by_id);
    let mut configs = vec![];
    if with_configs {
        let dir = ctx.paths.config_dir(&profile);
        for rel in config::list_files_with_ext(&dir, &share::CONFIG_EXTS) {
            configs.push(server::encode_config(&rel, &std::fs::read(crate::util::safe_join(&dir, &rel)?)?));
        }
    }
    let rel = gistsync::ReleaseFile {
        v: 1,
        id: gistsync::new_release_id(),
        created_at: crate::util::now_ms(),
        message: Some(format!("Valheim Mod Manager: profile {profile}")),
        mods,
        configs,
        apply: gistsync::Apply { when, at },
    };
    gistsync::publish_release(&m, &key, &rel).await?;
    Ok(GistPublishResult { id: rel.id, skipped_local })
}

/// `when`: "now" (stop, backup, install, start), "idle" (when nobody is online), "at" (+ `at` ms), "none".
#[tauri::command]
pub async fn apply_release(ctx: State<'_, AppCtx>, profile: String, id: String, when: String, at: Option<i64>) -> Result<ApplyResponse> {
    let link = link_of(&ctx, &profile)?;
    let slow = thunderstore::http_client(Duration::from_secs(10), Duration::from_secs(600))?;
    server::apply(&slow, &link, &id, &when, at).await
}

#[tauri::command]
pub async fn discard_release(ctx: State<'_, AppCtx>, profile: String, id: String) -> Result<()> {
    let link = link_of(&ctx, &profile)?;
    server::discard(&ctx.client, &link, &id).await
}

#[tauri::command]
pub fn list_foreign_profiles(ctx: State<'_, AppCtx>) -> Result<Vec<ForeignProfile>> {
    let roaming = std::env::var_os("APPDATA").map(PathBuf::from).or_else(|| ctx.paths.root.parent().map(Path::to_path_buf));
    Ok(roaming.map(|r| migrate::candidates(&r)).unwrap_or_default())
}

#[tauri::command]
pub fn import_foreign_profile(
    app: AppHandle,
    ctx: State<'_, AppCtx>,
    path: String,
    name: String,
    with_configs: bool,
    install_all: bool,
) -> Result<ImportResponse> {
    finish_import(&app, &ctx, migrate::read_profile(Path::new(&path))?, &name, with_configs, install_all)
}

#[tauri::command]
pub async fn export_profile_code(ctx: State<'_, AppCtx>, profile: String) -> Result<ExportResult> {
    let p = profiles::load(&ctx.paths, &profile)?;
    let (bytes, skipped_local) = share::build_r2z(&p, &ctx.paths.config_dir(&profile), ctx.index.get().as_deref().map(|i| &i.by_id))?;
    let code = share::upload_code(&ctx.client, bytes).await?;
    Ok(ExportResult { code: Some(code), skipped_local })
}

#[tauri::command]
pub fn export_profile_file(ctx: State<'_, AppCtx>, profile: String, path: String) -> Result<ExportResult> {
    let p = profiles::load(&ctx.paths, &profile)?;
    let (bytes, skipped_local) = share::build_r2z(&p, &ctx.paths.config_dir(&profile), ctx.index.get().as_deref().map(|i| &i.by_id))?;
    std::fs::write(&path, bytes)?;
    Ok(ExportResult { code: None, skipped_local })
}

// ---- Game & settings ----

#[tauri::command]
pub async fn launch_game(ctx: State<'_, AppCtx>, modded: bool) -> Result<()> {
    let game = ctx.game();
    let dir = game.valheim_dir.map(PathBuf::from).filter(|d| game::is_valheim_dir(d)).ok_or(AppError::GameNotFound)?;
    let steam = game
        .steam_exe
        .map(PathBuf::from)
        .filter(|p| p.is_file())
        .ok_or_else(|| AppError::Invalid("steam.exe was not found. Set it in the settings.".into()))?;
    let _guard = ctx.sync.lock.lock().await; // wait for a running installation
    let args = if modded {
        let name = ctx.active()?;
        let doorstop = ctx.paths.doorstop_dir(&name);
        let ini = std::fs::read_to_string(doorstop.join("doorstop_config.ini"))
            .map_err(|_| AppError::Invalid("BepInEx is not installed in this profile yet. Add a mod and wait for the installation to finish.".into()))?;
        game::sync_doorstop(&doorstop, &dir)?;
        let profile_dir = ctx.paths.profile_dir(&name);
        let has_corlib = profile_dir.join("unstripped_corlib").is_dir();
        game::launch_args(game::doorstop_version(&ini), Some(&profile_dir), has_corlib)
    } else {
        match std::fs::read_to_string(dir.join("doorstop_config.ini")) {
            Ok(ini) => game::launch_args(game::doorstop_version(&ini), None, false),
            Err(_) => vec![],
        }
    };
    game::launch(&steam, &args)
}

#[tauri::command]
pub fn get_settings(ctx: State<'_, AppCtx>) -> Result<Settings> {
    Ok(ctx.settings.read().unwrap().clone())
}

#[tauri::command]
pub fn save_settings(ctx: State<'_, AppCtx>, settings: Settings) -> Result<Settings> {
    let saved = settings::save(&ctx.paths, &settings)?;
    *ctx.settings.write().unwrap() = saved.clone();
    Ok(saved)
}

#[tauri::command]
pub fn detect_game(ctx: State<'_, AppCtx>) -> Result<GameInfo> {
    let detected = game::detect();
    *ctx.detected.write().unwrap() = detected.clone();
    Ok(detected)
}

#[tauri::command]
pub async fn clear_download_cache(ctx: State<'_, AppCtx>) -> Result<u64> {
    let _guard = ctx.sync.lock.lock().await;
    let mut freed = 0;
    for e in std::fs::read_dir(ctx.paths.downloads())?.flatten() {
        let meta = e.metadata()?;
        if meta.is_file() {
            std::fs::remove_file(e.path())?;
            freed += meta.len();
        }
    }
    Ok(freed)
}

#[tauri::command]
pub fn open_folder(app: AppHandle, ctx: State<'_, AppCtx>, kind: String) -> Result<()> {
    let path = match kind.as_str() {
        "profile" => ctx.paths.profile_dir(&ctx.active()?),
        "config" => {
            let p = ctx.paths.config_dir(&ctx.active()?);
            std::fs::create_dir_all(&p)?;
            p
        }
        "game" => ctx.game().valheim_dir.map(PathBuf::from).ok_or(AppError::GameNotFound)?,
        "data" => ctx.paths.root.clone(),
        _ => return Err(AppError::Invalid(format!("Unknown folder: {kind}"))),
    };
    app.opener().open_path(path.to_string_lossy().to_string(), None::<&str>).map_err(|e| AppError::Invalid(format!("Folder could not be opened: {e}")))
}

// ---- Configs ----

#[tauri::command]
pub fn list_config_files(ctx: State<'_, AppCtx>) -> Result<Vec<String>> {
    Ok(config::list_files(&ctx.paths.config_dir(&ctx.active()?)))
}

#[tauri::command]
pub fn get_config_file(ctx: State<'_, AppCtx>, file: String) -> Result<ParsedConfig> {
    config::parse_file(&ctx.paths.config_dir(&ctx.active()?), &file)
}

#[tauri::command]
pub fn save_config_file(ctx: State<'_, AppCtx>, file: String, changes: Vec<ConfigChange>) -> Result<()> {
    config::save_changes(&ctx.paths.config_dir(&ctx.active()?), &file, &changes)
}

// ---- Log ----

#[tauri::command]
pub fn start_log_tail(app: AppHandle, ctx: State<'_, AppCtx>) -> Result<Vec<String>> {
    let path = ctx.paths.log_file(&ctx.active()?);
    let (lines, mut offset) = logs::read_last_lines(&path, 2000);
    let emitter = app.clone();
    let handle = tauri::async_runtime::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_millis(500));
        loop {
            interval.tick().await;
            if let Some(chunk) = logs::poll(&path, &mut offset) {
                let _ = emitter.emit("log://lines", chunk);
            }
        }
    });
    if let Some(old) = ctx.log_tail.lock().unwrap().replace(handle) {
        old.abort();
    }
    Ok(lines)
}

#[tauri::command]
pub fn stop_log_tail(ctx: State<'_, AppCtx>) -> Result<()> {
    if let Some(h) = ctx.log_tail.lock().unwrap().take() {
        h.abort();
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn set_mods_carries_the_servers_dependencies_over() {
        let dep = |id: &str, v: &str| {
            let (ns, n) = id.split_once('-').unwrap();
            ProfileMod { implicit: true, ..ProfileMod::thunderstore(ns, n, v) }
        };
        let old = vec![ProfileMod::thunderstore("a", "A", "1.0.0"), dep("b-B", "1.0.0"), dep("c-C", "3.0.0")];
        let ids = |mods: &[ProfileMod]| mods.iter().map(|m| (m.id(), m.version.clone(), m.implicit)).collect::<Vec<_>>();

        // The UI re-sends what it shows (a-A only): the server's dependencies stay pinned as they are.
        let kept = merge_implicit(&old, vec![ProfileMod::thunderstore("a", "A", "1.0.0")]);
        assert_eq!(ids(&kept), vec![("a-A".into(), "1.0.0".into(), false), ("b-B".into(), "1.0.0".into(), true), ("c-C".into(), "3.0.0".into(), true)]);
        // a-A removed: what the server runs is still what this profile follows.
        assert_eq!(ids(&merge_implicit(&old, vec![])), vec![("b-B".into(), "1.0.0".into(), true), ("c-C".into(), "3.0.0".into(), true)]);
        // The player picks b-B themselves: their explicit entry replaces the implicit one.
        let picked = merge_implicit(&old, vec![ProfileMod::thunderstore("b", "B", "2.0.0")]);
        assert_eq!(ids(&picked), vec![("b-B".into(), "2.0.0".into(), false), ("c-C".into(), "3.0.0".into(), true)]);
    }

    const CODE: &str = "vmm1.5f2964a03b693a8655578dfdcbd4b6b6.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

    #[test]
    fn invite_carries_only_code_and_name() {
        let u = invite_url("vmm1.5f2964a03b693a8655578dfdcbd4b6b6.4okNMk4QDw6NEzsno2auxfX_CZ3Xs-XnfjeD0LCFp-M", "Peters Welte & Co");
        assert_eq!(u, "valheim-mod-manager://import?code=vmm1.5f2964a03b693a8655578dfdcbd4b6b6.4okNMk4QDw6NEzsno2auxfX_CZ3Xs-XnfjeD0LCFp-M&name=Peters%20Welte%20%26%20Co");
        assert!(!u.contains("http"));
    }

    fn link(url: &str, token: Option<&str>, code: Option<&str>, gist_token: Option<&str>) -> ServerLink {
        ServerLink {
            url: url.into(),
            name: "n".into(),
            token: token.map(String::from),
            sync_code: code.map(String::from),
            gist_token: gist_token.map(String::from),
            last_adopted: None,
        }
    }

    #[test]
    fn disabled_mods_are_not_the_servers_business() {
        let p = Profile {
            mods: vec![ProfileMod::thunderstore("a", "A", "1.0.0"), ProfileMod { enabled: false, ..ProfileMod::thunderstore("b", "B", "1.0.0") }],
            ..Default::default()
        };
        assert_eq!(server_mods(&p).iter().map(ProfileMod::id).collect::<Vec<_>>(), ["a-A"]);
    }

    #[test]
    fn a_sync_code_is_recognised_in_any_field() {
        let in_url = format!("http://127.0.0.1:9002/{CODE}");
        for l in [
            link(CODE, Some("ghp_x"), None, None),
            link(&in_url, Some("ghp_x"), None, None),
            link("", Some(CODE), None, Some("ghp_x")),
            link("", Some(&in_url), None, Some("ghp_x")),
            link("", None, Some(CODE), Some("ghp_x")),
            link("http://127.0.0.1:9002", Some(CODE), None, Some("ghp_x")),
        ] {
            let m = merge_link(None, l).unwrap();
            assert_eq!(m.sync_code.as_deref(), Some(CODE));
            assert_eq!(m.gist_token.as_deref(), Some("ghp_x"), "the token goes with the gist");
            assert_eq!(m.url, "", "a gist link has no URL");
            assert_eq!(m.token, None);
        }
    }

    #[test]
    fn http_links_still_need_a_url_and_keep_tokens_and_adoption() {
        assert!(merge_link(None, link("nope", None, None, None)).is_err());
        let old = ServerLink { last_adopted: Some("h:c".into()), ..link("http://h:1", Some("old"), None, None) };
        let m = merge_link(Some(&old), link("http://h:1/", Some(" "), None, None)).unwrap();
        assert_eq!((m.url.as_str(), m.token.as_deref(), m.sync_code), ("http://h:1", Some("old"), None));
        let old = ServerLink { last_adopted: Some("h:c".into()), ..link("", None, Some(CODE), Some("g")) };
        let same = merge_link(Some(&old), link("", None, Some(CODE), None)).unwrap();
        assert_eq!((same.gist_token.as_deref(), same.last_adopted.as_deref()), (Some("g"), Some("h:c")));
        let other = merge_link(Some(&old), link("http://h:1", None, None, None)).unwrap();
        assert_eq!((other.sync_code, other.last_adopted), (None, None));
    }
}
