//! Tauri commands: a thin facade over the core modules.
use crate::config::{self, ConfigChange, ParsedConfig};
use crate::error::{AppError, Result};
use crate::game::{self, GameInfo};
use crate::health::{self, HealthIssue};
use crate::install;
use crate::localmod;
use crate::logs;
use crate::migrate::{self, ForeignProfile};
use crate::models::{Pkg, Plan, ProfileMod, ServerLink, Source};
use crate::paths::Paths;
use crate::profiles;
use crate::resolver;
use crate::server::{self, ApplyResponse, ReleaseSummary, ServerDiff, StageResponse};
use crate::settings::{self, Settings};
use crate::share::{self, ImportSummary};
use crate::sync::{self, SyncHandle, SyncJob, SyncStatus};
use crate::thunderstore::{self, Index, IndexStore};
use serde::Serialize;
use std::collections::BTreeMap;
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
}

impl AppCtx {
    fn game(&self) -> GameInfo {
        game::resolve(&self.settings.read().unwrap(), &self.detected.read().unwrap())
    }

    fn active(&self) -> Result<String> {
        profiles::active(&self.paths).ok_or_else(|| AppError::Invalid("No active profile.".into()))
    }

    async fn ensure_index(&self) -> Result<Arc<Index>> {
        if let Some(i) = self.index.get() {
            return Ok(i);
        }
        let cache = self.paths.index_cache();
        if let Ok(Some(idx)) = tokio::task::spawn_blocking(move || thunderstore::load_cache(&cache)).await {
            self.index.set(idx);
        }
        if let Some(i) = self.index.get() {
            return Ok(i);
        }
        thunderstore::refresh(&self.index, &self.client, &self.paths.index_cache(), true).await?;
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
    data_dir: String,
}

/// The active profile's linked companion server, without the token.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerLinkInfo {
    url: String,
    name: String,
    has_token: bool,
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
    health: Vec<HealthIssue>,
    app: AppInfo,
}

fn build_state(ctx: &AppCtx) -> Result<AppState> {
    let active = profiles::active(&ctx.paths);
    let (mods, server) = match &active {
        Some(n) => {
            let p = profiles::load(&ctx.paths, n)?;
            let server = p.server.map(|s| ServerLinkInfo { has_token: s.token.as_deref().is_some_and(|t| !t.trim().is_empty()), url: s.url, name: s.name });
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
    let profile_mods =
        names.iter().filter_map(|n| profiles::load(&ctx.paths, n).ok().map(|p| (n.clone(), p.mods.iter().map(ProfileMod::id).collect()))).collect();
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
        health,
        app: AppInfo { version: env!("CARGO_PKG_VERSION"), portable: ctx.portable, data_dir: ctx.paths.root.to_string_lossy().to_string() },
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
        let ttl = ctx.settings.read().unwrap().index_ttl_minutes as i64 * 60_000;
        if ctx.index.age_ms().is_none_or(|age| age > ttl) {
            match thunderstore::refresh(&ctx.index, &ctx.client, &ctx.paths.index_cache(), false).await {
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
    thunderstore::refresh(&ctx.index, &ctx.client, &ctx.paths.index_cache(), true).await?;
    emit_index_updated(&app, &ctx);
    Ok(ctx.index.age_ms())
}

#[tauri::command]
pub async fn get_package(ctx: State<'_, AppCtx>, id: String) -> Result<Pkg> {
    let idx = ctx.ensure_index().await?;
    idx.by_id.get(&id).cloned().ok_or_else(|| AppError::NotFound(format!("Package {id} not found.")))
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
    p.mods = mods;
    profiles::save(&ctx.paths, &p)?;
    prune_local_copies(&ctx.paths, &profile, &p.mods);
    request_sync(&app, &profile, false);
    build_state(&ctx)
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

fn import_bytes(app: &AppHandle, ctx: &AppCtx, bytes: &[u8], name: &str, with_configs: bool) -> Result<ImportResponse> {
    let contents = share::read_r2z(bytes)?;
    let imported = share::apply_import(&ctx.paths, name, contents, with_configs)?;
    profiles::set_active(&ctx.paths, &imported.name)?;
    request_sync(app, &imported.name, false);
    Ok(ImportResponse { state: build_state(ctx)?, imported })
}

#[tauri::command]
pub async fn import_profile_code(app: AppHandle, ctx: State<'_, AppCtx>, code: String, name: String, with_configs: bool) -> Result<ImportResponse> {
    let bytes = share::fetch_code(&ctx.client, &code).await?;
    import_bytes(&app, &ctx, &bytes, &name, with_configs)
}

#[tauri::command]
pub fn import_profile_file(app: AppHandle, ctx: State<'_, AppCtx>, path: String, name: String, with_configs: bool) -> Result<ImportResponse> {
    let bytes = std::fs::read(&path)?;
    import_bytes(&app, &ctx, &bytes, &name, with_configs)
}

/// Deep link / companion landing page: download the server's .r2z, import it, remember the server.
#[tauri::command]
pub async fn import_profile_url(
    app: AppHandle,
    ctx: State<'_, AppCtx>,
    url: String,
    name: String,
    with_configs: bool,
    link: Option<ServerLink>,
) -> Result<ImportResponse> {
    let bytes = server::fetch_bytes(&ctx.client, &url).await?;
    let mut r = import_bytes(&app, &ctx, &bytes, &name, with_configs)?;
    if let Some(link) = link {
        let mut p = profiles::load(&ctx.paths, &r.imported.name)?;
        p.server = Some(ServerLink { url: server::normalize_url(&link.url)?, name: link.name, token: link.token.filter(|t| !t.trim().is_empty()) });
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
}

fn link_of(ctx: &AppCtx, profile: &str) -> Result<ServerLink> {
    profiles::load(&ctx.paths, profile)?.server.ok_or_else(|| AppError::Invalid("This profile is not linked to a server.".into()))
}

/// `link = None` unlinks. The token is kept when the new link carries none.
#[tauri::command]
pub fn set_server_link(ctx: State<'_, AppCtx>, profile: String, link: Option<ServerLink>) -> Result<AppState> {
    let mut p = profiles::load(&ctx.paths, &profile)?;
    p.server = match link {
        None => None,
        Some(l) => {
            let token = l.token.filter(|t| !t.trim().is_empty()).or_else(|| p.server.as_ref().and_then(|s| s.token.clone()));
            Some(ServerLink { url: server::normalize_url(&l.url)?, name: l.name, token })
        }
    };
    profiles::save(&ctx.paths, &p)?;
    build_state(&ctx)
}

/// Compares the local resolved plan with the server manifest. Unreachable servers are reported, not errors.
async fn check_link(ctx: &AppCtx, profile: &str) -> Result<ServerCheck> {
    let link = link_of(ctx, profile)?;
    let index = ctx.ensure_index().await?;
    let p = profiles::load(&ctx.paths, profile)?;
    let plan = resolver::plan(&p.mods, &index.by_id, &profiles::load_installed(&ctx.paths, profile));
    let quick = thunderstore::http_client(Duration::from_secs(2), Duration::from_secs(4))?;
    match server::fetch_manifest(&quick, &link).await {
        Ok(m) => {
            let diff = server::diff(&plan.resolved, &m.mods);
            let status = server::fetch_status(&quick, &link).await.unwrap_or_default();
            Ok(ServerCheck {
                reachable: true,
                error: None,
                name: m.server.name,
                world: m.server.world,
                in_sync: diff.is_empty(),
                diff,
                server_mods: m.mods.len(),
                server_configs: m.configs.len(),
                hash: m.hash,
                generated_at: m.generated_at,
                features: m.features,
                release: status.release,
                online: status.online,
            })
        }
        Err(e) => Ok(ServerCheck {
            reachable: false,
            error: Some(e.to_string()),
            name: link.name,
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
        }),
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

/// "Autoconfig": anything that points at a companion becomes a link candidate.
#[tauri::command]
pub async fn discover_server(_ctx: State<'_, AppCtx>, url: String) -> Result<server::Discovery> {
    let quick = thunderstore::http_client(Duration::from_secs(3), Duration::from_secs(6))?;
    server::discover(&quick, &url).await
}

/// Rewrites the profile (or a fresh clone named `into_new`) to the server manifest, every entry explicit and
/// pinned, optionally with the server's config files, then syncs. The clone becomes the active profile.
#[tauri::command]
pub async fn adopt_server(app: AppHandle, ctx: State<'_, AppCtx>, profile: String, with_configs: bool, into_new: Option<String>) -> Result<AppState> {
    let link = link_of(&ctx, &profile)?;
    let m = server::fetch_manifest(&ctx.client, &link).await?;
    let configs = if with_configs {
        let bytes = server::fetch_bytes(&ctx.client, &format!("{}/api/profile.r2z", server::normalize_url(&link.url)?)).await?;
        share::read_r2z(&bytes)?.configs
    } else {
        vec![]
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
    server::adopt(&mut p, &m.mods);
    if let Some(s) = p.server.as_mut() {
        if !m.server.name.is_empty() {
            s.name = m.server.name.clone();
        }
    }
    profiles::save(&ctx.paths, &p)?;
    let dir = ctx.paths.config_dir(&target);
    for (rel, bytes) in configs {
        let Ok(dest) = crate::util::safe_join(&dir, &rel) else { continue };
        std::fs::create_dir_all(dest.parent().unwrap())?;
        std::fs::write(dest, bytes)?;
    }
    drop(guard);
    request_sync(&app, &target, false);
    build_state(&ctx)
}

/// Stages the local resolved plan (and optionally the profile's config files) on the server. Nothing
/// changes live until `apply_release`; players are never kicked by a publish.
#[tauri::command]
pub async fn publish_profile(ctx: State<'_, AppCtx>, profile: String, with_configs: bool) -> Result<StageResponse> {
    let link = link_of(&ctx, &profile)?;
    let index = ctx.ensure_index().await?;
    let p = profiles::load(&ctx.paths, &profile)?;
    let plan = resolver::plan(&p.mods, &index.by_id, &profiles::load_installed(&ctx.paths, &profile));
    if !plan.errors.is_empty() {
        return Err(AppError::Invalid(format!("The profile cannot be resolved: {}", plan.errors.join("; "))));
    }
    let (mods, skipped_local) = server::manifest_mods(&p, &plan.resolved);
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
pub fn import_foreign_profile(app: AppHandle, ctx: State<'_, AppCtx>, path: String, name: String, with_configs: bool) -> Result<ImportResponse> {
    let contents = migrate::read_profile(Path::new(&path))?;
    let imported = share::apply_import(&ctx.paths, &name, contents, with_configs)?;
    profiles::set_active(&ctx.paths, &imported.name)?;
    request_sync(&app, &imported.name, false);
    Ok(ImportResponse { state: build_state(&ctx)?, imported })
}

#[tauri::command]
pub async fn export_profile_code(ctx: State<'_, AppCtx>, profile: String) -> Result<ExportResult> {
    let p = profiles::load(&ctx.paths, &profile)?;
    let (bytes, skipped_local) = share::build_r2z(&p, &ctx.paths.config_dir(&profile))?;
    let code = share::upload_code(&ctx.client, bytes).await?;
    Ok(ExportResult { code: Some(code), skipped_local })
}

#[tauri::command]
pub fn export_profile_file(ctx: State<'_, AppCtx>, profile: String, path: String) -> Result<ExportResult> {
    let p = profiles::load(&ctx.paths, &profile)?;
    let (bytes, skipped_local) = share::build_r2z(&p, &ctx.paths.config_dir(&profile))?;
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
