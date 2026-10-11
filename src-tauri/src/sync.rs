//! Brings a profile folder into the state described by profile.json.
use crate::error::{AppError, Result};
use crate::install;
use crate::models::{InstalledEntry, Source, ToInstall};
use crate::paths::Paths;
use crate::profiles;
use crate::resolver;
use crate::thunderstore::{download_url, Index};
use futures::StreamExt;
use serde::Serialize;
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tokio::io::AsyncWriteExt;

#[derive(Serialize, Clone, Debug)]
pub struct Progress {
    pub id: String,
    pub phase: &'static str,
    pub done: usize,
    pub total: usize,
}

#[derive(Serialize, Clone, Debug, Default)]
pub struct SyncResult {
    pub profile: String,
    pub installed: Vec<String>,
    pub removed: Vec<String>,
    pub errors: Vec<String>,
}

pub type ProgressFn = Arc<dyn Fn(Progress) + Send + Sync>;

pub struct SyncJob {
    pub paths: Paths,
    pub profile: String,
    pub index: Option<Arc<Index>>,
    pub client: reqwest::Client,
    pub concurrency: usize,
    pub repair: bool,
}

async fn download(client: &reqwest::Client, url: &str, dest: &Path) -> Result<()> {
    let res = client.get(url).send().await?;
    if !res.status().is_success() {
        return Err(AppError::Network(format!("HTTP {}", res.status())));
    }
    if let Some(parent) = dest.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }
    let mut part = dest.as_os_str().to_owned();
    part.push(".part");
    let part = PathBuf::from(part);
    let mut file = tokio::fs::File::create(&part).await?;
    let mut stream = res.bytes_stream();
    while let Some(chunk) = stream.next().await {
        file.write_all(&chunk?).await?;
    }
    file.flush().await?;
    drop(file);
    tokio::fs::rename(&part, dest).await?;
    Ok(())
}

pub async fn run_sync(job: SyncJob, progress: ProgressFn) -> Result<SyncResult> {
    let index = job.index.clone().ok_or_else(|| AppError::Invalid("The mod index is not loaded yet. Wait a moment and try again.".into()))?;
    let profile = profiles::load(&job.paths, &job.profile)?;
    let installed = profiles::load_installed(&job.paths, &job.profile);
    let plan = resolver::plan(&profile.mods, &index.by_id, &installed);

    // Never uninstall explicit mods that are not (yet) in the index.
    let explicit: HashSet<String> = profile.mods.iter().map(|m| m.id()).collect();
    let to_remove: Vec<String> = plan.to_remove.iter().filter(|id| !explicit.contains(*id)).cloned().collect();
    let to_install: Vec<ToInstall> = if job.repair {
        plan.resolved.iter().map(|(id, r)| ToInstall { id: id.clone(), from: installed.get(id).map(|e| e.version.clone()), to: r.version.clone() }).collect()
    } else {
        plan.to_install.clone()
    };
    let local: HashSet<String> = profile.mods.iter().filter(|m| m.source == Source::Local).map(|m| m.id()).collect();
    let disabled: HashSet<String> = profile.mods.iter().filter(|m| !m.enabled).map(|m| m.id()).collect();
    let mut result = SyncResult { profile: job.profile.clone(), errors: plan.errors.clone(), ..Default::default() };

    // 1) Downloads in parallel (network bound)
    let downloads: Vec<(String, String)> =
        to_install.iter().filter(|t| !local.contains(&t.id) && !job.paths.zip_cache(&t.id, &t.to).exists()).map(|t| (t.id.clone(), t.to.clone())).collect();
    let total = downloads.len();
    let mut stream = futures::stream::iter(downloads.into_iter().map(|(id, version)| {
        let client = job.client.clone();
        let pkg = index.by_id.get(&id).cloned();
        let dest = job.paths.zip_cache(&id, &version);
        async move {
            let r = match pkg {
                Some(p) => download(&client, &download_url(&p.ns, &p.name, &version), &dest).await,
                None => Err(AppError::NotFound(format!("{id} not in index"))),
            };
            (id, r)
        }
    }))
    .buffer_unordered(job.concurrency.max(1));
    let mut done = 0;
    while let Some((id, r)) = stream.next().await {
        done += 1;
        progress(Progress { id: id.clone(), phase: "download", done, total });
        if let Err(e) = r {
            result.errors.push(format!("Download failed ({id}): {e}"));
        }
    }
    drop(stream);

    // 2) + 3) Remove and extract sequentially (disk bound)
    let paths = job.paths.clone();
    let name = job.profile.clone();
    tokio::task::spawn_blocking(move || -> Result<SyncResult> {
        let dir = paths.profile_dir(&name);
        let mut installed = installed;
        let total = to_remove.len();
        for (i, id) in to_remove.iter().enumerate() {
            if let Some(entry) = installed.get(id) {
                match install::remove_files(&dir, &entry.files) {
                    Ok(()) => {
                        installed.remove(id);
                        result.removed.push(id.clone());
                    }
                    Err(e) => result.errors.push(format!("Uninstall failed ({id}): {e}")),
                }
            }
            progress(Progress { id: id.clone(), phase: "remove", done: i + 1, total });
        }
        let total = to_install.len();
        for (i, t) in to_install.iter().enumerate() {
            progress(Progress { id: t.id.clone(), phase: "extract", done: i + 1, total });
            let is_local = local.contains(&t.id);
            let zip = paths.zip_cache(&t.id, &t.to);
            let local_src = paths.local_dir(&name).join(&t.id);
            if (is_local && !local_src.is_dir()) || (!is_local && !zip.exists()) {
                if is_local {
                    result.errors.push(format!("Local files are missing ({})", t.id));
                }
                continue; // the download error was already recorded
            }
            if let Some(old) = installed.remove(&t.id) {
                if let Err(e) = install::remove_files(&dir, &old.files) {
                    result.errors.push(format!("Old version could not be removed ({}): {e}", t.id));
                    installed.insert(t.id.clone(), old);
                    continue;
                }
            }
            let files = if is_local { install::install_local(&local_src, &dir, &t.id) } else { install::extract_zip(&zip, &dir, &t.id) };
            match files {
                Ok(files) => {
                    if disabled.contains(&t.id) {
                        if let Err(e) = install::set_enabled(&dir, &files, false) {
                            result.errors.push(format!("Disabling failed ({}): {e}", t.id));
                        }
                    }
                    installed.insert(t.id.clone(), InstalledEntry { version: t.to.clone(), files });
                    result.installed.push(format!("{}@{}", t.id, t.to));
                }
                Err(e) => {
                    if !is_local {
                        let _ = std::fs::remove_file(&zip); // re-download on the next sync
                    }
                    result.errors.push(format!("Installation failed ({}): {e}", t.id));
                }
            }
        }
        profiles::save_installed(&paths, &name, &installed)?;
        Ok(result)
    })
    .await
    .map_err(|e| AppError::Invalid(e.to_string()))?
}

#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
pub struct SyncStatus {
    pub running: bool,
    pub queued: bool,
}

#[derive(Default)]
struct Queue {
    running: bool,
    pending: Vec<(String, bool)>,
}

/// Serializes syncs: one worker, requests merged per profile.
#[derive(Default)]
pub struct SyncHandle {
    /// Held for the duration of a sync; also used by enable/disable and game launch.
    pub lock: tokio::sync::Mutex<()>,
    queue: Mutex<Queue>,
}

impl SyncHandle {
    pub fn enqueue(&self, profile: &str, repair: bool) -> bool {
        let mut q = self.queue.lock().unwrap();
        match q.pending.iter_mut().find(|p| p.0 == profile) {
            Some(p) => p.1 |= repair,
            None => q.pending.push((profile.to_string(), repair)),
        }
        if q.running {
            false
        } else {
            q.running = true;
            true
        }
    }

    pub fn next(&self) -> Option<(String, bool)> {
        let mut q = self.queue.lock().unwrap();
        if q.pending.is_empty() {
            q.running = false;
            None
        } else {
            Some(q.pending.remove(0))
        }
    }

    pub fn status(&self) -> SyncStatus {
        let q = self.queue.lock().unwrap();
        SyncStatus { running: q.running, queued: !q.pending.is_empty() }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::install::tests::make_zip;
    use crate::models::{test_pkg, ProfileMod, Source};
    use crate::resolver::BEPINEX_PACK_ID;
    use crate::thunderstore::build;

    fn fixture() -> (tempfile::TempDir, Paths, Arc<Index>) {
        let d = tempfile::tempdir().unwrap();
        let paths = Paths::new(d.path().to_path_buf());
        paths.ensure().unwrap();
        make_zip(
            &paths.downloads(),
            &format!("{BEPINEX_PACK_ID}-5.4.2351.zip"),
            &[
                ("BepInExPack_Valheim/winhttp.dll", "w"),
                ("BepInExPack_Valheim/doorstop_config.ini", "[General]"),
                ("BepInExPack_Valheim/BepInEx/core/BepInEx.Preloader.dll", "pre"),
            ],
        );
        make_zip(&paths.downloads(), "a-A-1.0.0.zip", &[("A.dll", "1.0.0")]);
        make_zip(&paths.downloads(), "a-A-2.0.0.zip", &[("A.dll", "2.0.0")]);
        let idx = build(0, vec![test_pkg(BEPINEX_PACK_ID, &[("5.4.2351", &[])]), test_pkg("a-A", &[("2.0.0", &[]), ("1.0.0", &[])])]);
        crate::profiles::create(&paths, "p").unwrap();
        (d, paths, Arc::new(idx))
    }

    fn job(paths: &Paths, index: Option<Arc<Index>>, repair: bool) -> SyncJob {
        SyncJob { paths: paths.clone(), profile: "p".into(), index, client: reqwest::Client::new(), concurrency: 2, repair }
    }

    fn noop() -> ProgressFn {
        Arc::new(|_| {})
    }

    fn set_mods(paths: &Paths, mods: Vec<ProfileMod>) {
        let mut p = crate::profiles::load(paths, "p").unwrap();
        p.mods = mods;
        crate::profiles::save(paths, &p).unwrap();
    }

    fn a(version: &str, enabled: bool) -> ProfileMod {
        ProfileMod { enabled, ..ProfileMod::thunderstore("a", "A", version) }
    }

    #[tokio::test]
    async fn installs_pack_and_mods_and_respects_disabled() {
        let (_d, paths, idx) = fixture();
        set_mods(&paths, vec![a("1.0.0", false)]);
        let r = run_sync(job(&paths, Some(idx), false), noop()).await.unwrap();
        assert!(r.errors.is_empty(), "{:?}", r.errors);
        assert_eq!(r.installed.len(), 2);
        let dir = paths.profile_dir("p");
        assert!(dir.join("doorstop/winhttp.dll").exists());
        assert!(dir.join("BepInEx/core/BepInEx.Preloader.dll").exists());
        assert!(dir.join("BepInEx/plugins/a-A/A.dll.old").exists());
        assert_eq!(crate::profiles::load_installed(&paths, "p")["a-A"].version, "1.0.0");
    }

    #[tokio::test]
    async fn update_and_repair_keep_disabled_state() {
        let (_d, paths, idx) = fixture();
        set_mods(&paths, vec![a("1.0.0", false)]);
        run_sync(job(&paths, Some(idx.clone()), false), noop()).await.unwrap();
        set_mods(&paths, vec![a("2.0.0", false)]);
        let r = run_sync(job(&paths, Some(idx.clone()), false), noop()).await.unwrap();
        assert_eq!(r.installed, vec!["a-A@2.0.0"]);
        let dll = paths.profile_dir("p").join("BepInEx/plugins/a-A/A.dll.old");
        assert_eq!(std::fs::read_to_string(&dll).unwrap(), "2.0.0");
        let r = run_sync(job(&paths, Some(idx), true), noop()).await.unwrap();
        assert_eq!(r.installed.len(), 2);
        assert!(dll.exists());
        assert!(!paths.profile_dir("p").join("BepInEx/plugins/a-A/A.dll").exists());
    }

    #[tokio::test]
    async fn refuses_to_run_without_index() {
        let (_d, paths, _idx) = fixture();
        set_mods(&paths, vec![a("1.0.0", true)]);
        assert!(run_sync(job(&paths, None, false), noop()).await.is_err());
    }

    #[tokio::test]
    async fn keeps_installed_mod_that_vanished_from_index() {
        let (_d, paths, idx) = fixture();
        set_mods(&paths, vec![a("1.0.0", true)]);
        run_sync(job(&paths, Some(idx), false), noop()).await.unwrap();
        let without_a = Arc::new(build(0, vec![test_pkg(BEPINEX_PACK_ID, &[("5.4.2351", &[])])]));
        let r = run_sync(job(&paths, Some(without_a), false), noop()).await.unwrap();
        assert!(r.removed.is_empty());
        assert!(r.errors.iter().any(|e| e.contains("a-A")));
        assert!(paths.profile_dir("p").join("BepInEx/plugins/a-A/A.dll").exists());
    }

    #[tokio::test]
    async fn removes_mods_dropped_from_profile() {
        let (_d, paths, idx) = fixture();
        set_mods(&paths, vec![a("1.0.0", true)]);
        run_sync(job(&paths, Some(idx.clone()), false), noop()).await.unwrap();
        set_mods(&paths, vec![]);
        let r = run_sync(job(&paths, Some(idx), false), noop()).await.unwrap();
        assert_eq!(r.removed.len(), 2);
        assert!(!paths.profile_dir("p").join("BepInEx/plugins").exists());
        assert!(crate::profiles::load_installed(&paths, "p").is_empty());
    }

    #[tokio::test]
    async fn installs_local_mods_without_download() {
        let (_d, paths, idx) = fixture();
        let src = paths.local_dir("p").join("local-Mine");
        std::fs::create_dir_all(&src).unwrap();
        std::fs::write(src.join("Mine.dll"), "m").unwrap();
        set_mods(
            &paths,
            vec![ProfileMod {
                namespace: "local".into(),
                name: "Mine".into(),
                version: "0.0.0".into(),
                enabled: true,
                source: Source::Local,
                pinned: false,
                deps: vec![],
            }],
        );
        let r = run_sync(job(&paths, Some(idx), false), noop()).await.unwrap();
        assert!(r.errors.is_empty(), "{:?}", r.errors);
        assert!(paths.profile_dir("p").join("BepInEx/plugins/local-Mine/Mine.dll").exists());
    }

    #[test]
    fn queue_merges_requests() {
        let h = SyncHandle::default();
        assert!(h.enqueue("a", false));
        assert!(!h.enqueue("a", true));
        assert!(!h.enqueue("b", false));
        assert_eq!(h.status(), SyncStatus { running: true, queued: true });
        assert_eq!(h.next(), Some(("a".to_string(), true)));
        assert_eq!(h.next(), Some(("b".to_string(), false)));
        assert_eq!(h.next(), None);
        assert_eq!(h.status(), SyncStatus { running: false, queued: false });
        assert!(h.enqueue("a", false));
    }
}
