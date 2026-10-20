# Lokaler Valheim Mod Manager — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `modmanager-client` wird ein eigenständiger Tauri-2-Mod-Manager für das lokale Valheim (r2modman-Ersatz) mit Rust-Kern und SvelteKit-SPA.

**Architecture:** Die gesamte Logik liegt in kleinen Rust-Modulen unter `src-tauri/src/` (Index, Resolver, Installer, Sync, Profile, Teilen, Config, Spielstart, Log). Das Frontend ruft sie über eine dünne `#[tauri::command]`-Schicht auf. Jedes Profil ist ein eigener Ordner mit vollständigem BepInEx; das Spiel wird per Steam mit Doorstop-Argumenten auf das Profil gestartet. Das Frontend ist eine SvelteKit-SPA (adapter-static) und übernimmt die vorhandenen shadcn-svelte-Komponenten.

**Tech Stack:** Rust 1.98, Tauri 2.11, tokio, reqwest 0.12 (native-tls), zip 8, serde/serde_json/serde_yaml_ng, winreg; SvelteKit 2 + Svelte 5 (Runes), Vite, Tailwind 4, shadcn-svelte, bits-ui.

**Spec:** `docs/specs/2026-09-26-local-modmanager-design.md`

## Global Constraints

- Nur Windows ist Zielplattform; Code bleibt kompilierbar ohne `winreg` auf anderen OS (`#[cfg(windows)]`).
- Tauri bleibt auf Major 2 (keine 3.0-Alpha). Plugins: `opener`, `dialog`, `clipboard-manager` jeweils `"2"`.
- Alle Nutzertexte und Fehlermeldungen auf Deutsch.
- Datenwurzel: Tauri `app_data_dir()`.
- Valheim Steam-App-ID: `892970`. BepInExPack-ID: `denikson-BepInExPack_Valheim`.
- Thunderstore-Endpunkte: `https://thunderstore.io/c/valheim/api/v1/package/`, `https://thunderstore.io/package/download/{ns}/{name}/{ver}/`, `https://thunderstore.io/api/experimental/legacyprofile/get/{code}/`, `https://thunderstore.io/api/experimental/legacyprofile/create/`.
- Dateilisten in `installed.json` sind relativ zum Profilordner, mit `/` als Trenner.
- **Config-Schutz:** Dateien unter `BepInEx/config/` werden bei der Installation nur geschrieben, wenn sie noch nicht existieren, werden nicht in `installed.json` getrackt und daher nie gelöscht oder überschrieben.
- Paketmanager: npm. Frontend-Prüfung: `npm run check` und `npm run build` ohne Fehler.
- Commit-Nachrichten enden mit `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. Update eines Mods, der eine `.cfg` mitliefert → die vom Nutzer geänderte Config bleibt erhalten (Test in Task 5).
2. Ein Mod verschwindet aus dem Thunderstore-Index (gelöscht/umbenannt) → er wird beim Sync **nicht** deinstalliert (Test in Task 6).
3. Sync, bevor der Index geladen ist → Fehler statt Deinstallation aller Mods (Test in Task 6).
4. Deaktivierter Mod wird aktualisiert/repariert → bleibt nach der Neuinstallation deaktiviert (`.old`) (Test in Task 6).
5. r2modman-Profil mit Zeichen im Namen, die unter Windows nicht als Ordnername erlaubt sind (`:` `?` …) → Import klappt mit Ersatznamen (Test in Task 8).

---

## Dateistruktur

```
src-tauri/
  Cargo.toml                 (Task 1: Abhängigkeiten)
  capabilities/default.json  (Task 11: dialog + clipboard)
  tauri.conf.json            (Task 12: frontendDist ../build)
  src/
    main.rs                  (unverändert)
    lib.rs                   (Task 11: Setup, Plugins, Handler)
    error.rs                 (Task 1)
    util.rs                  (Task 1)
    models.rs                (Task 1)
    paths.rs                 (Task 1)
    settings.rs              (Task 1)
    profiles.rs              (Task 2)
    resolver.rs              (Task 3)
    thunderstore.rs          (Task 4)
    install.rs               (Task 5)
    sync.rs                  (Task 6)
    config.rs                (Task 7)
    share.rs                 (Task 8)
    game.rs                  (Task 9)
    logs.rs                  (Task 10)
    commands.rs              (Task 11)
svelte.config.js, vite.config.ts, tsconfig.json, package.json   (Task 12)
src/app.html, src/app.d.ts                                       (Task 12)
src/routes/+layout.ts, +layout.svelte, +page.svelte              (Task 12/13)
src/routes/{profile,config,logs,settings}/+page.svelte           (Task 13)
src/lib/api/{types.ts,client.ts,store.svelte.ts}                 (Task 12)
src/lib/components/app/*.svelte                                  (Task 13)
```

Gelöscht in Task 12: `index.html`, `src/main.ts`, `src/App.svelte`, `src/lib/Counter.svelte`, `src/assets/`, `tsconfig.app.json`, `tsconfig.node.json`, `bun.lock`; `public/` → `static/`.
Gelöscht in Task 13: `src/lib/components/app/ProfileTab.svelte`, `NewProfileDialog.svelte`, `SettingsDialog.svelte`.

---

### Task 1: Rust-Fundament (Abhängigkeiten, Fehler, Hilfsfunktionen, Modelle, Pfade, Settings)

**Files:**

- Modify: `src-tauri/Cargo.toml`
- Create: `src-tauri/src/error.rs`, `util.rs`, `models.rs`, `paths.rs`, `settings.rs`
- Modify: `src-tauri/src/lib.rs` (nur `mod`-Deklarationen)

**Interfaces:**

- Produces:
  - `error::{AppError, Result<T>}`; Varianten `Io(std::io::Error)`, `Network(String)`, `NotFound(String)`, `Invalid(String)`, `GameNotFound`; `AppError::kind() -> &'static str`; serialisiert als `{ kind, message }`.
  - `util::{cmp_version(&str,&str)->Ordering, parse_full_name(&str)->Option<FullName{ns,name,version}>, safe_join(&Path,&str)->Result<PathBuf>, write_atomic(&Path,&[u8])->Result<()>, write_json<T:Serialize>(&Path,&T)->Result<()>, read_json<T:DeserializeOwned>(&Path)->Result<Option<T>>, now_ms()->i64, with_old(&Path)->PathBuf}`
  - `models::{Version, Pkg, Source, ProfileMod, Profile, InstalledEntry, Installed, Resolved, ToInstall, Plan}`; `ProfileMod::id()`, `ProfileMod::thunderstore(ns,name,version)`; `#[cfg(test)] models::test_pkg(id, &[(ver, &[deps])]) -> Pkg`
  - `paths::Paths` mit `new(root)`, `ensure()`, `settings_file()`, `active_file()`, `index_cache()`, `downloads()`, `zip_cache(id,ver)`, `profiles_dir()`, `profile_dir(name)`, `profile_file(name)`, `installed_file(name)`, `config_dir(name)`, `local_dir(name)`, `doorstop_dir(name)`, `log_file(name)`
  - `settings::{Settings, load(&Paths)->Settings, save(&Paths,&Settings)->Result<Settings>}`

- [ ] **Step 1: Abhängigkeiten eintragen**

`src-tauri/Cargo.toml` — `[package].description` und den Block `[dependencies]` ersetzen, zwei Blöcke ergänzen:

```toml
description = "Lokaler Mod-Manager für Valheim (r2modman-Ersatz)"
```

```toml
[dependencies]
tauri = { version = "2", features = [] }
tauri-plugin-opener = "2"
tauri-plugin-dialog = "2"
tauri-plugin-clipboard-manager = "2"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
serde_yaml_ng = "0.10"
thiserror = "2"
tokio = { version = "1", features = ["rt-multi-thread", "macros", "fs", "io-util", "time", "sync"] }
reqwest = { version = "0.12", default-features = false, features = ["native-tls", "gzip", "stream", "http2", "json"] }
futures = "0.3"
zip = { version = "8", default-features = false, features = ["deflate-flate2-zlib-rs"] }
base64 = "0.22"
sha2 = "0.10"
chrono = { version = "0.4", default-features = false, features = ["std"] }

[target.'cfg(windows)'.dependencies]
winreg = "0.55"

[dev-dependencies]
tempfile = "3"
```

- [ ] **Step 2: `error.rs` schreiben**

```rust
use serde::ser::{Serialize, SerializeStruct, Serializer};

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("Dateifehler: {0}")]
    Io(#[from] std::io::Error),
    #[error("Netzwerkfehler: {0}")]
    Network(String),
    #[error("{0}")]
    NotFound(String),
    #[error("{0}")]
    Invalid(String),
    #[error("Valheim wurde nicht gefunden. Bitte den Spielordner in den Einstellungen festlegen.")]
    GameNotFound,
}

pub type Result<T> = std::result::Result<T, AppError>;

impl AppError {
    pub fn kind(&self) -> &'static str {
        match self {
            AppError::Io(_) => "io",
            AppError::Network(_) => "network",
            AppError::NotFound(_) => "notFound",
            AppError::Invalid(_) => "invalid",
            AppError::GameNotFound => "gameNotFound",
        }
    }
}

impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error> {
        let mut s = serializer.serialize_struct("AppError", 2)?;
        s.serialize_field("kind", self.kind())?;
        s.serialize_field("message", &self.to_string())?;
        s.end()
    }
}

impl From<reqwest::Error> for AppError {
    fn from(e: reqwest::Error) -> Self {
        AppError::Network(e.to_string())
    }
}

impl From<serde_json::Error> for AppError {
    fn from(e: serde_json::Error) -> Self {
        AppError::Invalid(format!("Ungültiges JSON: {e}"))
    }
}

impl From<zip::result::ZipError> for AppError {
    fn from(e: zip::result::ZipError) -> Self {
        AppError::Invalid(format!("Ungültige Zip-Datei: {e}"))
    }
}
```

- [ ] **Step 3: Failing Tests für `util.rs` schreiben**

`src-tauri/src/util.rs` (zunächst nur Tests + leere Signaturen mit `todo!()`):

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use std::cmp::Ordering;

    #[test]
    fn compares_versions_numerically() {
        assert_eq!(cmp_version("1.10.0", "1.9.0"), Ordering::Greater);
        assert_eq!(cmp_version("1.0", "1.0.0"), Ordering::Equal);
        assert_eq!(cmp_version("0.9.9", "1.0.0"), Ordering::Less);
    }

    #[test]
    fn parses_full_names() {
        let f = parse_full_name("denikson-BepInExPack_Valheim-5.4.2351").unwrap();
        assert_eq!((f.ns.as_str(), f.name.as_str(), f.version.as_str()), ("denikson", "BepInExPack_Valheim", "5.4.2351"));
        let f = parse_full_name("a-b-c-1.0.0").unwrap();
        assert_eq!(f.name, "b-c");
        assert!(parse_full_name("bad").is_none());
        assert!(parse_full_name("a-1.0.0").is_none());
    }

    #[test]
    fn safe_join_rejects_escapes() {
        let base = Path::new("/base");
        assert_eq!(safe_join(base, "a/b.cfg").unwrap(), base.join("a").join("b.cfg"));
        assert_eq!(safe_join(base, "a\\b.cfg").unwrap(), base.join("a").join("b.cfg"));
        for bad in ["../x", "/abs", "C:/x", "a/../../x", "", "."] {
            assert!(safe_join(base, bad).is_err(), "{bad} sollte abgelehnt werden");
        }
    }

    #[test]
    fn write_atomic_overwrites() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("sub").join("f.json");
        write_json(&p, &vec![1, 2]).unwrap();
        write_json(&p, &vec![3]).unwrap();
        let v: Option<Vec<i32>> = read_json(&p).unwrap();
        assert_eq!(v, Some(vec![3]));
        let missing: Option<Vec<i32>> = read_json(&dir.path().join("nope.json")).unwrap();
        assert_eq!(missing, None);
    }
}
```

- [ ] **Step 4: Tests laufen lassen, Fehlschlag prüfen**

Run: `cd src-tauri && cargo test util::`
Expected: FAIL (Funktionen fehlen / `todo!()`)

- [ ] **Step 5: `util.rs` implementieren (über dem Test-Modul)**

```rust
use crate::error::{AppError, Result};
use serde::{de::DeserializeOwned, Serialize};
use std::cmp::Ordering;
use std::path::{Path, PathBuf};

pub fn cmp_version(a: &str, b: &str) -> Ordering {
    let pa: Vec<u64> = a.split('.').map(|x| x.parse().unwrap_or(0)).collect();
    let pb: Vec<u64> = b.split('.').map(|x| x.parse().unwrap_or(0)).collect();
    for i in 0..pa.len().max(pb.len()) {
        let o = pa.get(i).copied().unwrap_or(0).cmp(&pb.get(i).copied().unwrap_or(0));
        if o != Ordering::Equal {
            return o;
        }
    }
    Ordering::Equal
}

#[derive(Debug, Clone, PartialEq)]
pub struct FullName {
    pub ns: String,
    pub name: String,
    pub version: String,
}

/// "Namespace-Name-1.2.3" → Teile. Namespace und Version enthalten nie "-".
pub fn parse_full_name(full: &str) -> Option<FullName> {
    let parts: Vec<&str> = full.split('-').collect();
    if parts.len() < 3 {
        return None;
    }
    Some(FullName {
        ns: parts[0].to_string(),
        name: parts[1..parts.len() - 1].join("-"),
        version: parts[parts.len() - 1].to_string(),
    })
}

/// Hängt einen relativen Pfad an `base` an und lehnt alles ab, was herausführen könnte.
pub fn safe_join(base: &Path, rel: &str) -> Result<PathBuf> {
    let norm = rel.replace('\\', "/");
    let invalid = || AppError::Invalid(format!("Ungültiger Pfad: {rel}"));
    if norm.starts_with('/') {
        return Err(invalid());
    }
    let mut out = base.to_path_buf();
    let mut any = false;
    for part in norm.split('/') {
        match part {
            "" | "." => continue,
            ".." => return Err(invalid()),
            p if p.contains(':') => return Err(invalid()),
            p => {
                out.push(p);
                any = true;
            }
        }
    }
    if any { Ok(out) } else { Err(invalid()) }
}

pub fn write_atomic(path: &Path, bytes: &[u8]) -> Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let mut tmp = path.as_os_str().to_owned();
    tmp.push(".tmp");
    let tmp = PathBuf::from(tmp);
    std::fs::write(&tmp, bytes)?;
    std::fs::rename(&tmp, path)?;
    Ok(())
}

pub fn write_json<T: Serialize>(path: &Path, value: &T) -> Result<()> {
    write_atomic(path, &serde_json::to_vec_pretty(value)?)
}

pub fn read_json<T: DeserializeOwned>(path: &Path) -> Result<Option<T>> {
    match std::fs::read(path) {
        Ok(bytes) => Ok(Some(serde_json::from_slice(&bytes)?)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.into()),
    }
}

pub fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// `x.dll` → `x.dll.old` (Deaktivierungs-Name).
pub fn with_old(p: &Path) -> PathBuf {
    let mut s = p.as_os_str().to_owned();
    s.push(".old");
    PathBuf::from(s)
}
```

- [ ] **Step 6: `models.rs` schreiben**

```rust
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Version {
    pub v: String,
    pub deps: Vec<String>,
    pub size: u64,
    pub date: i64,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Pkg {
    pub id: String,
    pub ns: String,
    pub name: String,
    pub desc: String,
    pub icon: String,
    pub cats: Vec<String>,
    pub rating: i64,
    pub dl: u64,
    pub upd: i64,
    pub created: i64,
    pub dep: bool,
    pub nsfw: bool,
    pub pinned: bool,
    pub url: String,
    pub web: String,
    /// neueste zuerst
    pub versions: Vec<Version>,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum Source {
    #[default]
    Thunderstore,
    Local,
}

fn yes() -> bool {
    true
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct ProfileMod {
    pub namespace: String,
    pub name: String,
    pub version: String,
    #[serde(default = "yes")]
    pub enabled: bool,
    #[serde(default)]
    pub source: Source,
    /// Nur bei lokalen Mods: Abhängigkeiten aus deren manifest.json.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub deps: Vec<String>,
}

impl ProfileMod {
    pub fn id(&self) -> String {
        format!("{}-{}", self.namespace, self.name)
    }

    pub fn thunderstore(ns: &str, name: &str, version: &str) -> Self {
        ProfileMod {
            namespace: ns.into(),
            name: name.into(),
            version: version.into(),
            enabled: true,
            source: Source::Thunderstore,
            deps: vec![],
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
pub struct Profile {
    pub name: String,
    #[serde(default)]
    pub mods: Vec<ProfileMod>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct InstalledEntry {
    pub version: String,
    pub files: Vec<String>,
}

pub type Installed = BTreeMap<String, InstalledEntry>;

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Resolved {
    pub version: String,
    pub required_by: Vec<String>,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct ToInstall {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub from: Option<String>,
    pub to: String,
}

#[derive(Serialize, Clone, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct Plan {
    pub resolved: BTreeMap<String, Resolved>,
    pub to_install: Vec<ToInstall>,
    pub to_remove: Vec<String>,
    pub errors: Vec<String>,
}

#[cfg(test)]
pub fn test_pkg(id: &str, versions: &[(&str, &[&str])]) -> Pkg {
    let (ns, name) = id.split_once('-').unwrap();
    Pkg {
        id: id.into(),
        ns: ns.into(),
        name: name.into(),
        desc: String::new(),
        icon: String::new(),
        cats: vec![],
        rating: 0,
        dl: 0,
        upd: 0,
        created: 0,
        dep: false,
        nsfw: false,
        pinned: false,
        url: String::new(),
        web: String::new(),
        versions: versions
            .iter()
            .map(|(v, deps)| Version { v: v.to_string(), deps: deps.iter().map(|d| d.to_string()).collect(), size: 0, date: 0 })
            .collect(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn old_profile_json_gets_defaults() {
        let m: ProfileMod = serde_json::from_str(r#"{"namespace":"a","name":"B","version":"1.0.0"}"#).unwrap();
        assert!(m.enabled);
        assert_eq!(m.source, Source::Thunderstore);
        assert!(m.deps.is_empty());
        assert_eq!(m.id(), "a-B");
    }

    #[test]
    fn plan_serializes_camel_case() {
        let mut p = Plan::default();
        p.to_install.push(ToInstall { id: "a-B".into(), from: None, to: "1.0.0".into() });
        let s = serde_json::to_string(&p).unwrap();
        assert!(s.contains("\"toInstall\""));
        assert!(!s.contains("\"from\""));
    }
}
```

- [ ] **Step 7: `paths.rs` schreiben**

```rust
use crate::error::Result;
use std::path::PathBuf;

#[derive(Clone, Debug)]
pub struct Paths {
    pub root: PathBuf,
}

impl Paths {
    pub fn new(root: PathBuf) -> Self {
        Paths { root }
    }

    pub fn ensure(&self) -> Result<()> {
        std::fs::create_dir_all(self.profiles_dir())?;
        std::fs::create_dir_all(self.downloads())?;
        Ok(())
    }

    pub fn settings_file(&self) -> PathBuf { self.root.join("settings.json") }
    pub fn active_file(&self) -> PathBuf { self.root.join("active.txt") }
    pub fn index_cache(&self) -> PathBuf { self.root.join("cache").join("index.json") }
    pub fn downloads(&self) -> PathBuf { self.root.join("cache").join("downloads") }
    pub fn zip_cache(&self, id: &str, version: &str) -> PathBuf { self.downloads().join(format!("{id}-{version}.zip")) }
    pub fn profiles_dir(&self) -> PathBuf { self.root.join("profiles") }
    pub fn profile_dir(&self, name: &str) -> PathBuf { self.profiles_dir().join(name) }
    pub fn profile_file(&self, name: &str) -> PathBuf { self.profile_dir(name).join("profile.json") }
    pub fn installed_file(&self, name: &str) -> PathBuf { self.profile_dir(name).join("installed.json") }
    pub fn config_dir(&self, name: &str) -> PathBuf { self.profile_dir(name).join("BepInEx").join("config") }
    pub fn local_dir(&self, name: &str) -> PathBuf { self.profile_dir(name).join("local") }
    pub fn doorstop_dir(&self, name: &str) -> PathBuf { self.profile_dir(name).join("doorstop") }
    pub fn log_file(&self, name: &str) -> PathBuf { self.profile_dir(name).join("BepInEx").join("LogOutput.log") }
}
```

- [ ] **Step 8: `settings.rs` mit Test schreiben**

```rust
use crate::error::Result;
use crate::paths::Paths;
use crate::util::{read_json, write_json};
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub valheim_dir: Option<String>,
    pub steam_exe: Option<String>,
    pub download_concurrency: usize,
    pub index_ttl_minutes: u64,
    pub show_nsfw: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Settings { valheim_dir: None, steam_exe: None, download_concurrency: 4, index_ttl_minutes: 30, show_nsfw: false }
    }
}

pub fn load(paths: &Paths) -> Settings {
    read_json(&paths.settings_file()).ok().flatten().unwrap_or_default()
}

/// Speichert bereinigte Settings und gibt sie zurück.
pub fn save(paths: &Paths, s: &Settings) -> Result<Settings> {
    let blank = |v: &Option<String>| v.as_ref().map(|x| x.trim().to_string()).filter(|x| !x.is_empty());
    let clean = Settings {
        valheim_dir: blank(&s.valheim_dir),
        steam_exe: blank(&s.steam_exe),
        download_concurrency: s.download_concurrency.clamp(1, 16),
        index_ttl_minutes: s.index_ttl_minutes.max(5),
        show_nsfw: s.show_nsfw,
    };
    write_json(&paths.settings_file(), &clean)?;
    Ok(clean)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip_with_clamping_and_defaults() {
        let dir = tempfile::tempdir().unwrap();
        let paths = Paths::new(dir.path().to_path_buf());
        assert_eq!(load(&paths), Settings::default());
        let saved = save(&paths, &Settings { valheim_dir: Some("  ".into()), download_concurrency: 99, index_ttl_minutes: 1, ..Settings::default() }).unwrap();
        assert_eq!(saved.valheim_dir, None);
        assert_eq!(saved.download_concurrency, 16);
        assert_eq!(saved.index_ttl_minutes, 5);
        assert_eq!(load(&paths), saved);
        std::fs::write(paths.settings_file(), r#"{"showNsfw":true}"#).unwrap();
        assert_eq!(load(&paths).download_concurrency, 4);
        assert!(load(&paths).show_nsfw);
    }
}
```

- [ ] **Step 9: Module in `lib.rs` deklarieren**

Oben in `src-tauri/src/lib.rs` einfügen:

```rust
mod error;
mod models;
mod paths;
mod settings;
mod util;
```

- [ ] **Step 10: Tests laufen lassen**

Run: `cd src-tauri && cargo test`
Expected: PASS (alle Tests aus util, models, settings). Dead-code-Warnungen sind in diesem Stadium ok.

- [ ] **Step 11: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src
git commit -m "feat(core): error, util, models, paths, settings foundation"
```

---

### Task 2: Profil-Speicher

**Files:**

- Create: `src-tauri/src/profiles.rs`
- Modify: `src-tauri/src/lib.rs` (`mod profiles;`)

**Interfaces:**

- Consumes: `Paths`, `Profile`, `Installed`, `util::{read_json, write_json}`
- Produces: `profiles::{validate_name(&str)->Result<String>, list(&Paths)->Vec<String>, exists(&Paths,&str)->bool, load(&Paths,&str)->Result<Profile>, save(&Paths,&Profile)->Result<()>, create(&Paths,&str)->Result<String>, delete(&Paths,&str)->Result<()>, rename(&Paths,&str,&str)->Result<String>, clone_profile(&Paths,&str,&str)->Result<String>, active(&Paths)->Option<String>, set_active(&Paths,&str)->Result<()>, load_installed(&Paths,&str)->Installed, save_installed(&Paths,&str,&Installed)->Result<()>, unique_name(&Paths,&str)->String, copy_dir(&Path,&Path)->Result<()>}`

- [ ] **Step 1: Failing Tests schreiben**

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::ProfileMod;

    fn setup() -> (tempfile::TempDir, Paths) {
        let dir = tempfile::tempdir().unwrap();
        let paths = Paths::new(dir.path().to_path_buf());
        paths.ensure().unwrap();
        (dir, paths)
    }

    #[test]
    fn validates_names() {
        assert_eq!(validate_name("  Mein Profil ").unwrap(), "Mein Profil");
        for bad in ["", "   ", "a/b", "a:b", "x?", "..", "ende.", "con<"] {
            assert!(validate_name(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn create_list_load_save_delete() {
        let (_d, paths) = setup();
        assert_eq!(create(&paths, "Beta").unwrap(), "Beta");
        create(&paths, "alpha").unwrap();
        assert!(create(&paths, "alpha").is_err());
        assert_eq!(list(&paths), vec!["alpha", "Beta"]);
        let mut p = load(&paths, "alpha").unwrap();
        p.mods.push(ProfileMod::thunderstore("a", "B", "1.0.0"));
        save(&paths, &p).unwrap();
        assert_eq!(load(&paths, "alpha").unwrap().mods.len(), 1);
        set_active(&paths, "alpha").unwrap();
        delete(&paths, "alpha").unwrap();
        assert_eq!(active(&paths), None);
        assert_eq!(list(&paths), vec!["Beta"]);
        assert!(load(&paths, "alpha").is_err());
    }

    #[test]
    fn rename_and_clone_keep_files_and_active() {
        let (_d, paths) = setup();
        create(&paths, "a").unwrap();
        std::fs::create_dir_all(paths.config_dir("a")).unwrap();
        std::fs::write(paths.config_dir("a").join("x.cfg"), "k=v").unwrap();
        set_active(&paths, "a").unwrap();
        rename(&paths, "a", "b").unwrap();
        assert_eq!(active(&paths).as_deref(), Some("b"));
        assert_eq!(load(&paths, "b").unwrap().name, "b");
        clone_profile(&paths, "b", "c").unwrap();
        assert_eq!(std::fs::read_to_string(paths.config_dir("c").join("x.cfg")).unwrap(), "k=v");
        assert_eq!(load(&paths, "c").unwrap().name, "c");
        assert!(rename(&paths, "b", "c").is_err());
    }

    #[test]
    fn unique_names_get_suffix() {
        let (_d, paths) = setup();
        assert_eq!(unique_name(&paths, "x"), "x");
        create(&paths, "x").unwrap();
        create(&paths, "x (2)").unwrap();
        assert_eq!(unique_name(&paths, "x"), "x (3)");
    }
}
```

- [ ] **Step 2: Tests laufen lassen, Fehlschlag prüfen**

Run: `cd src-tauri && cargo test profiles::`
Expected: FAIL (Funktionen fehlen)

- [ ] **Step 3: Implementieren**

```rust
use crate::error::{AppError, Result};
use crate::models::{Installed, Profile};
use crate::paths::Paths;
use crate::util::{read_json, write_json};
use std::path::Path;

pub fn validate_name(name: &str) -> Result<String> {
    let n = name.trim();
    let bad = n.is_empty()
        || n.chars().count() > 64
        || n == "."
        || n == ".."
        || n.ends_with('.')
        || n.chars().any(|c| "<>:\"/\\|?*".contains(c) || c.is_control());
    if bad {
        return Err(AppError::Invalid(format!("Ungültiger Profilname: \"{name}\"")));
    }
    Ok(n.to_string())
}

pub fn exists(paths: &Paths, name: &str) -> bool {
    paths.profile_file(name).is_file()
}

pub fn list(paths: &Paths) -> Vec<String> {
    let mut names: Vec<String> = std::fs::read_dir(paths.profiles_dir())
        .map(|rd| {
            rd.filter_map(|e| e.ok())
                .filter(|e| e.path().join("profile.json").is_file())
                .filter_map(|e| e.file_name().into_string().ok())
                .collect()
        })
        .unwrap_or_default();
    names.sort_by_key(|n| n.to_lowercase());
    names
}

pub fn load(paths: &Paths, name: &str) -> Result<Profile> {
    read_json(&paths.profile_file(name))?
        .ok_or_else(|| AppError::NotFound(format!("Profil \"{name}\" existiert nicht.")))
}

pub fn save(paths: &Paths, profile: &Profile) -> Result<()> {
    write_json(&paths.profile_file(&profile.name), profile)
}

pub fn create(paths: &Paths, name: &str) -> Result<String> {
    let name = validate_name(name)?;
    if exists(paths, &name) {
        return Err(AppError::Invalid(format!("Profil \"{name}\" existiert bereits.")));
    }
    std::fs::create_dir_all(paths.profile_dir(&name))?;
    save(paths, &Profile { name: name.clone(), mods: vec![] })?;
    Ok(name)
}

pub fn delete(paths: &Paths, name: &str) -> Result<()> {
    let dir = paths.profile_dir(name);
    if dir.exists() {
        std::fs::remove_dir_all(dir)?;
    }
    if active(paths).as_deref() == Some(name) {
        set_active(paths, "")?;
    }
    Ok(())
}

pub fn rename(paths: &Paths, from: &str, to: &str) -> Result<String> {
    let to = validate_name(to)?;
    let mut profile = load(paths, from)?;
    if exists(paths, &to) {
        return Err(AppError::Invalid(format!("Profil \"{to}\" existiert bereits.")));
    }
    std::fs::rename(paths.profile_dir(from), paths.profile_dir(&to))?;
    profile.name = to.clone();
    save(paths, &profile)?;
    if active(paths).as_deref() == Some(from) {
        set_active(paths, &to)?;
    }
    Ok(to)
}

pub fn clone_profile(paths: &Paths, from: &str, to: &str) -> Result<String> {
    let to = validate_name(to)?;
    let mut profile = load(paths, from)?;
    if exists(paths, &to) {
        return Err(AppError::Invalid(format!("Profil \"{to}\" existiert bereits.")));
    }
    copy_dir(&paths.profile_dir(from), &paths.profile_dir(&to))?;
    profile.name = to.clone();
    save(paths, &profile)?;
    Ok(to)
}

pub fn copy_dir(src: &Path, dst: &Path) -> Result<()> {
    std::fs::create_dir_all(dst)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let target = dst.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_dir(&entry.path(), &target)?;
        } else {
            std::fs::copy(entry.path(), target)?;
        }
    }
    Ok(())
}

pub fn active(paths: &Paths) -> Option<String> {
    let name = std::fs::read_to_string(paths.active_file()).ok()?.trim().to_string();
    (!name.is_empty() && exists(paths, &name)).then_some(name)
}

pub fn set_active(paths: &Paths, name: &str) -> Result<()> {
    crate::util::write_atomic(&paths.active_file(), name.as_bytes())
}

pub fn load_installed(paths: &Paths, name: &str) -> Installed {
    read_json(&paths.installed_file(name)).ok().flatten().unwrap_or_default()
}

pub fn save_installed(paths: &Paths, name: &str, installed: &Installed) -> Result<()> {
    write_json(&paths.installed_file(name), installed)
}

pub fn unique_name(paths: &Paths, base: &str) -> String {
    if !exists(paths, base) {
        return base.to_string();
    }
    (2..).map(|i| format!("{base} ({i})")).find(|n| !exists(paths, n)).unwrap()
}
```

- [ ] **Step 4: `mod profiles;` in `lib.rs` ergänzen, Tests laufen lassen**

Run: `cd src-tauri && cargo test profiles::`
Expected: PASS (4 Tests)

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src
git commit -m "feat(core): profile storage (create/rename/clone/delete/active)"
```

---

### Task 3: Resolver

**Files:**

- Create: `src-tauri/src/resolver.rs`
- Modify: `src-tauri/src/lib.rs` (`mod resolver;`)

**Interfaces:**

- Consumes: `models::{Pkg, ProfileMod, Source, Installed, Plan, Resolved, ToInstall}`, `util::{cmp_version, parse_full_name}`
- Produces: `resolver::{BEPINEX_PACK_ID: &str, plan(&[ProfileMod], &HashMap<String,Pkg>, &Installed) -> Plan, updates(&[ProfileMod], &HashMap<String,Pkg>) -> BTreeMap<String,String>}`

- [ ] **Step 1: Failing Tests schreiben**

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{test_pkg, InstalledEntry, ProfileMod, Source};

    fn index(pkgs: Vec<Pkg>) -> HashMap<String, Pkg> {
        let mut all = pkgs;
        all.push(test_pkg("denikson-BepInExPack_Valheim", &[("5.4.2351", &[]), ("5.4.2333", &[])]));
        all.into_iter().map(|p| (p.id.clone(), p)).collect()
    }
    fn m(id: &str, v: &str) -> ProfileMod {
        let (ns, name) = id.split_once('-').unwrap();
        ProfileMod::thunderstore(ns, name, v)
    }

    #[test]
    fn resolves_chain_and_adds_bepinex_pack() {
        let idx = index(vec![
            test_pkg("a-A", &[("1.0.0", &["b-B-1.0.0"])]),
            test_pkg("b-B", &[("1.0.0", &["c-C-1.0.0"])]),
            test_pkg("c-C", &[("1.0.0", &[])]),
        ]);
        let p = plan(&[m("a-A", "1.0.0")], &idx, &Installed::new());
        assert_eq!(p.resolved.len(), 4);
        assert_eq!(p.resolved["c-C"].required_by, vec!["b-B"]);
        assert_eq!(p.resolved[BEPINEX_PACK_ID].version, "5.4.2351");
        assert!(p.resolved[BEPINEX_PACK_ID].required_by.is_empty());
        assert_eq!(p.to_install.len(), 4);
        assert!(p.errors.is_empty());
    }

    #[test]
    fn empty_profile_needs_nothing() {
        let p = plan(&[], &index(vec![]), &Installed::new());
        assert!(p.resolved.is_empty());
    }

    #[test]
    fn explicit_pack_dependency_keeps_requested_version() {
        let idx = index(vec![test_pkg("a-A", &[("1.0.0", &["denikson-BepInExPack_Valheim-5.4.2333"])])]);
        let p = plan(&[m("a-A", "1.0.0")], &idx, &Installed::new());
        assert_eq!(p.resolved[BEPINEX_PACK_ID].version, "5.4.2333");
        assert_eq!(p.resolved[BEPINEX_PACK_ID].required_by, vec!["a-A"]);
    }

    #[test]
    fn diamond_upgrades_to_newest_and_walks_new_deps() {
        let idx = index(vec![
            test_pkg("a-A", &[("1.0.0", &["c-C-1.0.0"])]),
            test_pkg("b-B", &[("1.0.0", &["c-C-2.0.0"])]),
            test_pkg("c-C", &[("2.0.0", &["d-D-1.0.0"]), ("1.0.0", &[])]),
            test_pkg("d-D", &[("1.0.0", &[])]),
        ]);
        let p = plan(&[m("a-A", "1.0.0"), m("b-B", "1.0.0")], &idx, &Installed::new());
        assert_eq!(p.resolved["c-C"].version, "2.0.0");
        assert_eq!(p.resolved["c-C"].required_by, vec!["a-A", "b-B"]);
        assert!(p.resolved.contains_key("d-D"));
    }

    #[test]
    fn reports_missing_and_survives_cycles() {
        let idx = index(vec![
            test_pkg("a-A", &[("1.0.0", &["b-B-1.0.0", "x-Gone-1.0.0"])]),
            test_pkg("b-B", &[("1.0.0", &["a-A-1.0.0"])]),
        ]);
        let p = plan(&[m("a-A", "1.0.0")], &idx, &Installed::new());
        assert_eq!(p.errors, vec!["Paket nicht gefunden: x-Gone (benötigt von a-A)"]);
        assert_eq!(p.resolved["a-A"].required_by, vec!["b-B"]);
    }

    #[test]
    fn unknown_version_falls_back_to_latest() {
        let idx = index(vec![test_pkg("a-A", &[("2.0.0", &[]), ("1.0.0", &[])])]);
        let p = plan(&[m("a-A", "9.9.9")], &idx, &Installed::new());
        assert_eq!(p.resolved["a-A"].version, "2.0.0");
    }

    #[test]
    fn local_mods_resolve_their_deps() {
        let idx = index(vec![test_pkg("b-B", &[("1.0.0", &[])])]);
        let local = ProfileMod {
            namespace: "local".into(),
            name: "Mine".into(),
            version: "0.1.0".into(),
            enabled: true,
            source: Source::Local,
            deps: vec!["b-B-1.0.0".into()],
        };
        let p = plan(&[local], &idx, &Installed::new());
        assert_eq!(p.resolved["local-Mine"].version, "0.1.0");
        assert_eq!(p.resolved["b-B"].required_by, vec!["local-Mine"]);
        assert!(p.errors.is_empty());
    }

    #[test]
    fn diffs_against_installed() {
        let idx = index(vec![test_pkg("a-A", &[("2.0.0", &[]), ("1.0.0", &[])])]);
        let mut inst = Installed::new();
        inst.insert("a-A".into(), InstalledEntry { version: "1.0.0".into(), files: vec![] });
        inst.insert("old-Old".into(), InstalledEntry { version: "1.0.0".into(), files: vec![] });
        inst.insert(BEPINEX_PACK_ID.into(), InstalledEntry { version: "5.4.2351".into(), files: vec![] });
        let p = plan(&[m("a-A", "2.0.0")], &idx, &inst);
        assert_eq!(p.to_install, vec![ToInstall { id: "a-A".into(), from: Some("1.0.0".into()), to: "2.0.0".into() }]);
        assert_eq!(p.to_remove, vec!["old-Old"]);
    }

    #[test]
    fn lists_updates_for_explicit_mods() {
        let idx = index(vec![test_pkg("a-A", &[("2.0.0", &[]), ("1.0.0", &[])])]);
        let u = updates(&[m("a-A", "1.0.0")], &idx);
        assert_eq!(u.get("a-A").map(String::as_str), Some("2.0.0"));
        assert!(updates(&[m("a-A", "2.0.0")], &idx).is_empty());
    }
}
```

- [ ] **Step 2: Tests laufen lassen, Fehlschlag prüfen**

Run: `cd src-tauri && cargo test resolver::`
Expected: FAIL (Funktionen fehlen)

- [ ] **Step 3: Implementieren**

```rust
use crate::models::{Installed, Pkg, Plan, ProfileMod, Resolved, Source, ToInstall};
use crate::util::{cmp_version, parse_full_name};
use std::cmp::Ordering;
use std::collections::{BTreeMap, HashMap};

pub const BEPINEX_PACK_ID: &str = "denikson-BepInExPack_Valheim";

/// Jede Abhängigkeit auf ein BepInExPack zeigt auf das eine Valheim-Pack.
fn canonical_id(ns: &str, name: &str) -> String {
    if name.to_ascii_lowercase().starts_with("bepinexpack") {
        BEPINEX_PACK_ID.to_string()
    } else {
        format!("{ns}-{name}")
    }
}

struct Resolver<'a> {
    by_id: &'a HashMap<String, Pkg>,
    resolved: BTreeMap<String, Resolved>,
    errors: Vec<String>,
}

impl<'a> Resolver<'a> {
    fn visit(&mut self, ns: &str, name: &str, version: &str, parent: Option<&str>) {
        let id = canonical_id(ns, name);
        let by_id = self.by_id;
        let Some(pkg) = by_id.get(&id) else {
            let from = parent.map(|p| format!(" (benötigt von {p})")).unwrap_or_default();
            self.errors.push(format!("Paket nicht gefunden: {id}{from}"));
            return;
        };
        let Some(latest) = pkg.versions.first() else { return };
        let want = if pkg.versions.iter().any(|v| v.v == version) { version.to_string() } else { latest.v.clone() };
        match self.resolved.get_mut(&id) {
            Some(cur) => {
                if let Some(p) = parent {
                    if !cur.required_by.iter().any(|x| x == p) {
                        cur.required_by.push(p.to_string());
                    }
                }
                if cmp_version(&want, &cur.version) != Ordering::Greater {
                    return;
                }
                cur.version = want.clone();
            }
            None => {
                self.resolved.insert(
                    id.clone(),
                    Resolved { version: want.clone(), required_by: parent.map(|p| vec![p.to_string()]).unwrap_or_default() },
                );
            }
        }
        let deps = pkg.versions.iter().find(|v| v.v == want).map(|v| v.deps.clone()).unwrap_or_default();
        for d in deps {
            if let Some(f) = parse_full_name(&d) {
                self.visit(&f.ns, &f.name, &f.version, Some(&id));
            }
        }
    }
}

/// Reine Funktion: Abhängigkeitsabschluss des Profils + Diff gegen installed.json.
pub fn plan(mods: &[ProfileMod], by_id: &HashMap<String, Pkg>, installed: &Installed) -> Plan {
    let mut r = Resolver { by_id, resolved: BTreeMap::new(), errors: vec![] };
    for m in mods {
        match m.source {
            Source::Thunderstore => r.visit(&m.namespace, &m.name, &m.version, None),
            Source::Local => {
                let id = m.id();
                r.resolved.insert(id.clone(), Resolved { version: m.version.clone(), required_by: vec![] });
                for d in &m.deps {
                    if let Some(f) = parse_full_name(d) {
                        r.visit(&f.ns, &f.name, &f.version, Some(&id));
                    }
                }
            }
        }
    }
    if !mods.is_empty() && !r.resolved.contains_key(BEPINEX_PACK_ID) {
        match by_id.get(BEPINEX_PACK_ID).and_then(|p| p.versions.first().map(|v| (p, v.v.clone()))) {
            Some((p, v)) => r.visit(&p.ns, &p.name, &v, None),
            None => r.errors.push("BepInExPack_Valheim ist nicht im Mod-Index.".to_string()),
        }
    }
    let mut errors = r.errors;
    errors.dedup();
    let to_install = r
        .resolved
        .iter()
        .filter(|(id, res)| installed.get(*id).map(|e| &e.version) != Some(&res.version))
        .map(|(id, res)| ToInstall { id: id.clone(), from: installed.get(id).map(|e| e.version.clone()), to: res.version.clone() })
        .collect();
    let to_remove = installed.keys().filter(|id| !r.resolved.contains_key(*id)).cloned().collect();
    Plan { resolved: r.resolved, to_install, to_remove, errors }
}

/// Explizite Thunderstore-Mods, für die der Index eine neuere Version kennt.
pub fn updates(mods: &[ProfileMod], by_id: &HashMap<String, Pkg>) -> BTreeMap<String, String> {
    mods.iter()
        .filter(|m| m.source == Source::Thunderstore)
        .filter_map(|m| {
            let latest = by_id.get(&m.id())?.versions.first()?;
            (cmp_version(&m.version, &latest.v) == Ordering::Less).then(|| (m.id(), latest.v.clone()))
        })
        .collect()
}
```

- [ ] **Step 4: `mod resolver;` ergänzen, Tests laufen lassen**

Run: `cd src-tauri && cargo test resolver::`
Expected: PASS (9 Tests)

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src
git commit -m "feat(core): dependency resolver with auto BepInExPack and local mods"
```

---

### Task 4: Thunderstore-Index

**Files:**

- Create: `src-tauri/src/thunderstore.rs`
- Modify: `src-tauri/src/lib.rs` (`mod thunderstore;`)

**Interfaces:**

- Consumes: `models::{Pkg, Version}`, `util::{now_ms, write_atomic}`, `AppError`
- Produces:
  - `thunderstore::{API_URL, download_url(ns,name,ver)->String, parse_raw(&[u8])->Result<Vec<Pkg>>, Index{fetched_at:i64, by_id:HashMap<String,Pkg>, slim_json:Vec<u8>}, build(i64, Vec<Pkg>)->Index, load_cache(&Path)->Option<Index>, save_cache(&Path,i64,&[Pkg])->Result<()>, fetch(&reqwest::Client)->Result<Vec<Pkg>>}`
  - `thunderstore::IndexStore` mit `new()`, `get()->Option<Arc<Index>>`, `set(Index)`, `age_ms()->Option<i64>`
  - `thunderstore::refresh(&IndexStore, &reqwest::Client, &Path cache, force: bool) -> Result<bool>` (true = neuer Index gesetzt)

- [ ] **Step 1: Failing Tests schreiben**

```rust
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
        assert!(slim["packages"][0].get("versions").is_none());

        let dir = tempfile::tempdir().unwrap();
        let cache = dir.path().join("cache").join("index.json");
        assert!(load_cache(&cache).is_none());
        save_cache(&cache, 1000, &pkgs).unwrap();
        let loaded = load_cache(&cache).unwrap();
        assert_eq!(loaded.fetched_at, 1000);
        assert_eq!(loaded.by_id["denikson-BepInExPack_Valheim"], pkgs[0]);
    }

    #[test]
    fn store_reports_age() {
        let s = IndexStore::new();
        assert!(s.get().is_none() && s.age_ms().is_none());
        s.set(build(crate::util::now_ms() - 5_000, vec![]));
        assert!(s.age_ms().unwrap() >= 5_000);
    }
}
```

- [ ] **Step 2: Tests laufen lassen, Fehlschlag prüfen**

Run: `cd src-tauri && cargo test thunderstore::`
Expected: FAIL

- [ ] **Step 3: Implementieren**

```rust
//! Thunderstore-Index: einmal geholt, kompaktiert, im RAM (O(1)-Lookups) und auf
//! Platte gehalten. Das Frontend bekommt ein vorgerendertes Slim-JSON.
use crate::error::{AppError, Result};
use crate::models::{Pkg, Version};
use crate::util::{now_ms, write_atomic};
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
    s.as_deref()
        .and_then(|d| chrono::DateTime::parse_from_rfc3339(d).ok())
        .map(|d| d.timestamp_millis())
        .unwrap_or(0)
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
                }
            })
            .collect(),
    };
    let slim_json = serde_json::to_vec(&slim).expect("slim index serialisierbar");
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

pub async fn fetch(client: &reqwest::Client) -> Result<Vec<Pkg>> {
    let res = client.get(API_URL).send().await?;
    if !res.status().is_success() {
        return Err(AppError::Network(format!("Thunderstore-API antwortet mit {}", res.status())));
    }
    let bytes = res.bytes().await?;
    tokio::task::spawn_blocking(move || parse_raw(&bytes))
        .await
        .map_err(|e| AppError::Invalid(e.to_string()))?
}

pub struct IndexStore {
    current: RwLock<Option<Arc<Index>>>,
    refresh_lock: tokio::sync::Mutex<()>,
    last_failure: Mutex<Option<Instant>>,
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

/// Holt den Index neu. Ohne `force` wird nach einem Fehlschlag 5 min pausiert,
/// solange noch ein (alter) Index vorhanden ist.
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
```

- [ ] **Step 4: `mod thunderstore;` ergänzen, Tests laufen lassen**

Run: `cd src-tauri && cargo test thunderstore::`
Expected: PASS (3 Tests)

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src
git commit -m "feat(core): thunderstore index with disk cache and slim payload"
```

---

### Task 5: Installer (Extraktion, Entfernen, An/Aus)

**Files:**

- Create: `src-tauri/src/install.rs`
- Modify: `src-tauri/src/lib.rs` (`mod install;`)

**Interfaces:**

- Consumes: `util::{safe_join, with_old}`, `AppError`
- Produces (Test-Helfer: `#[cfg(test)] install::tests::make_zip(&Path dir, &str name, &[(&str, &str)]) -> PathBuf`): `install::{extract_zip(&Path zip, &Path profile_dir, &str id) -> Result<Vec<String>>, install_local(&Path src_dir, &Path profile_dir, &str id) -> Result<Vec<String>>, remove_files(&Path profile_dir, &[String]) -> Result<()>, set_enabled(&Path profile_dir, &[String], bool) -> Result<()>, zip_entry_parts(&str) -> Option<Vec<String>>}`
- Rückgabe-Dateilisten: relativ zum Profilordner, `/`-getrennt, sortiert; `BepInEx/config/**` ist nie enthalten.

- [ ] **Step 1: Failing Tests schreiben**

```rust
#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use std::io::Write;

    pub(crate) fn make_zip(dir: &Path, name: &str, files: &[(&str, &str)]) -> std::path::PathBuf {
        let path = dir.join(name);
        let mut w = zip::ZipWriter::new(std::fs::File::create(&path).unwrap());
        let opts = zip::write::SimpleFileOptions::default();
        for (n, content) in files {
            w.start_file(*n, opts).unwrap();
            w.write_all(content.as_bytes()).unwrap();
        }
        w.finish().unwrap();
        path
    }

    fn read(p: &Path, rel: &str) -> String {
        std::fs::read_to_string(p.join(rel)).unwrap()
    }

    #[test]
    fn bare_layout_goes_to_plugins_folder() {
        let d = tempfile::tempdir().unwrap();
        let zip = make_zip(d.path(), "m.zip", &[("manifest.json", "{}"), ("icon.png", "x"), ("README.md", "r"), ("Mod.dll", "dll"), ("sub/a.txt", "a")]);
        let prof = d.path().join("p");
        let files = extract_zip(&zip, &prof, "ns-Mod").unwrap();
        assert_eq!(files, vec!["BepInEx/plugins/ns-Mod/Mod.dll", "BepInEx/plugins/ns-Mod/sub/a.txt"]);
        assert_eq!(read(&prof, "BepInEx/plugins/ns-Mod/Mod.dll"), "dll");
    }

    #[test]
    fn subfolder_layout_merges_and_protects_configs() {
        let d = tempfile::tempdir().unwrap();
        let prof = d.path().join("p");
        std::fs::create_dir_all(prof.join("BepInEx/config")).unwrap();
        std::fs::write(prof.join("BepInEx/config/mod.cfg"), "user").unwrap();
        let zip = make_zip(d.path(), "m.zip", &[("Plugins/Mod.dll", "dll"), ("config/mod.cfg", "shipped"), ("config/new.cfg", "new"), ("extra.txt", "e"), ("icon.png", "i")]);
        let files = extract_zip(&zip, &prof, "ns-Mod").unwrap();
        assert_eq!(files, vec!["BepInEx/plugins/Mod.dll", "BepInEx/plugins/ns-Mod/extra.txt"]);
        assert_eq!(read(&prof, "BepInEx/config/mod.cfg"), "user");
        assert_eq!(read(&prof, "BepInEx/config/new.cfg"), "new");
    }

    #[test]
    fn bepinex_root_layout_merges_directly() {
        let d = tempfile::tempdir().unwrap();
        let zip = make_zip(d.path(), "m.zip", &[("BepInEx/plugins/X/x.dll", "x"), ("BepInEx/patchers/p.dll", "p"), ("manifest.json", "{}")]);
        let prof = d.path().join("p");
        let files = extract_zip(&zip, &prof, "ns-X").unwrap();
        assert_eq!(files, vec!["BepInEx/patchers/p.dll", "BepInEx/plugins/X/x.dll"]);
    }

    #[test]
    fn bepinex_pack_layout_splits_doorstop_files() {
        let d = tempfile::tempdir().unwrap();
        let zip = make_zip(d.path(), "m.zip", &[
            ("manifest.json", "{}"),
            ("BepInExPack_Valheim/winhttp.dll", "w"),
            ("BepInExPack_Valheim/doorstop_config.ini", "[General]"),
            ("BepInExPack_Valheim/.doorstop_version", "4.4.0"),
            ("BepInExPack_Valheim/doorstop_libs/libdoorstop_x64.so", "so"),
            ("BepInExPack_Valheim/start_game_bepinex.sh", "sh"),
            ("BepInExPack_Valheim/BepInEx/core/BepInEx.Preloader.dll", "pre"),
            ("BepInExPack_Valheim/BepInEx/config/BepInEx.cfg", "cfg"),
        ]);
        let prof = d.path().join("p");
        let files = extract_zip(&zip, &prof, "denikson-BepInExPack_Valheim").unwrap();
        assert_eq!(files, vec![
            "BepInEx/core/BepInEx.Preloader.dll",
            "doorstop/.doorstop_version",
            "doorstop/doorstop_config.ini",
            "doorstop/doorstop_libs/libdoorstop_x64.so",
            "doorstop/winhttp.dll",
        ]);
        assert_eq!(read(&prof, "BepInEx/config/BepInEx.cfg"), "cfg");
        assert!(!prof.join("start_game_bepinex.sh").exists());
    }

    #[test]
    fn rejects_zip_slip() {
        let d = tempfile::tempdir().unwrap();
        let zip = make_zip(d.path(), "m.zip", &[("../evil.dll", "x")]);
        assert!(extract_zip(&zip, &d.path().join("p"), "ns-X").is_err());
        assert!(!d.path().join("evil.dll").exists());
    }

    #[test]
    fn remove_prunes_empty_dirs_and_old_files() {
        let d = tempfile::tempdir().unwrap();
        let zip = make_zip(d.path(), "m.zip", &[("a.dll", "a"), ("b.dll", "b")]);
        let prof = d.path().join("p");
        let files = extract_zip(&zip, &prof, "ns-M").unwrap();
        set_enabled(&prof, &files[..1], false).unwrap();
        remove_files(&prof, &files).unwrap();
        assert!(!prof.join("BepInEx/plugins/ns-M").exists());
        assert!(prof.exists());
    }

    #[test]
    fn toggling_renames_to_old_and_back() {
        let d = tempfile::tempdir().unwrap();
        let zip = make_zip(d.path(), "m.zip", &[("a.dll", "a")]);
        let prof = d.path().join("p");
        let files = extract_zip(&zip, &prof, "ns-M").unwrap();
        set_enabled(&prof, &files, false).unwrap();
        assert!(prof.join("BepInEx/plugins/ns-M/a.dll.old").exists());
        assert!(!prof.join("BepInEx/plugins/ns-M/a.dll").exists());
        set_enabled(&prof, &files, false).unwrap();
        set_enabled(&prof, &files, true).unwrap();
        assert_eq!(read(&prof, "BepInEx/plugins/ns-M/a.dll"), "a");
    }

    #[test]
    fn installs_local_dll_and_local_zip() {
        let d = tempfile::tempdir().unwrap();
        let src = d.path().join("local/local-Mine");
        std::fs::create_dir_all(&src).unwrap();
        std::fs::write(src.join("Mine.dll"), "m").unwrap();
        let prof = d.path().join("p");
        assert_eq!(install_local(&src, &prof, "local-Mine").unwrap(), vec!["BepInEx/plugins/local-Mine/Mine.dll"]);

        let src2 = d.path().join("local/local-Z");
        std::fs::create_dir_all(&src2).unwrap();
        make_zip(&src2, "z.zip", &[("manifest.json", "{}"), ("z.dll", "z")]);
        assert_eq!(install_local(&src2, &prof, "local-Z").unwrap(), vec!["BepInEx/plugins/local-Z/z.dll"]);
    }
}
```

- [ ] **Step 2: Tests laufen lassen, Fehlschlag prüfen**

Run: `cd src-tauri && cargo test install::`
Expected: FAIL

- [ ] **Step 3: Implementieren**

```rust
//! Entpackt Thunderstore-Zips in einen Profilordner nach den üblichen Konventionen
//! und verwaltet die installierten Dateien (Entfernen, Aktivieren/Deaktivieren).
use crate::error::{AppError, Result};
use crate::util::{safe_join, with_old};
use std::collections::BTreeSet;
use std::fs::File;
use std::io::BufReader;
use std::path::{Path, PathBuf};

const EXCLUDED_ROOT_FILES: [&str; 4] = ["icon.png", "manifest.json", "readme.md", "changelog.md"];
const BEPINEX_SUBFOLDERS: [&str; 5] = ["plugins", "patchers", "config", "core", "monomod"];
const CONFIG_PREFIX: &str = "BepInEx/config/";

enum Layout {
    /// Zip enthält `BepInExPack_*/` (das BepInEx-Paket selbst).
    Pack(String),
    /// Zip enthält `BepInEx/` an der Wurzel.
    BepInExRoot(String),
    /// Zip enthält `plugins/`, `config/` … an der Wurzel.
    Subfolders,
    /// Alles andere.
    Bare,
}

/// Zerlegt einen Zip-Eintragsnamen; `None` bei unsicheren Pfaden.
pub fn zip_entry_parts(name: &str) -> Option<Vec<String>> {
    let n = name.replace('\\', "/");
    if n.starts_with('/') {
        return None;
    }
    let mut parts = vec![];
    for p in n.split('/') {
        match p {
            "" | "." => {}
            ".." => return None,
            p if p.contains(':') => return None,
            p => parts.push(p.to_string()),
        }
    }
    Some(parts)
}

fn detect_layout(entries: &[(usize, Vec<String>, bool)]) -> Layout {
    let dirs: BTreeSet<&str> = entries
        .iter()
        .filter(|(_, parts, is_dir)| parts.len() > 1 || *is_dir)
        .map(|(_, parts, _)| parts[0].as_str())
        .collect();
    if let Some(d) = dirs.iter().find(|d| d.to_ascii_lowercase().starts_with("bepinexpack")) {
        return Layout::Pack(d.to_string());
    }
    if let Some(d) = dirs.iter().find(|d| d.eq_ignore_ascii_case("bepinex")) {
        return Layout::BepInExRoot(d.to_string());
    }
    if dirs.iter().any(|d| BEPINEX_SUBFOLDERS.contains(&d.to_ascii_lowercase().as_str())) {
        return Layout::Subfolders;
    }
    Layout::Bare
}

fn join(head: &[&str], rest: &[String]) -> Vec<String> {
    head.iter().map(|s| s.to_string()).chain(rest.iter().cloned()).collect()
}

/// Zielpfad (relativ zum Profilordner) für einen Zip-Eintrag, `None` = überspringen.
fn map_target(layout: &Layout, parts: &[String], id: &str) -> Option<Vec<String>> {
    let first = parts[0].to_ascii_lowercase();
    let root_file_excluded = parts.len() == 1 && EXCLUDED_ROOT_FILES.contains(&first.as_str());
    match layout {
        Layout::Pack(root) => {
            if parts[0] != *root || parts.len() < 2 {
                return None;
            }
            let rest = &parts[1..];
            match rest[0].to_ascii_lowercase().as_str() {
                "bepinex" if rest.len() > 1 => Some(join(&["BepInEx"], &rest[1..])),
                "winhttp.dll" | "doorstop_config.ini" | ".doorstop_version" if rest.len() == 1 => Some(join(&["doorstop"], rest)),
                "doorstop_libs" => Some(join(&["doorstop"], rest)),
                "unstripped_corlib" => Some(rest.to_vec()),
                _ => None,
            }
        }
        Layout::BepInExRoot(root) => (parts[0] == *root && parts.len() > 1).then(|| join(&["BepInEx"], &parts[1..])),
        Layout::Subfolders => {
            if parts.len() > 1 && BEPINEX_SUBFOLDERS.contains(&first.as_str()) {
                Some(join(&["BepInEx", &first], &parts[1..]))
            } else if root_file_excluded {
                None
            } else {
                Some(join(&["BepInEx", "plugins", id], parts))
            }
        }
        Layout::Bare => (!root_file_excluded).then(|| join(&["BepInEx", "plugins", id], parts)),
    }
}

pub fn extract_zip(zip_path: &Path, profile_dir: &Path, id: &str) -> Result<Vec<String>> {
    let mut archive = zip::ZipArchive::new(BufReader::new(File::open(zip_path)?))?;
    let mut entries = vec![];
    for i in 0..archive.len() {
        let e = archive.by_index(i)?;
        let parts = zip_entry_parts(e.name()).ok_or_else(|| AppError::Invalid(format!("Unsicherer Pfad in {id}: {}", e.name())))?;
        if !parts.is_empty() {
            entries.push((i, parts, e.is_dir()));
        }
    }
    let layout = detect_layout(&entries);
    let mut written = vec![];
    for (i, parts, is_dir) in &entries {
        if *is_dir {
            continue;
        }
        let Some(target) = map_target(&layout, parts, id) else { continue };
        let rel = target.join("/");
        let dest = safe_join(profile_dir, &rel)?;
        let is_config = rel.starts_with(CONFIG_PREFIX);
        if is_config && dest.exists() {
            continue; // Nutzer-Configs nie überschreiben
        }
        if let Some(parent) = dest.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let mut entry = archive.by_index(*i)?;
        let mut out = File::create(&dest)?;
        std::io::copy(&mut entry, &mut out)?;
        if !is_config {
            written.push(rel);
        }
    }
    written.sort();
    written.dedup();
    Ok(written)
}

/// Lokaler Mod: enthält `src_dir` eine Zip, wird sie entpackt, sonst werden alle
/// Dateien nach `BepInEx/plugins/<id>/` kopiert.
pub fn install_local(src_dir: &Path, profile_dir: &Path, id: &str) -> Result<Vec<String>> {
    let files: Vec<PathBuf> = std::fs::read_dir(src_dir)?.filter_map(|e| e.ok()).map(|e| e.path()).filter(|p| p.is_file()).collect();
    if let Some(zip) = files.iter().find(|p| p.extension().is_some_and(|x| x.eq_ignore_ascii_case("zip"))) {
        return extract_zip(zip, profile_dir, id);
    }
    let mut written = vec![];
    for f in files {
        let name = f.file_name().unwrap().to_string_lossy().to_string();
        let rel = format!("BepInEx/plugins/{id}/{name}");
        let dest = safe_join(profile_dir, &rel)?;
        std::fs::create_dir_all(dest.parent().unwrap())?;
        std::fs::copy(&f, &dest)?;
        written.push(rel);
    }
    written.sort();
    Ok(written)
}

fn remove_if_exists(p: &Path) -> Result<()> {
    match std::fs::remove_file(p) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.into()),
        _ => Ok(()),
    }
}

pub fn remove_files(profile_dir: &Path, files: &[String]) -> Result<()> {
    let mut dirs = BTreeSet::new();
    for f in files {
        let p = safe_join(profile_dir, f)?;
        remove_if_exists(&p)?;
        remove_if_exists(&with_old(&p))?;
        if let Some(parent) = p.parent() {
            dirs.insert(parent.to_path_buf());
        }
    }
    let mut dirs: Vec<PathBuf> = dirs.into_iter().collect();
    dirs.sort_by_key(|d| std::cmp::Reverse(d.components().count()));
    for d in dirs {
        let mut cur = d;
        while cur.starts_with(profile_dir) && cur != profile_dir {
            let empty = std::fs::read_dir(&cur).map(|mut rd| rd.next().is_none()).unwrap_or(false);
            if !empty || std::fs::remove_dir(&cur).is_err() {
                break;
            }
            match cur.parent() {
                Some(p) => cur = p.to_path_buf(),
                None => break,
            }
        }
    }
    Ok(())
}

/// Deaktivieren = `x` → `x.old`, Aktivieren = zurück. Configs und Doorstop bleiben unberührt.
pub fn set_enabled(profile_dir: &Path, files: &[String], enabled: bool) -> Result<()> {
    for f in files.iter().filter(|f| !f.starts_with(CONFIG_PREFIX) && !f.starts_with("doorstop/")) {
        let p = safe_join(profile_dir, f)?;
        let old = with_old(&p);
        if enabled {
            if old.exists() && !p.exists() {
                std::fs::rename(&old, &p)?;
            }
        } else if p.exists() {
            remove_if_exists(&old)?;
            std::fs::rename(&p, &old)?;
        }
    }
    Ok(())
}
```

- [ ] **Step 4: `mod install;` ergänzen, Tests laufen lassen**

Run: `cd src-tauri && cargo test install::`
Expected: PASS (8 Tests)

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src
git commit -m "feat(core): zip installer with layout detection, config protection, toggling"
```

---

### Task 6: Sync (Download-Pool, Installation, Warteschlange)

**Files:**

- Create: `src-tauri/src/sync.rs`
- Modify: `src-tauri/src/lib.rs` (`mod sync;`)

**Interfaces:**

- Consumes: `profiles::{load, load_installed, save_installed}`, `resolver::plan`, `install::{extract_zip, install_local, remove_files, set_enabled}`, `thunderstore::{Index, download_url}`, `Paths`
- Produces:
  - `sync::Progress { id: String, phase: &'static str /* "download"|"remove"|"extract" */, done: usize, total: usize }` (Serialize)
  - `sync::SyncResult { profile: String, installed: Vec<String>, removed: Vec<String>, errors: Vec<String> }` (Serialize, Default)
  - `sync::ProgressFn = Arc<dyn Fn(Progress) + Send + Sync>`
  - `sync::SyncJob { paths: Paths, profile: String, index: Option<Arc<Index>>, client: reqwest::Client, concurrency: usize, repair: bool }`
  - `sync::run_sync(SyncJob, ProgressFn) -> Result<SyncResult>` (async)
  - `sync::SyncStatus { running: bool, queued: bool }` (Serialize, PartialEq)
  - `sync::SyncHandle` (Default) mit öffentlichem Feld `lock: tokio::sync::Mutex<()>` und `enqueue(&str, bool) -> bool` (true = Aufrufer startet Worker), `next() -> Option<(String, bool)>`, `status() -> SyncStatus`

- [ ] **Step 1: Failing Tests schreiben**

```rust
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
        make_zip(&paths.downloads(), &format!("{BEPINEX_PACK_ID}-5.4.2351.zip"), &[
            ("BepInExPack_Valheim/winhttp.dll", "w"),
            ("BepInExPack_Valheim/doorstop_config.ini", "[General]"),
            ("BepInExPack_Valheim/BepInEx/core/BepInEx.Preloader.dll", "pre"),
        ]);
        make_zip(&paths.downloads(), "a-A-1.0.0.zip", &[("A.dll", "1.0.0")]);
        make_zip(&paths.downloads(), "a-A-2.0.0.zip", &[("A.dll", "2.0.0")]);
        let idx = build(0, vec![
            test_pkg(BEPINEX_PACK_ID, &[("5.4.2351", &[])]),
            test_pkg("a-A", &[("2.0.0", &[]), ("1.0.0", &[])]),
        ]);
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
        set_mods(&paths, vec![ProfileMod { namespace: "local".into(), name: "Mine".into(), version: "0.0.0".into(), enabled: true, source: Source::Local, deps: vec![] }]);
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
```

- [ ] **Step 2: Tests laufen lassen, Fehlschlag prüfen**

Run: `cd src-tauri && cargo test sync::`
Expected: FAIL

- [ ] **Step 3: Implementieren**

```rust
//! Bringt einen Profilordner in den Zustand, den profile.json beschreibt.
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
    let index = job
        .index
        .clone()
        .ok_or_else(|| AppError::Invalid("Der Mod-Index ist noch nicht geladen. Bitte kurz warten und erneut versuchen.".into()))?;
    let profile = profiles::load(&job.paths, &job.profile)?;
    let installed = profiles::load_installed(&job.paths, &job.profile);
    let plan = resolver::plan(&profile.mods, &index.by_id, &installed);

    // Explizite Mods, die (noch) nicht im Index stehen, nie deinstallieren.
    let explicit: HashSet<String> = profile.mods.iter().map(|m| m.id()).collect();
    let to_remove: Vec<String> = plan.to_remove.iter().filter(|id| !explicit.contains(*id)).cloned().collect();
    let to_install: Vec<ToInstall> = if job.repair {
        plan.resolved
            .iter()
            .map(|(id, r)| ToInstall { id: id.clone(), from: installed.get(id).map(|e| e.version.clone()), to: r.version.clone() })
            .collect()
    } else {
        plan.to_install.clone()
    };
    let local: HashSet<String> = profile.mods.iter().filter(|m| m.source == Source::Local).map(|m| m.id()).collect();
    let disabled: HashSet<String> = profile.mods.iter().filter(|m| !m.enabled).map(|m| m.id()).collect();
    let mut result = SyncResult { profile: job.profile.clone(), errors: plan.errors.clone(), ..Default::default() };

    // 1) Downloads parallel (netzgebunden)
    let downloads: Vec<(String, String)> = to_install
        .iter()
        .filter(|t| !local.contains(&t.id) && !job.paths.zip_cache(&t.id, &t.to).exists())
        .map(|t| (t.id.clone(), t.to.clone()))
        .collect();
    let total = downloads.len();
    let mut stream = futures::stream::iter(downloads.into_iter().map(|(id, version)| {
        let client = job.client.clone();
        let pkg = index.by_id.get(&id).cloned();
        let dest = job.paths.zip_cache(&id, &version);
        async move {
            let r = match pkg {
                Some(p) => download(&client, &download_url(&p.ns, &p.name, &version), &dest).await,
                None => Err(AppError::NotFound(format!("{id} nicht im Index"))),
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
            result.errors.push(format!("Download fehlgeschlagen ({id}): {e}"));
        }
    }
    drop(stream);

    // 2) + 3) Entfernen und Entpacken nacheinander (plattengebunden)
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
                    Err(e) => result.errors.push(format!("Deinstallation fehlgeschlagen ({id}): {e}")),
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
                    result.errors.push(format!("Lokale Dateien fehlen ({})", t.id));
                }
                continue; // Download-Fehler ist bereits vermerkt
            }
            if let Some(old) = installed.remove(&t.id) {
                if let Err(e) = install::remove_files(&dir, &old.files) {
                    result.errors.push(format!("Alte Version nicht entfernbar ({}): {e}", t.id));
                    installed.insert(t.id.clone(), old);
                    continue;
                }
            }
            let files = if is_local { install::install_local(&local_src, &dir, &t.id) } else { install::extract_zip(&zip, &dir, &t.id) };
            match files {
                Ok(files) => {
                    if disabled.contains(&t.id) {
                        if let Err(e) = install::set_enabled(&dir, &files, false) {
                            result.errors.push(format!("Deaktivieren fehlgeschlagen ({}): {e}", t.id));
                        }
                    }
                    installed.insert(t.id.clone(), InstalledEntry { version: t.to.clone(), files });
                    result.installed.push(format!("{}@{}", t.id, t.to));
                }
                Err(e) => {
                    if !is_local {
                        let _ = std::fs::remove_file(&zip); // beim nächsten Sync neu laden
                    }
                    result.errors.push(format!("Installation fehlgeschlagen ({}): {e}", t.id));
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

/// Serialisiert Syncs: ein Worker, Anfragen pro Profil zusammengefasst.
#[derive(Default)]
pub struct SyncHandle {
    /// Wird für die Dauer eines Syncs gehalten; auch von An/Aus und Spielstart genutzt.
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
```

- [ ] **Step 4: `mod sync;` ergänzen, Tests laufen lassen**

Run: `cd src-tauri && cargo test sync::`
Expected: PASS (7 Tests)

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src
git commit -m "feat(core): sync engine with parallel downloads and request queue"
```

---

### Task 7: Config-Editor-Backend

**Files:**

- Create: `src-tauri/src/config.rs`
- Modify: `src-tauri/src/lib.rs` (`mod config;`)

**Interfaces:**

- Consumes: `util::safe_join`
- Produces: `config::{ConfigSetting, ParsedConfig, ConfigChange, list_files(&Path)->Vec<String>, list_files_with_ext(&Path,&[&str])->Vec<String>, parse_str(&str,&str)->ParsedConfig, parse_file(&Path,&str)->Result<ParsedConfig>, apply_changes(&str,&[ConfigChange])->String, save_changes(&Path,&str,&[ConfigChange])->Result<()>}`. JSON-Form wie bisher (`type`, `defaultValue`, `acceptableValues`).

- [ ] **Step 1: Failing Tests schreiben**

```rust
#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = "## Settings file was created by plugin X\r\n\r\n[General]\r\n\r\n## Enables the thing\r\n## really\r\n# Setting type: Boolean\r\n# Default value: true\r\nEnabled = true\r\n\r\n[Keys]\r\n# Setting type: KeyCode\r\n# Acceptable values: None, A, B\r\nHotkey =  A \r\nNoEquals line\r\n";

    #[test]
    fn parses_settings_with_metadata() {
        let c = parse_str("x.cfg", SAMPLE);
        assert_eq!(c.settings.len(), 2);
        let s = &c.settings[0];
        assert_eq!((s.section.as_str(), s.key.as_str(), s.value.as_str()), ("General", "Enabled", "true"));
        assert_eq!(s.description, "Enables the thing really");
        assert_eq!(s.type_.as_deref(), Some("Boolean"));
        assert_eq!(s.default_value.as_deref(), Some("true"));
        let h = &c.settings[1];
        assert_eq!(h.value, "A ");
        assert_eq!(h.acceptable_values.as_deref(), Some("None, A, B"));
        let json = serde_json::to_value(&c).unwrap();
        assert_eq!(json["settings"][0]["type"], "Boolean");
        assert_eq!(json["settings"][0]["defaultValue"], "true");
    }

    #[test]
    fn applies_changes_preserving_everything_else() {
        let out = apply_changes(SAMPLE, &[
            ConfigChange { section: "Keys".into(), key: "Hotkey".into(), value: "B".into() },
            ConfigChange { section: "Other".into(), key: "Enabled".into(), value: "false".into() },
        ]);
        assert_eq!(out, SAMPLE.replace("Hotkey =  A ", "Hotkey =  B"));
    }

    #[test]
    fn lists_nested_files_and_blocks_traversal() {
        let d = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(d.path().join("sub")).unwrap();
        std::fs::write(d.path().join("b.cfg"), SAMPLE).unwrap();
        std::fs::write(d.path().join("sub/a.cfg"), "").unwrap();
        std::fs::write(d.path().join("sub/data.json"), "{}").unwrap();
        assert_eq!(list_files(d.path()), vec!["b.cfg", "sub/a.cfg"]);
        assert_eq!(list_files_with_ext(d.path(), &["cfg", "json"]), vec!["b.cfg", "sub/a.cfg", "sub/data.json"]);
        assert!(parse_file(d.path(), "../b.cfg").is_err());
        save_changes(d.path(), "b.cfg", &[ConfigChange { section: "General".into(), key: "Enabled".into(), value: "false".into() }]).unwrap();
        assert_eq!(parse_file(d.path(), "b.cfg").unwrap().settings[0].value, "false");
        assert!(list_files(&d.path().join("missing")).is_empty());
    }
}
```

- [ ] **Step 2: Tests laufen lassen, Fehlschlag prüfen**

Run: `cd src-tauri && cargo test config::`
Expected: FAIL

- [ ] **Step 3: Implementieren**

```rust
//! BepInEx-.cfg-Dateien lesen und gezielt einzelne Werte zurückschreiben.
use crate::error::Result;
use crate::util::safe_join;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ConfigSetting {
    pub section: String,
    pub key: String,
    pub value: String,
    pub description: String,
    #[serde(rename = "type", skip_serializing_if = "Option::is_none")]
    pub type_: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_value: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub acceptable_values: Option<String>,
}

#[derive(Serialize, Debug)]
pub struct ParsedConfig {
    pub file: String,
    pub settings: Vec<ConfigSetting>,
}

#[derive(Deserialize, Debug, Clone)]
pub struct ConfigChange {
    pub section: String,
    pub key: String,
    pub value: String,
}

pub fn list_files_with_ext(dir: &Path, exts: &[&str]) -> Vec<String> {
    fn walk(dir: &Path, prefix: &str, exts: &[&str], out: &mut Vec<String>) {
        let Ok(rd) = std::fs::read_dir(dir) else { return };
        for e in rd.flatten() {
            let name = e.file_name().to_string_lossy().to_string();
            let rel = if prefix.is_empty() { name.clone() } else { format!("{prefix}/{name}") };
            if e.path().is_dir() {
                walk(&e.path(), &rel, exts, out);
            } else if Path::new(&name).extension().is_some_and(|x| exts.iter().any(|ext| x.eq_ignore_ascii_case(ext))) {
                out.push(rel);
            }
        }
    }
    let mut out = vec![];
    walk(dir, "", exts, &mut out);
    out.sort();
    out
}

pub fn list_files(dir: &Path) -> Vec<String> {
    list_files_with_ext(dir, &["cfg"])
}

fn section_header(trimmed: &str) -> Option<&str> {
    (trimmed.len() >= 2 && trimmed.starts_with('[') && trimmed.ends_with(']')).then(|| &trimmed[1..trimmed.len() - 1])
}

/// `(key, Byte-Offset des Werts)` für `key = value`-Zeilen.
fn split_kv(line: &str) -> Option<(String, usize)> {
    let eq = line.find('=')?;
    let key = line[..eq].trim();
    if key.is_empty() {
        return None;
    }
    let after = &line[eq + 1..];
    Some((key.to_string(), eq + 1 + (after.len() - after.trim_start().len())))
}

fn strip_ci<'a>(s: &'a str, prefix: &str) -> Option<&'a str> {
    s.get(..prefix.len()).filter(|p| p.eq_ignore_ascii_case(prefix)).map(|_| s[prefix.len()..].trim())
}

pub fn parse_str(file: &str, raw: &str) -> ParsedConfig {
    let mut settings = vec![];
    let mut section = String::new();
    let mut comments: Vec<String> = vec![];
    for line in raw.lines() {
        let t = line.trim();
        if let Some(s) = section_header(t) {
            section = s.to_string();
            comments.clear();
        } else if t.starts_with('#') {
            comments.push(t.trim_start_matches('#').trim_start().to_string());
        } else if let Some((key, vstart)) = (!t.is_empty()).then(|| split_kv(line)).flatten() {
            let mut desc = vec![];
            let (mut type_, mut default_value, mut acceptable_values) = (None, None, None);
            for c in comments.drain(..) {
                if let Some(v) = strip_ci(&c, "Setting type:") {
                    type_ = Some(v.to_string());
                } else if let Some(v) = strip_ci(&c, "Default value:") {
                    default_value = Some(v.to_string());
                } else if let Some(v) = strip_ci(&c, "Acceptable values:").or_else(|| strip_ci(&c, "Acceptable value range:")) {
                    acceptable_values = Some(v.to_string());
                } else {
                    desc.push(c);
                }
            }
            settings.push(ConfigSetting {
                section: section.clone(),
                key,
                value: line[vstart..].to_string(),
                description: desc.join(" ").trim().to_string(),
                type_,
                default_value,
                acceptable_values,
            });
        }
    }
    ParsedConfig { file: file.to_string(), settings }
}

pub fn parse_file(dir: &Path, rel: &str) -> Result<ParsedConfig> {
    let raw = std::fs::read_to_string(safe_join(dir, rel)?)?;
    Ok(parse_str(rel, &raw))
}

pub fn apply_changes(raw: &str, changes: &[ConfigChange]) -> String {
    let map: HashMap<(&str, &str), &str> = changes.iter().map(|c| ((c.section.as_str(), c.key.as_str()), c.value.as_str())).collect();
    let mut section = String::new();
    let out: Vec<String> = raw
        .split('\n')
        .map(|l| l.strip_suffix('\r').unwrap_or(l))
        .map(|line| {
            let t = line.trim();
            if let Some(s) = section_header(t) {
                section = s.to_string();
            } else if !t.starts_with('#') && !t.is_empty() {
                if let Some((key, vstart)) = split_kv(line) {
                    if let Some(v) = map.get(&(section.as_str(), key.as_str())) {
                        return format!("{}{}", &line[..vstart], v);
                    }
                }
            }
            line.to_string()
        })
        .collect();
    out.join(if raw.contains("\r\n") { "\r\n" } else { "\n" })
}

pub fn save_changes(dir: &Path, rel: &str, changes: &[ConfigChange]) -> Result<()> {
    let path = safe_join(dir, rel)?;
    let raw = std::fs::read_to_string(&path)?;
    std::fs::write(&path, apply_changes(&raw, changes))?;
    Ok(())
}
```

- [ ] **Step 4: `mod config;` ergänzen, Tests laufen lassen**

Run: `cd src-tauri && cargo test config::`
Expected: PASS (3 Tests)

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src
git commit -m "feat(core): bepinex cfg parser and writer"
```

---

### Task 8: Profile teilen (r2x/r2z, Code-Import/-Export)

**Files:**

- Create: `src-tauri/src/share.rs`
- Modify: `src-tauri/src/lib.rs` (`mod share;`)

**Interfaces:**

- Consumes: `models::{Profile, ProfileMod, Source}`, `profiles::{validate_name, unique_name, create, save}`, `config::list_files_with_ext`, `install::zip_entry_parts`, `util::safe_join`, `Paths`
- Produces:
  - `share::{to_r2x(&Profile)->Result<(String, Vec<String>)>, parse_r2x(&str)->Result<(String, Vec<ProfileMod>, Vec<String>)>, build_r2z(&Profile,&Path)->Result<(Vec<u8>, Vec<String>)>, R2zContents{profile_name, mods, configs: Vec<(String,Vec<u8>)>, skipped}, read_r2z(&[u8])->Result<R2zContents>, encode_code_payload(&[u8])->String, decode_code_payload(&str)->Result<Vec<u8>>, sanitize_profile_name(&str)->String, ImportSummary{name, mods, configs, skipped} (Serialize), apply_import(&Paths,&str,R2zContents,bool)->Result<ImportSummary>}`
  - async: `share::{fetch_code(&reqwest::Client,&str)->Result<Vec<u8>>, upload_code(&reqwest::Client, Vec<u8>)->Result<String>}`

- [ ] **Step 1: Failing Tests schreiben**

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::Source;

    const R2MODMAN_YAML: &str = "profileName: Freunde\nmods:\n  - name: denikson-BepInExPack_Valheim\n    version:\n      major: 5\n      minor: 4\n      patch: 2351\n    enabled: true\n  - name: ValheimModding-Jotunn\n    version: {major: 2, minor: 20, patch: 1}\n    enabled: false\n    icon: egal\n";

    fn local() -> ProfileMod {
        ProfileMod { namespace: "local".into(), name: "Mine".into(), version: "0.0.0".into(), enabled: true, source: Source::Local, deps: vec![] }
    }

    #[test]
    fn parses_r2modman_export() {
        let (name, mods, skipped) = parse_r2x(R2MODMAN_YAML).unwrap();
        assert_eq!(name, "Freunde");
        assert!(skipped.is_empty());
        assert_eq!(mods[1].id(), "ValheimModding-Jotunn");
        assert_eq!(mods[1].version, "2.20.1");
        assert!(!mods[1].enabled);
    }

    #[test]
    fn r2x_roundtrip_skips_local_mods() {
        let mut off = ProfileMod::thunderstore("a", "B-C", "1.2.3");
        off.enabled = false;
        let p = Profile { name: "X".into(), mods: vec![off.clone(), local()] };
        let (yaml, skipped) = to_r2x(&p).unwrap();
        assert_eq!(skipped, vec!["local-Mine"]);
        let (name, mods, _) = parse_r2x(&yaml).unwrap();
        assert_eq!((name.as_str(), mods), ("X", vec![off]));
    }

    #[test]
    fn r2z_roundtrip_with_configs() {
        let d = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(d.path().join("sub")).unwrap();
        std::fs::write(d.path().join("a.cfg"), "k = v").unwrap();
        std::fs::write(d.path().join("sub/b.json"), "{}").unwrap();
        std::fs::write(d.path().join("skip.dll"), "x").unwrap();
        let p = Profile { name: "X".into(), mods: vec![ProfileMod::thunderstore("a", "B", "1.0.0")] };
        let (bytes, _) = build_r2z(&p, d.path()).unwrap();
        let c = read_r2z(&bytes).unwrap();
        assert_eq!(c.profile_name, "X");
        assert_eq!(c.mods.len(), 1);
        let names: Vec<&str> = c.configs.iter().map(|(n, _)| n.as_str()).collect();
        assert_eq!(names, vec!["a.cfg", "sub/b.json"]);
    }

    #[test]
    fn code_payload_roundtrip() {
        let encoded = encode_code_payload(b"PK-data");
        assert!(encoded.starts_with("#r2modman\n"));
        assert_eq!(decode_code_payload(&encoded).unwrap(), b"PK-data");
        let wrapped = encoded.replace('\n', "\r\n") + "\n";
        assert_eq!(decode_code_payload(&wrapped).unwrap(), b"PK-data");
        assert!(decode_code_payload("#r2modman\n!!!").is_err());
    }

    #[test]
    fn import_sanitizes_name_writes_configs_and_dedupes() {
        let d = tempfile::tempdir().unwrap();
        let paths = Paths::new(d.path().to_path_buf());
        paths.ensure().unwrap();
        assert_eq!(sanitize_profile_name("A:B?"), "A_B_");
        assert_eq!(sanitize_profile_name("..."), "import");
        let contents = || R2zContents {
            profile_name: "A:B?".into(),
            mods: vec![ProfileMod::thunderstore("a", "B", "1.0.0")],
            configs: vec![("sub/x.cfg".into(), b"k = v".to_vec())],
            skipped: vec![],
        };
        let s = apply_import(&paths, "", contents(), true).unwrap();
        assert_eq!((s.name.as_str(), s.mods, s.configs), ("A_B_", 1, 1));
        assert_eq!(std::fs::read_to_string(paths.config_dir("A_B_").join("sub/x.cfg")).unwrap(), "k = v");
        let s2 = apply_import(&paths, "", contents(), false).unwrap();
        assert_eq!((s2.name.as_str(), s2.configs), ("A_B_ (2)", 0));
    }
}
```

- [ ] **Step 2: Tests laufen lassen, Fehlschlag prüfen**

Run: `cd src-tauri && cargo test share::`
Expected: FAIL

- [ ] **Step 3: Implementieren**

```rust
//! r2modman-kompatibles Teilen: export.r2x (YAML) + BepInEx/config in einer Zip
//! (.r2z), als Datei oder über die Thunderstore-Legacyprofile-API als Code.
use crate::config::list_files_with_ext;
use crate::error::{AppError, Result};
use crate::install::zip_entry_parts;
use crate::models::{Profile, ProfileMod, Source};
use crate::paths::Paths;
use crate::profiles;
use crate::util::safe_join;
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use std::io::{Cursor, Read, Write};
use std::path::Path;

const CODE_PREFIX: &str = "#r2modman";
const CONFIG_EXTS: [&str; 6] = ["cfg", "txt", "json", "yml", "yaml", "ini"];
const API: &str = "https://thunderstore.io/api/experimental/legacyprofile";

fn yes() -> bool {
    true
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct R2x {
    profile_name: String,
    #[serde(default)]
    mods: Vec<R2xMod>,
}

#[derive(Serialize, Deserialize)]
struct R2xMod {
    name: String,
    #[serde(default)]
    version: R2xVersion,
    #[serde(default = "yes")]
    enabled: bool,
}

#[derive(Serialize, Deserialize, Default)]
struct R2xVersion {
    #[serde(default)]
    major: u32,
    #[serde(default)]
    minor: u32,
    #[serde(default)]
    patch: u32,
}

pub fn to_r2x(profile: &Profile) -> Result<(String, Vec<String>)> {
    let mut skipped = vec![];
    let mut mods = vec![];
    for m in &profile.mods {
        if m.source == Source::Local {
            skipped.push(m.id());
            continue;
        }
        let n: Vec<u32> = m.version.split('.').map(|x| x.parse().unwrap_or(0)).collect();
        mods.push(R2xMod {
            name: m.id(),
            version: R2xVersion { major: n.first().copied().unwrap_or(0), minor: n.get(1).copied().unwrap_or(0), patch: n.get(2).copied().unwrap_or(0) },
            enabled: m.enabled,
        });
    }
    let yaml = serde_yaml_ng::to_string(&R2x { profile_name: profile.name.clone(), mods })
        .map_err(|e| AppError::Invalid(format!("Export fehlgeschlagen: {e}")))?;
    Ok((yaml, skipped))
}

/// → (Profilname, Mods, nicht lesbare Einträge)
pub fn parse_r2x(text: &str) -> Result<(String, Vec<ProfileMod>, Vec<String>)> {
    let r: R2x = serde_yaml_ng::from_str(text).map_err(|e| AppError::Invalid(format!("export.r2x ist ungültig: {e}")))?;
    let mut skipped = vec![];
    let mods = r
        .mods
        .into_iter()
        .filter_map(|m| match m.name.split_once('-') {
            Some((ns, name)) if !ns.is_empty() && !name.is_empty() => Some(ProfileMod {
                enabled: m.enabled,
                ..ProfileMod::thunderstore(ns, name, &format!("{}.{}.{}", m.version.major, m.version.minor, m.version.patch))
            }),
            _ => {
                skipped.push(m.name);
                None
            }
        })
        .collect();
    Ok((r.profile_name, mods, skipped))
}

pub fn build_r2z(profile: &Profile, config_dir: &Path) -> Result<(Vec<u8>, Vec<String>)> {
    let (yaml, skipped) = to_r2x(profile)?;
    let mut w = zip::ZipWriter::new(Cursor::new(Vec::new()));
    let opts = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    w.start_file("export.r2x", opts)?;
    w.write_all(yaml.as_bytes())?;
    for rel in list_files_with_ext(config_dir, &CONFIG_EXTS) {
        w.start_file(format!("BepInEx/config/{rel}"), opts)?;
        w.write_all(&std::fs::read(safe_join(config_dir, &rel)?)?)?;
    }
    Ok((w.finish()?.into_inner(), skipped))
}

pub struct R2zContents {
    pub profile_name: String,
    pub mods: Vec<ProfileMod>,
    pub configs: Vec<(String, Vec<u8>)>,
    pub skipped: Vec<String>,
}

pub fn read_r2z(bytes: &[u8]) -> Result<R2zContents> {
    let mut archive = zip::ZipArchive::new(Cursor::new(bytes))?;
    let mut r2x = None;
    let mut configs = vec![];
    for i in 0..archive.len() {
        let mut e = archive.by_index(i)?;
        if e.is_dir() {
            continue;
        }
        let Some(parts) = zip_entry_parts(e.name()) else { continue };
        let mut buf = vec![];
        if parts.len() == 1 && parts[0].eq_ignore_ascii_case("export.r2x") {
            e.read_to_end(&mut buf)?;
            r2x = Some(String::from_utf8_lossy(&buf).to_string());
        } else if parts.len() > 2 && parts[0].eq_ignore_ascii_case("BepInEx") && parts[1].eq_ignore_ascii_case("config") {
            e.read_to_end(&mut buf)?;
            configs.push((parts[2..].join("/"), buf));
        }
    }
    let r2x = r2x.ok_or_else(|| AppError::Invalid("export.r2x fehlt im Profil.".into()))?;
    let (profile_name, mods, skipped) = parse_r2x(&r2x)?;
    Ok(R2zContents { profile_name, mods, configs, skipped })
}

pub fn encode_code_payload(bytes: &[u8]) -> String {
    format!("{CODE_PREFIX}\n{}", STANDARD.encode(bytes))
}

pub fn decode_code_payload(text: &str) -> Result<Vec<u8>> {
    let t = text.trim();
    let b64 = if t.starts_with('#') { t.split_once('\n').map(|x| x.1).unwrap_or("") } else { t };
    let clean: String = b64.chars().filter(|c| !c.is_whitespace()).collect();
    STANDARD.decode(clean).map_err(|_| AppError::Invalid("Die Profildaten sind beschädigt.".into()))
}

pub fn sanitize_profile_name(name: &str) -> String {
    let replaced: String = name.chars().map(|c| if "<>:\"/\\|?*".contains(c) || c.is_control() { '_' } else { c }).collect();
    let trimmed = replaced.trim().trim_end_matches('.').to_string();
    profiles::validate_name(&trimmed).unwrap_or_else(|_| "import".to_string())
}

#[derive(Serialize, Debug)]
pub struct ImportSummary {
    pub name: String,
    pub mods: usize,
    pub configs: usize,
    pub skipped: Vec<String>,
}

pub fn apply_import(paths: &Paths, requested_name: &str, c: R2zContents, with_configs: bool) -> Result<ImportSummary> {
    let base = if requested_name.trim().is_empty() { &c.profile_name } else { requested_name };
    let name = profiles::unique_name(paths, &sanitize_profile_name(base));
    let name = profiles::create(paths, &name)?;
    let mods = c.mods.len();
    profiles::save(paths, &Profile { name: name.clone(), mods: c.mods })?;
    let mut configs = 0;
    if with_configs {
        let dir = paths.config_dir(&name);
        for (rel, bytes) in c.configs {
            let Ok(dest) = safe_join(&dir, &rel) else { continue };
            std::fs::create_dir_all(dest.parent().unwrap())?;
            std::fs::write(dest, bytes)?;
            configs += 1;
        }
    }
    Ok(ImportSummary { name, mods, configs, skipped: c.skipped })
}

pub async fn fetch_code(client: &reqwest::Client, code: &str) -> Result<Vec<u8>> {
    let code = code.trim();
    if code.is_empty() || !code.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return Err(AppError::Invalid("Ungültiger Profil-Code.".into()));
    }
    let res = client.get(format!("{API}/get/{code}/")).send().await?;
    if !res.status().is_success() {
        return Err(AppError::Invalid(format!("Profil-Code ungültig oder abgelaufen ({}).", res.status())));
    }
    decode_code_payload(&res.text().await?)
}

pub async fn upload_code(client: &reqwest::Client, r2z: Vec<u8>) -> Result<String> {
    #[derive(Deserialize)]
    struct Created {
        key: String,
    }
    let res = client
        .post(format!("{API}/create/"))
        .header(reqwest::header::CONTENT_TYPE, "application/octet-stream")
        .body(encode_code_payload(&r2z))
        .send()
        .await?;
    if !res.status().is_success() {
        return Err(AppError::Network(format!("Hochladen fehlgeschlagen ({}).", res.status())));
    }
    Ok(res.json::<Created>().await?.key)
}
```

- [ ] **Step 4: `mod share;` ergänzen, Tests laufen lassen**

Run: `cd src-tauri && cargo test share::`
Expected: PASS (5 Tests)

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src
git commit -m "feat(core): r2modman-compatible profile import/export"
```

---

### Task 9: Spiel finden und starten

**Files:**

- Create: `src-tauri/src/game.rs`
- Modify: `src-tauri/src/lib.rs` (`mod game;`)

**Interfaces:**

- Consumes: `Settings`, `AppError`
- Produces: `game::{APP_ID, GameInfo{valheim_dir: Option<String>, steam_exe: Option<String>} (Serialize, Deserialize, Clone, Default, PartialEq, camelCase), detect()->GameInfo, resolve(&Settings,&GameInfo)->GameInfo, is_valheim_dir(&Path)->bool, find_library_with_app(&str vdf,&str app)->Option<String>, Doorstop{V3,V4}, doorstop_version(&str ini)->Doorstop, launch_args(Doorstop, Option<&Path>, bool)->Vec<String>, sync_doorstop(&Path src,&Path game)->Result<usize>, launch(&Path steam,&[String])->Result<()>}`

- [ ] **Step 1: Failing Tests schreiben**

```rust
#[cfg(test)]
mod tests {
    use super::*;

    const VDF: &str = r#""libraryfolders"
{
	"0"
	{
		"path"		"C:\\Program Files (x86)\\Steam"
		"apps"
		{
			"228980"		"123"
		}
	}
	"1"
	{
		"path"		"D:\\SteamLibrary"
		"apps"
		{
			"892970"		"4542729814"
		}
	}
}"#;

    #[test]
    fn finds_library_containing_valheim() {
        assert_eq!(find_library_with_app(VDF, APP_ID).as_deref(), Some("D:\\SteamLibrary"));
        assert_eq!(find_library_with_app(VDF, "1"), None);
    }

    #[test]
    fn detects_doorstop_version() {
        assert_eq!(doorstop_version("[General]\nenabled = true\ntarget_assembly=x"), Doorstop::V4);
        assert_eq!(doorstop_version("[UnityDoorstop]\nenabled=true\ntargetAssembly=x"), Doorstop::V3);
    }

    #[test]
    fn builds_launch_args() {
        let p = Path::new("P");
        let pre = p.join("BepInEx").join("core").join("BepInEx.Preloader.dll").display().to_string();
        let corlib = p.join("unstripped_corlib").display().to_string();
        assert_eq!(launch_args(Doorstop::V4, Some(p), false), vec!["--doorstop-enabled", "true", "--doorstop-target-assembly", &pre]);
        assert_eq!(
            launch_args(Doorstop::V3, Some(p), true),
            vec!["--doorstop-enable", "true", "--doorstop-target", &pre, "--mono-dll-search-path-override", &corlib]
        );
        assert_eq!(launch_args(Doorstop::V4, None, false), vec!["--doorstop-enabled", "false"]);
        assert_eq!(launch_args(Doorstop::V3, None, true), vec!["--doorstop-enable", "false"]);
    }

    #[test]
    fn syncs_doorstop_files_only_when_changed() {
        let d = tempfile::tempdir().unwrap();
        let src = d.path().join("src");
        let game = d.path().join("game");
        std::fs::create_dir_all(src.join("doorstop_libs")).unwrap();
        std::fs::create_dir_all(&game).unwrap();
        std::fs::write(src.join("winhttp.dll"), "w").unwrap();
        std::fs::write(src.join("doorstop_libs/x.so"), "x").unwrap();
        assert_eq!(sync_doorstop(&src, &game).unwrap(), 2);
        assert_eq!(sync_doorstop(&src, &game).unwrap(), 0);
        std::fs::write(game.join("winhttp.dll"), "v").unwrap();
        assert_eq!(sync_doorstop(&src, &game).unwrap(), 1);
        assert_eq!(std::fs::read_to_string(game.join("winhttp.dll")).unwrap(), "w");
    }

    #[test]
    fn settings_override_detection() {
        let detected = GameInfo { valheim_dir: Some("A".into()), steam_exe: Some("S".into()) };
        let s = Settings { valheim_dir: Some("B".into()), ..Settings::default() };
        assert_eq!(resolve(&s, &detected), GameInfo { valheim_dir: Some("B".into()), steam_exe: Some("S".into()) });
    }
}
```

- [ ] **Step 2: Tests laufen lassen, Fehlschlag prüfen**

Run: `cd src-tauri && cargo test game::`
Expected: FAIL

- [ ] **Step 3: Implementieren**

```rust
//! Steam/Valheim finden, Doorstop-Dateien bereitstellen und das Spiel starten.
use crate::error::Result;
use crate::settings::Settings;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};

pub const APP_ID: &str = "892970";

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GameInfo {
    pub valheim_dir: Option<String>,
    pub steam_exe: Option<String>,
}

fn vdf_strings(text: &str) -> Vec<String> {
    let mut out = vec![];
    let mut chars = text.chars();
    while let Some(c) = chars.next() {
        if c != '"' {
            continue;
        }
        let mut s = String::new();
        while let Some(c) = chars.next() {
            match c {
                '\\' => {
                    if let Some(n) = chars.next() {
                        s.push(n);
                    }
                }
                '"' => break,
                c => s.push(c),
            }
        }
        out.push(s);
    }
    out
}

/// Pfad der Steam-Bibliothek aus libraryfolders.vdf, die `app_id` enthält.
pub fn find_library_with_app(vdf: &str, app_id: &str) -> Option<String> {
    let t = vdf_strings(vdf);
    let mut last_path = None;
    let mut i = 0;
    while i < t.len() {
        if t[i].eq_ignore_ascii_case("path") && i + 1 < t.len() {
            last_path = Some(t[i + 1].clone());
            i += 2;
            continue;
        }
        if t[i] == app_id {
            return last_path;
        }
        i += 1;
    }
    None
}

#[cfg(windows)]
fn steam_dir() -> Option<PathBuf> {
    use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};
    use winreg::RegKey;
    let hkcu = RegKey::predef(HKEY_CURRENT_USER).open_subkey("Software\\Valve\\Steam").ok().and_then(|k| k.get_value::<String, _>("SteamPath").ok());
    let hklm = || RegKey::predef(HKEY_LOCAL_MACHINE).open_subkey("SOFTWARE\\WOW6432Node\\Valve\\Steam").ok().and_then(|k| k.get_value::<String, _>("InstallPath").ok());
    hkcu.or_else(hklm).map(PathBuf::from).filter(|p| p.is_dir())
}

#[cfg(not(windows))]
fn steam_dir() -> Option<PathBuf> {
    None
}

pub fn is_valheim_dir(p: &Path) -> bool {
    p.join("valheim.exe").is_file()
}

pub fn detect() -> GameInfo {
    let Some(steam) = steam_dir() else { return GameInfo::default() };
    let steam_exe = Some(steam.join("steam.exe")).filter(|p| p.is_file());
    let library = std::fs::read_to_string(steam.join("steamapps").join("libraryfolders.vdf"))
        .ok()
        .and_then(|v| find_library_with_app(&v, APP_ID))
        .map(PathBuf::from)
        .unwrap_or_else(|| steam.clone());
    let valheim = Some(library.join("steamapps").join("common").join("Valheim")).filter(|p| is_valheim_dir(p));
    GameInfo {
        valheim_dir: valheim.map(|p| p.display().to_string()),
        steam_exe: steam_exe.map(|p| p.display().to_string()),
    }
}

pub fn resolve(settings: &Settings, detected: &GameInfo) -> GameInfo {
    GameInfo {
        valheim_dir: settings.valheim_dir.clone().or_else(|| detected.valheim_dir.clone()),
        steam_exe: settings.steam_exe.clone().or_else(|| detected.steam_exe.clone()),
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Doorstop {
    V3,
    V4,
}

pub fn doorstop_version(ini: &str) -> Doorstop {
    if ini.lines().any(|l| l.trim().eq_ignore_ascii_case("[UnityDoorstop]")) {
        Doorstop::V3
    } else {
        Doorstop::V4
    }
}

/// `profile_dir = None` → Vanilla-Start (Doorstop aus).
pub fn launch_args(ver: Doorstop, profile_dir: Option<&Path>, has_corlib: bool) -> Vec<String> {
    let (enable, target, corlib_flag) = match ver {
        Doorstop::V3 => ("--doorstop-enable", "--doorstop-target", "--mono-dll-search-path-override"),
        Doorstop::V4 => ("--doorstop-enabled", "--doorstop-target-assembly", "--doorstop-mono-dll-search-path-override"),
    };
    let Some(p) = profile_dir else { return vec![enable.into(), "false".into()] };
    let preloader = p.join("BepInEx").join("core").join("BepInEx.Preloader.dll");
    let mut args = vec![enable.into(), "true".into(), target.into(), preloader.display().to_string()];
    if has_corlib {
        args.push(corlib_flag.into());
        args.push(p.join("unstripped_corlib").display().to_string());
    }
    args
}

fn same_file(a: &Path, b: &Path) -> bool {
    let (Ok(ma), Ok(mb)) = (std::fs::metadata(a), std::fs::metadata(b)) else { return false };
    if ma.len() != mb.len() {
        return false;
    }
    let hash = |p: &Path| std::fs::read(p).map(Sha256::digest);
    matches!((hash(a), hash(b)), (Ok(x), Ok(y)) if x == y)
}

/// Kopiert die Doorstop-Dateien des Profils in den Spielordner, wenn sie fehlen
/// oder abweichen. Gibt die Zahl der kopierten Dateien zurück.
pub fn sync_doorstop(src: &Path, game_dir: &Path) -> Result<usize> {
    let mut copied = 0;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let dest = game_dir.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            std::fs::create_dir_all(&dest)?;
            copied += sync_doorstop(&entry.path(), &dest)?;
        } else if !same_file(&entry.path(), &dest) {
            std::fs::copy(entry.path(), &dest)?;
            copied += 1;
        }
    }
    Ok(copied)
}

pub fn launch(steam_exe: &Path, args: &[String]) -> Result<()> {
    std::process::Command::new(steam_exe).arg("-applaunch").arg(APP_ID).args(args).spawn()?;
    Ok(())
}
```

- [ ] **Step 4: `mod game;` ergänzen, Tests laufen lassen**

Run: `cd src-tauri && cargo test game::`
Expected: PASS (5 Tests)

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src
git commit -m "feat(core): steam/valheim detection, doorstop sync and launch args"
```

---

### Task 10: Lokale Mods und BepInEx-Log

**Files:**

- Create: `src-tauri/src/localmod.rs`, `src-tauri/src/logs.rs`
- Modify: `src-tauri/src/lib.rs` (`mod localmod; mod logs;`)

**Interfaces:**

- Consumes: `Paths`, `models::{ProfileMod, Source}`, `install::zip_entry_parts`
- Produces:
  - `localmod::import_local(&Paths, &str profile, &Path src) -> Result<ProfileMod>` (kopiert nach `local/<id>/`, ersetzt vorhandene Kopie)
  - `logs::{LogChunk{lines: Vec<String>, reset: bool} (Serialize), read_last_lines(&Path, usize) -> (Vec<String>, u64), poll(&Path, &mut u64) -> Option<LogChunk>}`

- [ ] **Step 1: Failing Tests schreiben (`localmod.rs`)**

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::install::tests::make_zip;

    #[test]
    fn imports_zip_with_manifest_dll_and_replaces_copies() {
        let d = tempfile::tempdir().unwrap();
        let paths = Paths::new(d.path().join("data"));
        paths.ensure().unwrap();
        crate::profiles::create(&paths, "p").unwrap();
        let zip = make_zip(d.path(), "cool.zip", &[
            ("manifest.json", r#"{"name":"Cool_Mod","version_number":"1.2.3","dependencies":["a-B-1.0.0"]}"#),
            ("Cool.dll", "c"),
        ]);
        let m = import_local(&paths, "p", &zip).unwrap();
        assert_eq!((m.id().as_str(), m.version.as_str(), m.source), ("local-Cool_Mod", "1.2.3", Source::Local));
        assert_eq!(m.deps, vec!["a-B-1.0.0"]);
        assert!(paths.local_dir("p").join("local-Cool_Mod/cool.zip").is_file());

        let dll = d.path().join("My Plugin.dll");
        std::fs::write(&dll, "x").unwrap();
        let m = import_local(&paths, "p", &dll).unwrap();
        assert_eq!((m.id().as_str(), m.version.as_str()), ("local-My_Plugin", "0.0.0"));
        let dll2 = d.path().join("My_Plugin.dll");
        std::fs::write(&dll2, "y").unwrap();
        import_local(&paths, "p", &dll2).unwrap();
        let files: Vec<_> = std::fs::read_dir(paths.local_dir("p").join("local-My_Plugin")).unwrap().collect();
        assert_eq!(files.len(), 1);

        let txt = d.path().join("x.txt");
        std::fs::write(&txt, "").unwrap();
        assert!(import_local(&paths, "p", &txt).is_err());
    }
}
```

- [ ] **Step 2: Failing Tests schreiben (`logs.rs`)**

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn reads_tail_and_follows_appends() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("LogOutput.log");
        assert_eq!(read_last_lines(&p, 10), (vec![], 0));
        std::fs::write(&p, "a\r\nb\nc\n").unwrap();
        let (lines, mut off) = read_last_lines(&p, 2);
        assert_eq!(lines, vec!["b", "c"]);
        assert!(poll(&p, &mut off).is_none());

        let mut f = std::fs::OpenOptions::new().append(true).open(&p).unwrap();
        f.write_all(b"d\npart").unwrap();
        let c = poll(&p, &mut off).unwrap();
        assert_eq!((c.lines, c.reset), (vec!["d".to_string()], false));
        assert!(poll(&p, &mut off).is_none());
        f.write_all(b"ial\n").unwrap();
        assert_eq!(poll(&p, &mut off).unwrap().lines, vec!["partial"]);

        std::fs::write(&p, "neu\n").unwrap();
        let c = poll(&p, &mut off).unwrap();
        assert_eq!((c.lines, c.reset), (vec!["neu".to_string()], true));
    }
}
```

- [ ] **Step 3: Tests laufen lassen, Fehlschlag prüfen**

Run: `cd src-tauri && cargo test localmod:: && cargo test logs::`
Expected: FAIL

- [ ] **Step 4: `localmod.rs` implementieren**

```rust
//! Eigene Mods (Zip/DLL) ohne Thunderstore ins Profil übernehmen.
use crate::error::{AppError, Result};
use crate::install::zip_entry_parts;
use crate::models::{ProfileMod, Source};
use crate::paths::Paths;
use serde::Deserialize;
use std::io::Read;
use std::path::Path;

#[derive(Deserialize)]
struct Manifest {
    name: String,
    #[serde(default)]
    version_number: Option<String>,
    #[serde(default)]
    dependencies: Vec<String>,
}

fn clean_name(s: &str) -> String {
    let n: String = s.chars().map(|c| if c.is_ascii_alphanumeric() || c == '_' { c } else { '_' }).collect();
    if n.is_empty() { "Mod".into() } else { n }
}

fn read_manifest(zip: &Path) -> Result<Option<Manifest>> {
    let mut archive = zip::ZipArchive::new(std::fs::File::open(zip)?)?;
    for i in 0..archive.len() {
        let mut e = archive.by_index(i)?;
        let is_manifest = zip_entry_parts(e.name()).is_some_and(|p| p.len() == 1 && p[0].eq_ignore_ascii_case("manifest.json"));
        if is_manifest {
            let mut s = String::new();
            e.read_to_string(&mut s)?;
            return Ok(serde_json::from_str(s.trim_start_matches('\u{feff}')).ok());
        }
    }
    Ok(None)
}

pub fn import_local(paths: &Paths, profile: &str, src: &Path) -> Result<ProfileMod> {
    let ext = src.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
    let stem = src.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
    let (name, version, deps) = match ext.as_str() {
        "zip" => match read_manifest(src)? {
            Some(m) => (clean_name(&m.name), m.version_number.unwrap_or_else(|| "0.0.0".into()), m.dependencies),
            None => (clean_name(&stem), "0.0.0".into(), vec![]),
        },
        "dll" => (clean_name(&stem), "0.0.0".into(), vec![]),
        _ => return Err(AppError::Invalid("Nur .zip- oder .dll-Dateien werden unterstützt.".into())),
    };
    let m = ProfileMod { namespace: "local".into(), name, version, enabled: true, source: Source::Local, deps };
    let dest_dir = paths.local_dir(profile).join(m.id());
    if dest_dir.exists() {
        std::fs::remove_dir_all(&dest_dir)?;
    }
    std::fs::create_dir_all(&dest_dir)?;
    std::fs::copy(src, dest_dir.join(src.file_name().unwrap()))?;
    Ok(m)
}
```

- [ ] **Step 5: `logs.rs` implementieren**

```rust
//! LogOutput.log lesen und neue Zeilen inkrementell nachliefern.
use serde::Serialize;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;

#[derive(Serialize, Clone, Debug)]
pub struct LogChunk {
    pub lines: Vec<String>,
    pub reset: bool,
}

fn split_lines(bytes: &[u8]) -> Vec<String> {
    String::from_utf8_lossy(bytes).split('\n').map(|l| l.trim_end_matches('\r').to_string()).collect()
}

/// Letzte `n` vollständige Zeilen und der Offset hinter der letzten davon.
pub fn read_last_lines(path: &Path, n: usize) -> (Vec<String>, u64) {
    let Ok(bytes) = std::fs::read(path) else { return (vec![], 0) };
    let Some(last_nl) = bytes.iter().rposition(|b| *b == b'\n') else { return (vec![], 0) };
    let lines = split_lines(&bytes[..last_nl]);
    let start = lines.len().saturating_sub(n);
    (lines[start..].to_vec(), last_nl as u64 + 1)
}

/// Neue vollständige Zeilen seit `offset`. Ist die Datei kürzer geworden
/// (neuer Spielstart), wird von vorn gelesen und `reset` gesetzt.
pub fn poll(path: &Path, offset: &mut u64) -> Option<LogChunk> {
    let len = std::fs::metadata(path).map(|m| m.len()).unwrap_or(0);
    let mut reset = false;
    if len < *offset {
        *offset = 0;
        reset = true;
    }
    let empty = || reset.then(|| LogChunk { lines: vec![], reset });
    if len == *offset {
        return empty();
    }
    let mut f = std::fs::File::open(path).ok()?;
    f.seek(SeekFrom::Start(*offset)).ok()?;
    let mut buf = vec![];
    f.take(len - *offset).read_to_end(&mut buf).ok()?;
    let Some(last_nl) = buf.iter().rposition(|b| *b == b'\n') else { return empty() };
    *offset += last_nl as u64 + 1;
    Some(LogChunk { lines: split_lines(&buf[..last_nl]), reset })
}
```

- [ ] **Step 6: Module ergänzen, Tests laufen lassen**

Run: `cd src-tauri && cargo test localmod:: && cargo test logs::`
Expected: PASS (je 1 Test)

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src
git commit -m "feat(core): local mod import and log tailing"
```

---

### Task 11: Commands, App-Zustand und Verdrahtung

**Files:**

- Create: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs` (komplett ersetzen)
- Modify: `src-tauri/capabilities/default.json`

**Interfaces:**

- Consumes: alle Module aus Task 1–10
- Produces (Tauri-Commands, JS-Argumente in camelCase):
  `get_state() → AppState`, `get_index(since: number|null) → ArrayBuffer (leer = unverändert)`, `refresh_index() → number|null`, `get_package(id) → Pkg`, `create_profile(name)`, `delete_profile(name)`, `activate_profile(name)`, `rename_profile(from, to)`, `clone_profile(from, to)`, `set_mods(profile, mods)`, `set_mod_enabled(profile, id, enabled)`, `repair_profile(profile)`, `add_local_mods(profile, paths)` → jeweils `AppState`; `import_profile_code(code, name, withConfigs)`, `import_profile_file(path, name, withConfigs)` → `AppState & { imported: { name, mods, configs, skipped } }`; `export_profile_code(profile)`, `export_profile_file(profile, path)` → `{ code: string|null, skippedLocal: string[] }`; `launch_game(modded)`; `get_settings()`, `save_settings(settings)` → `Settings`; `detect_game()` → `GameInfo`; `clear_download_cache()` → Bytes; `list_config_files()` → `string[]`; `get_config_file(file)` → `ParsedConfig`; `save_config_file(file, changes)`; `start_log_tail()` → `string[]`; `stop_log_tail()`; `open_folder(kind: "profile"|"game"|"config"|"data")`.
  Events: `sync://progress` (`Progress`), `sync://done` (`SyncResult`), `index://updated` (`{ fetchedAt }`), `log://lines` (`LogChunk`).

- [ ] **Step 1: `commands.rs` schreiben**

```rust
//! Tauri-Commands: dünne Fassade über die Kernmodule.
use crate::config::{self, ConfigChange, ParsedConfig};
use crate::error::{AppError, Result};
use crate::game::{self, GameInfo};
use crate::install;
use crate::localmod;
use crate::logs;
use crate::models::{Pkg, Plan, ProfileMod, Source};
use crate::paths::Paths;
use crate::profiles;
use crate::resolver;
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
}

impl AppCtx {
    fn game(&self) -> GameInfo {
        game::resolve(&self.settings.read().unwrap(), &self.detected.read().unwrap())
    }

    fn active(&self) -> Result<String> {
        profiles::active(&self.paths).ok_or_else(|| AppError::Invalid("Kein aktives Profil.".into()))
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
        self.index.get().ok_or_else(|| AppError::Network("Der Mod-Index ist nicht verfügbar.".into()))
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GameStatus {
    valheim_dir: Option<String>,
    found: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppState {
    profiles: Vec<String>,
    active: Option<String>,
    mods: Vec<ProfileMod>,
    installed: BTreeMap<String, String>,
    plan: Option<Plan>,
    updates: BTreeMap<String, String>,
    index_age: Option<i64>,
    sync: SyncStatus,
    game: GameStatus,
}

fn build_state(ctx: &AppCtx) -> Result<AppState> {
    let active = profiles::active(&ctx.paths);
    let mods = match &active {
        Some(n) => profiles::load(&ctx.paths, n)?.mods,
        None => vec![],
    };
    let installed = active.as_deref().map(|n| profiles::load_installed(&ctx.paths, n)).unwrap_or_default();
    let (plan, updates) = match (ctx.index.get(), &active) {
        (Some(i), Some(_)) => (Some(resolver::plan(&mods, &i.by_id, &installed)), resolver::updates(&mods, &i.by_id)),
        _ => (None, BTreeMap::new()),
    };
    let game = ctx.game();
    let found = game.valheim_dir.as_deref().is_some_and(|d| game::is_valheim_dir(Path::new(d)));
    Ok(AppState {
        profiles: profiles::list(&ctx.paths),
        active,
        mods,
        installed: installed.into_iter().map(|(k, v)| (k, v.version)).collect(),
        plan,
        updates,
        index_age: ctx.index.age_ms(),
        sync: ctx.sync.status(),
        game: GameStatus { valheim_dir: game.valheim_dir, found },
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

/// Stellt einen Sync in die Warteschlange und startet bei Bedarf den Worker.
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
            let result = sync::run_sync(job, progress)
                .await
                .unwrap_or_else(|e| sync::SyncResult { profile: profile.clone(), errors: vec![e.to_string()], ..Default::default() });
            let _ = app.emit("sync://done", result);
        }
    });
}

/// Lädt den Index-Cache beim Start und hält den Index danach aktuell.
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
                Err(e) => eprintln!("Index-Refresh fehlgeschlagen: {e}"),
            }
        }
        tokio::time::sleep(Duration::from_secs(60)).await;
    }
}

/// Entfernt Kopien lokaler Mods, die nicht mehr im Profil stehen.
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
    idx.by_id.get(&id).cloned().ok_or_else(|| AppError::NotFound(format!("Paket {id} nicht gefunden.")))
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
        return Err(AppError::NotFound(format!("Profil \"{name}\" existiert nicht.")));
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
    let m = p.mods.iter_mut().find(|m| m.id() == id).ok_or_else(|| AppError::NotFound(format!("{id} ist nicht im Profil.")))?;
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
        // Neue Datei → alte Installation verwerfen, damit der Sync sie frisch einspielt.
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

// ---- Teilen ----

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

// ---- Spiel & Einstellungen ----

#[tauri::command]
pub async fn launch_game(ctx: State<'_, AppCtx>, modded: bool) -> Result<()> {
    let game = ctx.game();
    let dir = game.valheim_dir.map(PathBuf::from).filter(|d| game::is_valheim_dir(d)).ok_or(AppError::GameNotFound)?;
    let steam = game
        .steam_exe
        .map(PathBuf::from)
        .filter(|p| p.is_file())
        .ok_or_else(|| AppError::Invalid("steam.exe wurde nicht gefunden. Bitte in den Einstellungen festlegen.".into()))?;
    let _guard = ctx.sync.lock.lock().await; // laufende Installation abwarten
    let args = if modded {
        let name = ctx.active()?;
        let doorstop = ctx.paths.doorstop_dir(&name);
        let ini = std::fs::read_to_string(doorstop.join("doorstop_config.ini")).map_err(|_| {
            AppError::Invalid("Im Profil ist noch kein BepInEx installiert. Füge einen Mod hinzu und warte, bis die Installation fertig ist.".into())
        })?;
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
        _ => return Err(AppError::Invalid(format!("Unbekannter Ordner: {kind}"))),
    };
    app.opener()
        .open_path(path.to_string_lossy().to_string(), None::<&str>)
        .map_err(|e| AppError::Invalid(format!("Ordner konnte nicht geöffnet werden: {e}")))
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
```

- [ ] **Step 2: `lib.rs` komplett ersetzen**

```rust
mod commands;
mod config;
mod error;
mod game;
mod install;
mod localmod;
mod logs;
mod models;
mod paths;
mod profiles;
mod resolver;
mod settings;
mod share;
mod sync;
mod thunderstore;
mod util;

use commands::AppCtx;
use std::sync::{Mutex, RwLock};
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .setup(|app| {
            let paths = paths::Paths::new(app.path().app_data_dir()?);
            paths.ensure()?;
            let client = reqwest::Client::builder()
                .user_agent(concat!("valheim-modmanager/", env!("CARGO_PKG_VERSION")))
                .build()?;
            app.manage(AppCtx {
                settings: RwLock::new(settings::load(&paths)),
                detected: RwLock::new(game::detect()),
                index: thunderstore::IndexStore::new(),
                sync: sync::SyncHandle::default(),
                client,
                log_tail: Mutex::new(None),
                paths,
            });
            tauri::async_runtime::spawn(commands::index_worker(app.handle().clone()));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_state,
            commands::get_index,
            commands::refresh_index,
            commands::get_package,
            commands::create_profile,
            commands::delete_profile,
            commands::activate_profile,
            commands::rename_profile,
            commands::clone_profile,
            commands::set_mods,
            commands::set_mod_enabled,
            commands::repair_profile,
            commands::add_local_mods,
            commands::import_profile_code,
            commands::import_profile_file,
            commands::export_profile_code,
            commands::export_profile_file,
            commands::launch_game,
            commands::get_settings,
            commands::save_settings,
            commands::detect_game,
            commands::clear_download_cache,
            commands::open_folder,
            commands::list_config_files,
            commands::get_config_file,
            commands::save_config_file,
            commands::start_log_tail,
            commands::stop_log_tail,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 3: Capabilities ergänzen**

`src-tauri/capabilities/default.json`:

```json
{
	"$schema": "../gen/schemas/desktop-schema.json",
	"identifier": "default",
	"description": "Capabilities for the main window",
	"windows": ["main"],
	"permissions": ["core:default", "opener:default", "dialog:default", "clipboard-manager:allow-write-text"]
}
```

- [ ] **Step 4: Bauen, Lints und alle Tests**

Run: `cd src-tauri && cargo build && cargo clippy --all-targets -- -D warnings && cargo test`
Expected: Build ok, keine Clippy-Warnungen, alle Tests PASS. Clippy-Funde direkt beheben.

- [ ] **Step 5: Commit**

```bash
git add src-tauri
git commit -m "feat(core): tauri commands, app state, background index worker"
```

---

### Task 12: SvelteKit-Umbau, API-Schicht, Store, Layout und Durchsuchen-Seite

**Files:**

- Modify: `package.json`, `vite.config.ts`, `svelte.config.js`, `tsconfig.json`, `src-tauri/tauri.conf.json`, `.gitignore`
- Create: `src/app.html`, `src/app.d.ts`, `src/routes/+layout.ts`, `src/routes/+layout.svelte`, `src/routes/+page.svelte`, `src/routes/config/+page.svelte`, `src/lib/components/app/NameDialog.svelte`, `src/lib/components/app/SyncIndicator.svelte`
- Rewrite: `src/lib/api/types.ts`, `src/lib/api/client.ts`, `src/lib/api/store.svelte.ts`, `src/lib/components/app/ModsTab.svelte`, `src/lib/components/app/PackageSheet.svelte`, `src/lib/components/app/ImportProfileDialog.svelte`
- Modify: `src/lib/components/app/ConfigTab.svelte`, `src/lib/format.ts`
- Delete: `index.html`, `src/main.ts`, `src/App.svelte`, `src/lib/Counter.svelte`, `src/assets/`, `tsconfig.app.json`, `tsconfig.node.json`, `bun.lock`, `src/lib/components/app/ProfileTab.svelte`, `NewProfileDialog.svelte`, `SettingsDialog.svelte`
- Move: `public/` → `static/`

**Interfaces:**

- Consumes: Tauri-Commands und Events aus Task 11
- Produces:
  - `$lib/api/client`: `ApiError(message, kind)`, `api.*` (eine Methode pro Command, siehe Code)
  - `$lib/api/store.svelte`: `store` (Felder `state, packages, byId, indexFetchedAt, indexLoading, indexError, syncProgress, launching, loaded, drawerId, settings, browse, modsMap, syncing`; Methoden `init, loadState, loadIndex, refreshIndex, loadSettings, saveSettings, status, setMods, toggleMod, removeMod, updateAll, setEnabled, newProfile, activateProfile, deleteActiveProfile, renameActive, cloneActive, repair, importCode, importFile, exportCode, exportFile, addLocalMods, launch, openFolder, getPackage, openPackage, filterCategory, filterOwner, toast`), `modId(m)`, `toggled(set, v)`
  - `NameDialog` Props: `open (bindable), title, description, submitLabel, initial?, onSubmit(name) => Promise<boolean>`
  - `format.ts`: zusätzlich `formatBytes(n)`

Svelte-Dateien werden mit dem Svelte-MCP-Autofixer (`svelte-autofixer`) geprüft, bis er keine Probleme mehr meldet.

- [ ] **Step 1: Abhängigkeiten installieren und Altlasten entfernen**

```bash
npm install -D @sveltejs/kit @sveltejs/adapter-static
npm install @tauri-apps/plugin-dialog @tauri-apps/plugin-clipboard-manager @tauri-apps/plugin-opener
git rm -q index.html src/main.ts src/App.svelte src/lib/Counter.svelte tsconfig.app.json tsconfig.node.json bun.lock
git rm -rq src/assets
git rm -q src/lib/components/app/ProfileTab.svelte src/lib/components/app/NewProfileDialog.svelte src/lib/components/app/SettingsDialog.svelte
git mv public static
```

`package.json` → `scripts` ersetzen:

```json
"scripts": {
  "dev": "vite dev",
  "build": "vite build",
  "preview": "vite preview",
  "prepare": "svelte-kit sync || echo ''",
  "check": "svelte-kit sync && svelte-check --tsconfig ./tsconfig.json",
  "tauri": "tauri"
}
```

`src-tauri/tauri.conf.json` → `"frontendDist": "../build"`.

- [ ] **Step 2: SvelteKit-Konfiguration**

`svelte.config.js`:

```js
import adapter from "@sveltejs/adapter-static";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

/** @type {import('@sveltejs/kit').Config} */
export default {
	preprocess: vitePreprocess(),
	kit: {
		// Tauri hat keinen Node-Server: SPA mit index.html als Fallback.
		adapter: adapter({ fallback: "index.html" }),
	},
};
```

`vite.config.ts`:

```ts
import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [tailwindcss(), sveltekit()],
	// Tauri erwartet einen festen Port und bricht ab, wenn er belegt ist.
	clearScreen: false,
	server: {
		port: 1420,
		strictPort: true,
		watch: {
			// Cargo sperrt Dateien im Rust-Build-Ordner; das bringt Vites Watcher unter Windows mit EBUSY zum Absturz.
			ignored: ["**/src-tauri/**"],
		},
	},
	envPrefix: ["VITE_", "TAURI_"],
	build: {
		target: "esnext",
		minify: !process.env.TAURI_ENV_DEBUG ? "esbuild" : false,
		sourcemap: !!process.env.TAURI_ENV_DEBUG,
	},
});
```

`tsconfig.json`:

```json
{
	"extends": "./.svelte-kit/tsconfig.json",
	"compilerOptions": {
		"allowJs": true,
		"checkJs": true,
		"esModuleInterop": true,
		"forceConsistentCasingInFileNames": true,
		"resolveJsonModule": true,
		"skipLibCheck": true,
		"sourceMap": true,
		"strict": true,
		"moduleResolution": "bundler"
	}
}
```

`src/app.html`:

```html
<!doctype html>
<html lang="de" class="style-vega">
	<head>
		<meta charset="utf-8" />
		<link rel="icon" type="image/svg+xml" href="%sveltekit.assets%/favicon.svg" />
		<meta name="viewport" content="width=device-width, initial-scale=1" />
		<title>Valheim Mod Manager</title>
		%sveltekit.head%
	</head>
	<body data-sveltekit-preload-data="hover">
		<div style="display: contents">%sveltekit.body%</div>
	</body>
</html>
```

`src/app.d.ts`:

```ts
// See https://svelte.dev/docs/kit/types#app.d.ts
declare global {
	namespace App {}
}

export {};
```

`src/routes/+layout.ts`:

```ts
// Tauri liefert nur statische Dateien aus: kein SSR, SPA-Fallback (svelte.config.js).
export const ssr = false;
```

- [ ] **Step 3: `src/lib/api/types.ts` ersetzen**

```ts
// Datenformen der Rust-Commands (src-tauri/src/commands.rs).

export interface SlimPkg {
	id: string; // "Namespace-Name"
	ns: string;
	name: string;
	desc: string;
	icon: string;
	ver: string;
	cats: string[];
	rating: number;
	dl: number;
	upd: number;
	dep: boolean;
	nsfw: boolean;
	pinned: boolean;
	ndeps: number;
	size: number;
}

export interface IndexPayload {
	fetchedAt: number;
	packages: SlimPkg[];
}

export interface Version {
	v: string;
	deps: string[];
	size: number;
	date: number;
}

export interface Pkg {
	id: string;
	ns: string;
	name: string;
	desc: string;
	icon: string;
	cats: string[];
	rating: number;
	dl: number;
	upd: number;
	created: number;
	dep: boolean;
	nsfw: boolean;
	pinned: boolean;
	url: string;
	web: string;
	versions: Version[];
}

export type ModSource = "thunderstore" | "local";

export interface ProfileMod {
	namespace: string;
	name: string;
	version: string;
	enabled: boolean;
	source: ModSource;
	deps?: string[];
}

export interface Plan {
	resolved: Record<string, { version: string; requiredBy: string[] }>;
	toInstall: { id: string; from?: string; to: string }[];
	toRemove: string[];
	errors: string[];
}

export interface SyncStatus {
	running: boolean;
	queued: boolean;
}

export interface AppState {
	profiles: string[];
	active: string | null;
	mods: ProfileMod[];
	installed: Record<string, string>;
	plan: Plan | null;
	updates: Record<string, string>;
	indexAge: number | null;
	sync: SyncStatus;
	game: { valheimDir: string | null; found: boolean };
}

export interface ImportResult extends AppState {
	imported: { name: string; mods: number; configs: number; skipped: string[] };
}

export interface ExportResult {
	code: string | null;
	skippedLocal: string[];
}

export interface SyncProgress {
	id: string;
	phase: "download" | "remove" | "extract";
	done: number;
	total: number;
}

export interface SyncDone {
	profile: string;
	installed: string[];
	removed: string[];
	errors: string[];
}

export interface Settings {
	valheimDir: string | null;
	steamExe: string | null;
	downloadConcurrency: number;
	indexTtlMinutes: number;
	showNsfw: boolean;
}

export interface GameInfo {
	valheimDir: string | null;
	steamExe: string | null;
}

export interface LogChunk {
	lines: string[];
	reset: boolean;
}

export interface ConfigSetting {
	section: string;
	key: string;
	value: string;
	description: string;
	type?: string;
	defaultValue?: string;
	acceptableValues?: string;
}

export interface ParsedConfig {
	file: string;
	settings: ConfigSetting[];
}

export interface ConfigChange {
	section: string;
	key: string;
	value: string;
}

export type FolderKind = "profile" | "game" | "config" | "data";
```

- [ ] **Step 4: `src/lib/api/client.ts` ersetzen**

```ts
// Dünne Schicht über die Tauri-Commands des Rust-Kerns (src-tauri/src/commands.rs).
import { invoke } from "@tauri-apps/api/core";
import type { AppState, ConfigChange, ExportResult, FolderKind, GameInfo, ImportResult, IndexPayload, ParsedConfig, Pkg, ProfileMod, Settings } from "./types";

export class ApiError extends Error {
	constructor(
		message: string,
		readonly kind: string = "unknown",
	) {
		super(message);
	}
}

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
	try {
		return await invoke<T>(cmd, args);
	} catch (e) {
		if (e && typeof e === "object" && "message" in e) {
			const err = e as { message: unknown; kind?: unknown };
			throw new ApiError(String(err.message), String(err.kind ?? "unknown"));
		}
		throw new ApiError(String(e));
	}
}

export const api = {
	state: () => call<AppState>("get_state"),

	/** `null`, wenn sich der Index seit `since` nicht geändert hat. */
	index: async (since: number | null): Promise<IndexPayload | null> => {
		const buf = await call<ArrayBuffer>("get_index", { since });
		if (!buf.byteLength) return null;
		return JSON.parse(new TextDecoder().decode(buf)) as IndexPayload;
	},
	refreshIndex: () => call<number | null>("refresh_index"),
	getPackage: (id: string) => call<Pkg>("get_package", { id }),

	createProfile: (name: string) => call<AppState>("create_profile", { name }),
	deleteProfile: (name: string) => call<AppState>("delete_profile", { name }),
	activateProfile: (name: string) => call<AppState>("activate_profile", { name }),
	renameProfile: (from: string, to: string) => call<AppState>("rename_profile", { from, to }),
	cloneProfile: (from: string, to: string) => call<AppState>("clone_profile", { from, to }),
	setMods: (profile: string, mods: ProfileMod[]) => call<AppState>("set_mods", { profile, mods }),
	setModEnabled: (profile: string, id: string, enabled: boolean) => call<AppState>("set_mod_enabled", { profile, id, enabled }),
	repairProfile: (profile: string) => call<AppState>("repair_profile", { profile }),
	addLocalMods: (profile: string, paths: string[]) => call<AppState>("add_local_mods", { profile, paths }),

	importProfileCode: (code: string, name: string, withConfigs: boolean) => call<ImportResult>("import_profile_code", { code, name, withConfigs }),
	importProfileFile: (path: string, name: string, withConfigs: boolean) => call<ImportResult>("import_profile_file", { path, name, withConfigs }),
	exportProfileCode: (profile: string) => call<ExportResult>("export_profile_code", { profile }),
	exportProfileFile: (profile: string, path: string) => call<ExportResult>("export_profile_file", { profile, path }),

	launchGame: (modded: boolean) => call<void>("launch_game", { modded }),
	getSettings: () => call<Settings>("get_settings"),
	saveSettings: (settings: Settings) => call<Settings>("save_settings", { settings }),
	detectGame: () => call<GameInfo>("detect_game"),
	clearDownloadCache: () => call<number>("clear_download_cache"),
	openFolder: (kind: FolderKind) => call<void>("open_folder", { kind }),

	listConfigFiles: () => call<string[]>("list_config_files"),
	getConfigFile: (file: string) => call<ParsedConfig>("get_config_file", { file }),
	saveConfigFile: (file: string, changes: ConfigChange[]) => call<void>("save_config_file", { file, changes }),

	startLogTail: () => call<string[]>("start_log_tail"),
	stopLogTail: () => call<void>("stop_log_tail"),
};
```

- [ ] **Step 5: `src/lib/api/store.svelte.ts` ersetzen**

```ts
// Zentraler reaktiver App-Zustand (Svelte 5 Runes), gespeist vom Rust-Kern.
import { goto } from "$app/navigation";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { toast as toast_ } from "svelte-sonner";
import { api, ApiError } from "./client";
import type { AppState, ExportResult, FolderKind, ImportResult, Pkg, ProfileMod, Settings, SlimPkg, SyncDone, SyncProgress } from "./types";

export type ToastKind = "ok" | "err" | "info";
export type StatusFlag = "inProfile" | "installed" | "updates";
export type SortKey = "auto" | "rating" | "dl" | "upd" | "name";

export function modId(m: { namespace: string; name: string }): string {
	return `${m.namespace}-${m.name}`;
}

export function toggled<T>(set: Set<T>, value: T): Set<T> {
	const next = new Set(set);
	if (next.has(value)) next.delete(value);
	else next.add(value);
	return next;
}

function errorMessage(e: unknown, fallback: string): string {
	return e instanceof Error && e.message ? e.message : fallback;
}

const EMPTY_STATE: AppState = {
	profiles: [],
	active: null,
	mods: [],
	installed: {},
	plan: null,
	updates: {},
	indexAge: null,
	sync: { running: false, queued: false },
	game: { valheimDir: null, found: true },
};

/** Filter der Durchsuchen-Seite; bleibt beim Seitenwechsel erhalten. */
class BrowseFilters {
	query = $state("");
	sort = $state<SortKey>("auto");
	statusFlags = $state<Set<StatusFlag>>(new Set());
	categories = $state<Set<string>>(new Set());
	owners = $state<Set<string>>(new Set());
	ageDays = $state(0);
	showDeprecated = $state(false);
	showNsfw = $state(false);

	reset() {
		this.query = "";
		this.statusFlags = new Set();
		this.categories = new Set();
		this.owners = new Set();
		this.ageDays = 0;
		this.showDeprecated = false;
	}
}

class ModManagerStore {
	state = $state<AppState>(EMPTY_STATE);
	loaded = $state(false);
	packages = $state.raw<SlimPkg[]>([]);
	byId = $state.raw<Map<string, SlimPkg>>(new Map());
	indexFetchedAt = $state<number | null>(null);
	indexLoading = $state(false);
	indexError = $state<string | null>(null);
	syncProgress = $state<SyncProgress | null>(null);
	launching = $state(false);
	drawerId = $state<string | null>(null);
	settings = $state<Settings | null>(null);
	browse = new BrowseFilters();

	modsMap = $derived(new Map(this.state.mods.map((m) => [modId(m), m])));
	syncing = $derived(this.state.sync.running || this.syncProgress !== null);

	private packageCache = new Map<string, Promise<Pkg>>();

	toast(message: string, kind: ToastKind = "info") {
		if (kind === "ok") toast_.success(message);
		else if (kind === "err") toast_.error(message);
		else toast_.message(message);
	}

	/** Lädt alles und abonniert die Backend-Events. Gibt die Aufräumfunktion zurück. */
	async init(): Promise<() => void> {
		const unlisten: UnlistenFn[] = await Promise.all([
			listen<SyncProgress>("sync://progress", (e) => (this.syncProgress = e.payload)),
			listen<SyncDone>("sync://done", (e) => this.onSyncDone(e.payload)),
			listen("index://updated", () => {
				this.packageCache.clear();
				this.loadIndex();
				this.loadState();
			}),
		]);
		await Promise.all([this.loadState(), this.loadIndex(), this.loadSettings()]);
		return () => unlisten.forEach((u) => u());
	}

	private onSyncDone(r: SyncDone) {
		this.syncProgress = null;
		const parts: string[] = [];
		if (r.installed.length) parts.push(`${r.installed.length} installiert`);
		if (r.removed.length) parts.push(`${r.removed.length} entfernt`);
		if (parts.length) this.toast(`${r.profile}: ${parts.join(", ")}`, "ok");
		for (const err of r.errors) this.toast(err, "err");
		this.loadState();
	}

	private async applyState(fn: () => Promise<AppState>, fallback: string): Promise<boolean> {
		try {
			this.state = await fn();
			this.loaded = true;
			return true;
		} catch (e) {
			this.toast(errorMessage(e, fallback), "err");
			return false;
		}
	}

	loadState() {
		return this.applyState(() => api.state(), "Zustand konnte nicht geladen werden.");
	}

	async loadIndex() {
		this.indexLoading = true;
		this.indexError = null;
		try {
			const data = await api.index(this.indexFetchedAt);
			if (data) {
				this.packages = data.packages;
				this.byId = new Map(data.packages.map((p) => [p.id, p]));
				this.indexFetchedAt = data.fetchedAt;
			}
		} catch (e) {
			this.indexError = errorMessage(e, "Index konnte nicht geladen werden.");
		} finally {
			this.indexLoading = false;
		}
	}

	async refreshIndex() {
		try {
			await api.refreshIndex();
			this.toast("Mod-Index aktualisiert.", "ok");
		} catch (e) {
			this.toast(errorMessage(e, "Aktualisieren fehlgeschlagen."), "err");
		}
	}

	async loadSettings() {
		try {
			this.settings = await api.getSettings();
			this.browse.showNsfw = this.settings.showNsfw;
		} catch (e) {
			this.toast(errorMessage(e, "Einstellungen konnten nicht geladen werden."), "err");
		}
	}

	async saveSettings(s: Settings): Promise<boolean> {
		try {
			this.settings = await api.saveSettings(s);
			await this.loadState();
			this.toast("Einstellungen gespeichert.", "ok");
			return true;
		} catch (e) {
			this.toast(errorMessage(e, "Speichern fehlgeschlagen."), "err");
			return false;
		}
	}

	status(id: string) {
		const p = this.byId.get(id);
		const m = this.modsMap.get(id);
		const inst = this.state.installed[id];
		const asDep = !m ? this.state.plan?.resolved[id] : undefined;
		const update: string | undefined = this.state.updates[id];
		return { p, m, inst, asDep, update };
	}

	async ensureActiveProfile(): Promise<string | null> {
		if (this.state.active) return this.state.active;
		if (await this.applyState(() => api.createProfile("default"), "Profil konnte nicht angelegt werden.")) {
			this.toast('Profil "default" angelegt.', "ok");
		}
		return this.state.active;
	}

	async setMods(mods: ProfileMod[]) {
		const name = await this.ensureActiveProfile();
		if (!name) return;
		await this.applyState(() => api.setMods(name, mods), "Speichern fehlgeschlagen.");
	}

	/** Plus-Button / Sheet: hinzufügen, entfernen oder Version setzen. */
	async toggleMod(id: string, version?: string) {
		const { p, m, update } = this.status(id);
		if (m && !update && !version) return this.removeMod(id);
		if (m) {
			const to = version ?? update ?? m.version;
			return this.setMods(this.state.mods.map((x) => (modId(x) === id ? { ...x, version: to } : x)));
		}
		if (!p) return;
		await this.setMods([...this.state.mods, { namespace: p.ns, name: p.name, version: version || p.ver, enabled: true, source: "thunderstore" }]);
	}

	removeMod(id: string) {
		return this.setMods(this.state.mods.filter((x) => modId(x) !== id));
	}

	updateAll() {
		return this.setMods(this.state.mods.map((m) => ({ ...m, version: this.state.updates[modId(m)] ?? m.version })));
	}

	async setEnabled(id: string, enabled: boolean) {
		const active = this.state.active;
		if (!active) return;
		await this.applyState(() => api.setModEnabled(active, id, enabled), "Umschalten fehlgeschlagen.");
	}

	async newProfile(name: string): Promise<boolean> {
		const ok = await this.applyState(() => api.createProfile(name), "Profil konnte nicht angelegt werden.");
		if (ok) this.toast(`Profil "${name}" angelegt.`, "ok");
		return ok;
	}

	activateProfile(name: string) {
		return this.applyState(() => api.activateProfile(name), "Profilwechsel fehlgeschlagen.");
	}

	async deleteActiveProfile() {
		const active = this.state.active;
		if (!active) return;
		if (await this.applyState(() => api.deleteProfile(active), "Löschen fehlgeschlagen.")) {
			this.toast(`Profil "${active}" gelöscht.`, "ok");
		}
	}

	async renameActive(to: string): Promise<boolean> {
		const active = this.state.active;
		return !!active && this.applyState(() => api.renameProfile(active, to), "Umbenennen fehlgeschlagen.");
	}

	async cloneActive(to: string): Promise<boolean> {
		const active = this.state.active;
		const ok = !!active && (await this.applyState(() => api.cloneProfile(active, to), "Klonen fehlgeschlagen."));
		if (ok) this.toast(`Profil "${to}" angelegt.`, "ok");
		return ok;
	}

	async repair() {
		const active = this.state.active;
		if (!active) return;
		if (await this.applyState(() => api.repairProfile(active), "Reparatur fehlgeschlagen.")) {
			this.toast("Alle Mods werden neu installiert…", "info");
		}
	}

	private onImported(r: ImportResult) {
		const { imported, ...state } = r;
		this.state = state;
		const skipped = imported.skipped.length ? `, übersprungen: ${imported.skipped.join(", ")}` : "";
		this.toast(`"${imported.name}" importiert: ${imported.mods} Mods, ${imported.configs} Configs${skipped}`, "ok");
	}

	async importCode(code: string, name: string, withConfigs: boolean): Promise<boolean> {
		try {
			this.onImported(await api.importProfileCode(code, name, withConfigs));
			return true;
		} catch (e) {
			this.toast(errorMessage(e, "Import fehlgeschlagen."), "err");
			return false;
		}
	}

	async importFile(path: string, name: string, withConfigs: boolean): Promise<boolean> {
		try {
			this.onImported(await api.importProfileFile(path, name, withConfigs));
			return true;
		} catch (e) {
			this.toast(errorMessage(e, "Import fehlgeschlagen."), "err");
			return false;
		}
	}

	private warnSkipped(r: ExportResult) {
		if (r.skippedLocal.length) {
			this.toast(`Lokale Mods sind nicht enthalten: ${r.skippedLocal.join(", ")}`, "info");
		}
	}

	async exportCode(): Promise<string | null> {
		const active = this.state.active;
		if (!active) return null;
		try {
			const r = await api.exportProfileCode(active);
			this.warnSkipped(r);
			return r.code;
		} catch (e) {
			this.toast(errorMessage(e, "Teilen fehlgeschlagen."), "err");
			return null;
		}
	}

	async exportFile(path: string) {
		const active = this.state.active;
		if (!active) return;
		try {
			this.warnSkipped(await api.exportProfileFile(active, path));
			this.toast("Profil exportiert.", "ok");
		} catch (e) {
			this.toast(errorMessage(e, "Export fehlgeschlagen."), "err");
		}
	}

	async addLocalMods(paths: string[]) {
		const name = await this.ensureActiveProfile();
		if (!name || !paths.length) return;
		if (await this.applyState(() => api.addLocalMods(name, paths), "Lokaler Mod konnte nicht hinzugefügt werden.")) {
			this.toast(`${paths.length} lokale(r) Mod(s) hinzugefügt.`, "ok");
		}
	}

	async launch(modded: boolean) {
		this.launching = true;
		try {
			await api.launchGame(modded);
			this.toast(modded ? "Valheim startet mit Mods…" : "Valheim startet ohne Mods…", "ok");
		} catch (e) {
			const message = errorMessage(e, "Start fehlgeschlagen.");
			if (e instanceof ApiError && e.kind === "gameNotFound") {
				toast_.error(message, { action: { label: "Einstellungen", onClick: () => goto("/settings") } });
			} else {
				this.toast(message, "err");
			}
		} finally {
			this.launching = false;
		}
	}

	async openFolder(kind: FolderKind) {
		try {
			await api.openFolder(kind);
		} catch (e) {
			this.toast(errorMessage(e, "Ordner konnte nicht geöffnet werden."), "err");
		}
	}

	getPackage(id: string): Promise<Pkg> {
		let p = this.packageCache.get(id);
		if (!p) {
			p = api.getPackage(id);
			p.catch(() => this.packageCache.delete(id));
			this.packageCache.set(id, p);
		}
		return p;
	}

	openPackage(id: string) {
		this.drawerId = id;
	}

	filterCategory(cat: string) {
		this.browse.categories = toggled(this.browse.categories, cat);
	}

	filterOwner(owner: string) {
		this.browse.owners = toggled(this.browse.owners, owner);
	}
}

export const store = new ModManagerStore();
```

- [ ] **Step 6: `formatBytes` in `src/lib/format.ts` ergänzen**

```ts
export function formatBytes(n: number): string {
	if (n < 1024) return `${n} B`;
	const units = ["KB", "MB", "GB"];
	let v = n / 1024;
	let i = 0;
	while (v >= 1024 && i < units.length - 1) {
		v /= 1024;
		i++;
	}
	return `${v.toFixed(1)} ${units[i]}`;
}
```

- [ ] **Step 7: `NameDialog.svelte` und `SyncIndicator.svelte` anlegen**

`src/lib/components/app/NameDialog.svelte`:

```svelte
<script lang="ts">
	import * as Dialog from "$lib/components/ui/dialog";
	import { Button } from "$lib/components/ui/button";
	import { Input } from "$lib/components/ui/input";
	import { Label } from "$lib/components/ui/label";

	let {
		open = $bindable(false),
		title,
		description,
		submitLabel,
		initial = "",
		onSubmit,
	}: {
		open?: boolean;
		title: string;
		description: string;
		submitLabel: string;
		initial?: string;
		onSubmit: (name: string) => Promise<boolean>;
	} = $props();

	let name = $state("");
	let busy = $state(false);

	$effect(() => {
		if (open) name = initial;
	});

	async function submit() {
		if (!name.trim() || busy) return;
		busy = true;
		try {
			if (await onSubmit(name.trim())) open = false;
		} finally {
			busy = false;
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="sm:max-w-sm">
		<Dialog.Header>
			<Dialog.Title>{title}</Dialog.Title>
			<Dialog.Description>{description}</Dialog.Description>
		</Dialog.Header>
		<div class="grid gap-2">
			<Label for="name-dialog-input">Name</Label>
			<Input id="name-dialog-input" bind:value={name} onkeydown={(e) => e.key === "Enter" && submit()} />
		</div>
		<Dialog.Footer>
			<Button variant="outline" onclick={() => (open = false)}>Abbrechen</Button>
			<Button onclick={submit} disabled={busy || !name.trim()}>{submitLabel}</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
```

`src/lib/components/app/SyncIndicator.svelte`:

```svelte
<script lang="ts">
	import { store } from "$lib/api/store.svelte";

	const VERBS = { download: "Lade", remove: "Entferne", extract: "Installiere" } as const;

	const label = $derived.by(() => {
		const p = store.syncProgress;
		if (p) return `${VERBS[p.phase]} ${p.done}/${p.total} · ${p.id}`;
		return store.state.sync.running ? "Synchronisiere…" : null;
	});
</script>

{#if label}
	<span class="text-muted-foreground flex max-w-72 items-center gap-2 truncate text-xs" title={label}>
		<span class="bg-primary size-2 shrink-0 animate-pulse rounded-full"></span>
		{label}
	</span>
{/if}
```

- [ ] **Step 8: `PackageSheet.svelte` ersetzen (global, über `store.drawerId`)**

```svelte
<script lang="ts">
	import { goto } from "$app/navigation";
	import { openUrl } from "@tauri-apps/plugin-opener";
	import * as Sheet from "$lib/components/ui/sheet";
	import { Button } from "$lib/components/ui/button";
	import { Badge } from "$lib/components/ui/badge";
	import * as NativeSelect from "$lib/components/ui/native-select";
	import { Separator } from "$lib/components/ui/separator";
	import { store } from "$lib/api/store.svelte";
	import type { Pkg } from "$lib/api/types";
	import { formatNumber, formatDate, relativeTime } from "$lib/format";

	let pkg = $state<Pkg | null>(null);
	let selectedVersion = $state("");

	const id = $derived(store.drawerId);
	const status = $derived(id ? store.status(id) : null);

	$effect(() => {
		const current = id;
		pkg = null;
		if (!current) return;
		store
			.getPackage(current)
			.then((p) => {
				if (store.drawerId !== current) return; // inzwischen weitergeklickt
				pkg = p;
				selectedVersion = store.modsMap.get(current)?.version ?? p.versions[0]?.v ?? "";
			})
			.catch((e: unknown) => {
				store.toast(e instanceof Error ? e.message : "Paket konnte nicht geladen werden.", "err");
				store.drawerId = null;
			});
	});

	function close() {
		store.drawerId = null;
	}

	function filterBy(fn: () => void) {
		fn();
		close();
		goto("/");
	}
</script>

<Sheet.Root open={id !== null} onOpenChange={(o) => !o && close()}>
	<Sheet.Content side="right" class="w-full gap-0 overflow-y-auto sm:max-w-md">
		{#if pkg}
			<Sheet.Header>
				<div class="flex items-start gap-3">
					<img src={pkg.icon} alt="" class="size-12 rounded-md" loading="lazy" />
					<div>
						<Sheet.Title>{pkg.name}</Sheet.Title>
						<button class="text-muted-foreground text-sm hover:underline" onclick={() => filterBy(() => store.filterOwner(pkg!.ns))}>
							{pkg.ns}
						</button>
					</div>
				</div>
			</Sheet.Header>
			<div class="flex flex-col gap-4 px-4 pb-4">
				<p class="text-sm">{pkg.desc}</p>

				<div class="flex items-center gap-2">
					<NativeSelect.Root bind:value={selectedVersion} class="w-auto">
						{#each pkg.versions as v (v.v)}
							<NativeSelect.Option value={v.v}>{v.v}</NativeSelect.Option>
						{/each}
					</NativeSelect.Root>
					<Button onclick={() => id && store.toggleMod(id, selectedVersion)}>
						{status?.m ? "Version setzen" : "Hinzufügen"}
					</Button>
					{#if status?.m}
						<Button variant="destructive" onclick={() => id && store.removeMod(id)}>Entfernen</Button>
					{/if}
				</div>

				<Separator />

				<dl class="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
					<dt class="text-muted-foreground">Status</dt>
					<dd>
						{#if status?.m}
							im Profil (v{status.m.version}{status.m.enabled ? "" : ", deaktiviert"})
						{:else if status?.asDep}
							Abhängigkeit {status.asDep.requiredBy.length ? `von ${status.asDep.requiredBy.join(", ")}` : "(Basis)"}
						{:else}
							—
						{/if}
						{#if status?.inst}<span class="text-muted-foreground"> · installiert v{status.inst}</span>{/if}
					</dd>
					<dt class="text-muted-foreground">Downloads</dt>
					<dd>{formatNumber(pkg.dl)}</dd>
					<dt class="text-muted-foreground">Bewertung</dt>
					<dd>★ {pkg.rating}</dd>
					<dt class="text-muted-foreground">Aktualisiert</dt>
					<dd>{formatDate(pkg.upd)} ({relativeTime(pkg.upd)})</dd>
					<dt class="text-muted-foreground">Versionen</dt>
					<dd>{pkg.versions.length}</dd>
				</dl>

				{#if pkg.cats.length}
					<div class="flex flex-wrap gap-1.5">
						{#each pkg.cats as cat (cat)}
							<button onclick={() => filterBy(() => store.filterCategory(cat))}>
								<Badge variant="secondary">{cat}</Badge>
							</button>
						{/each}
					</div>
				{/if}

				{#if pkg.versions[0]}
					<div>
						<h4 class="mb-2 text-sm font-medium">Abhängigkeiten (v{pkg.versions[0].v})</h4>
						{#if pkg.versions[0].deps.length}
							<ul class="space-y-1 text-sm">
								{#each pkg.versions[0].deps as dep (dep)}
									{@const parts = dep.split("-")}
									{@const depId = `${parts[0]}-${parts.slice(1, -1).join("-")}`}
									<li>
										<button class="hover:underline" onclick={() => store.openPackage(depId)}>{depId}</button>
										<span class="text-muted-foreground">{parts[parts.length - 1]}</span>
									</li>
								{/each}
							</ul>
						{:else}
							<p class="text-muted-foreground text-sm">keine</p>
						{/if}
					</div>
				{/if}

				<p class="flex gap-3 text-sm">
					<button class="hover:underline" onclick={() => openUrl(pkg!.url)}>Thunderstore ↗</button>
					{#if pkg.web}
						<button class="hover:underline" onclick={() => openUrl(pkg!.web)}>Website ↗</button>
					{/if}
				</p>
			</div>
		{:else if id}
			<div class="text-muted-foreground p-6 text-sm">Lädt…</div>
		{/if}
	</Sheet.Content>
</Sheet.Root>
```

- [ ] **Step 9: `ModsTab.svelte` ersetzen (Filter aus `store.browse`)**

```svelte
<script lang="ts">
	import { Input } from "$lib/components/ui/input";
	import { Button } from "$lib/components/ui/button";
	import { Badge } from "$lib/components/ui/badge";
	import { Checkbox } from "$lib/components/ui/checkbox";
	import { ScrollArea } from "$lib/components/ui/scroll-area";
	import * as NativeSelect from "$lib/components/ui/native-select";
	import { store, toggled, type StatusFlag } from "$lib/api/store.svelte";
	import type { SlimPkg } from "$lib/api/types";
	import { formatNumber, relativeTime } from "$lib/format";

	const f = store.browse;
	let visibleCount = $state(60);

	function normalize(s: string) {
		return s.toLowerCase().replace(/[\s_-]/g, "");
	}

	function matchesStatus(p: SlimPkg, flag: StatusFlag): boolean {
		if (flag === "inProfile") return store.modsMap.has(p.id);
		if (flag === "installed") return p.id in store.state.installed;
		return p.id in store.state.updates;
	}

	function baseFilter(p: SlimPkg, opts: { skipCat?: boolean; skipOwner?: boolean } = {}) {
		if (!f.showDeprecated && p.dep) return false;
		if (!f.showNsfw && p.nsfw) return false;
		if (f.ageDays && Date.now() - p.upd > f.ageDays * 86_400_000) return false;
		if (!opts.skipCat && f.categories.size && ![...f.categories].every((c) => p.cats.includes(c))) return false;
		if (!opts.skipOwner && f.owners.size && !f.owners.has(p.ns)) return false;
		if (f.statusFlags.size && ![...f.statusFlags].every((flag) => matchesStatus(p, flag))) return false;
		if (f.query) {
			const hay = normalize(`${p.name} ${p.ns} ${p.desc}`);
			if (!hay.includes(normalize(f.query))) return false;
		}
		return true;
	}

	const filtered = $derived.by(() => {
		const sorted = store.packages.filter((p) => baseFilter(p));
		const q = normalize(f.query);
		if (f.sort === "name") sorted.sort((a, b) => a.name.localeCompare(b.name));
		else if (f.sort === "rating") sorted.sort((a, b) => b.rating - a.rating);
		else if (f.sort === "dl") sorted.sort((a, b) => b.dl - a.dl);
		else if (f.sort === "upd") sorted.sort((a, b) => b.upd - a.upd);
		else if (f.query) {
			sorted.sort((a, b) => {
				const an = normalize(a.name) === q ? 1 : 0;
				const bn = normalize(b.name) === q ? 1 : 0;
				if (an !== bn) return bn - an;
				return b.dl - a.dl;
			});
		} else {
			sorted.sort((a, b) => b.rating - a.rating);
		}
		return sorted;
	});

	const catCounts = $derived.by(() => {
		const counts = new Map<string, number>();
		for (const p of store.packages) {
			if (!baseFilter(p, { skipCat: true })) continue;
			for (const c of p.cats) counts.set(c, (counts.get(c) ?? 0) + 1);
		}
		return counts;
	});

	const ownerCounts = $derived.by(() => {
		const counts = new Map<string, number>();
		for (const p of store.packages) {
			if (!baseFilter(p, { skipOwner: true })) continue;
			counts.set(p.ns, (counts.get(p.ns) ?? 0) + 1);
		}
		return counts;
	});

	const topCats = $derived([...new Set([...catCounts.keys(), ...f.categories])].sort((a, b) => (catCounts.get(b) ?? 0) - (catCounts.get(a) ?? 0)).slice(0, 20));
	const topOwners = $derived(
		[...new Set([...ownerCounts.keys(), ...f.owners])].sort((a, b) => (ownerCounts.get(b) ?? 0) - (ownerCounts.get(a) ?? 0)).slice(0, 20),
	);

	$effect(() => {
		// Paging zurücksetzen, sobald sich die Treffermenge ändert
		void filtered;
		visibleCount = 60;
	});

	const STATUS_LABELS = [
		["inProfile", "Im Profil"],
		["installed", "Installiert"],
		["updates", "Update verfügbar"],
	] as const;
</script>

<div class="grid h-full grid-cols-[220px_1fr] gap-4">
	<aside class="flex flex-col gap-4 overflow-y-auto pr-2">
		<div>
			<h4 class="mb-2 text-sm font-medium">Status</h4>
			<div class="flex flex-col gap-1.5">
				{#each STATUS_LABELS as [flag, label] (flag)}
					<label class="flex items-center gap-2 text-sm">
						<Checkbox checked={f.statusFlags.has(flag)} onCheckedChange={() => (f.statusFlags = toggled(f.statusFlags, flag))} />
						{label}
					</label>
				{/each}
			</div>
		</div>

		<div>
			<h4 class="mb-2 text-sm font-medium">Aktualisiert</h4>
			<NativeSelect.Root bind:value={() => String(f.ageDays), (v) => (f.ageDays = Number(v))} class="w-full">
				<NativeSelect.Option value="0">Beliebig</NativeSelect.Option>
				<NativeSelect.Option value="30">≤ 30 Tage</NativeSelect.Option>
				<NativeSelect.Option value="90">≤ 90 Tage</NativeSelect.Option>
				<NativeSelect.Option value="365">≤ 1 Jahr</NativeSelect.Option>
			</NativeSelect.Root>
		</div>

		{#if topCats.length}
			<div>
				<h4 class="mb-2 text-sm font-medium">Kategorien</h4>
				<div class="flex max-h-48 flex-col gap-1.5 overflow-y-auto">
					{#each topCats as cat (cat)}
						<label class="flex items-center justify-between gap-2 text-sm">
							<span class="flex items-center gap-2">
								<Checkbox checked={f.categories.has(cat)} onCheckedChange={() => store.filterCategory(cat)} />
								{cat}
							</span>
							<span class="text-muted-foreground text-xs">{catCounts.get(cat) ?? 0}</span>
						</label>
					{/each}
				</div>
			</div>
		{/if}

		{#if topOwners.length}
			<div>
				<h4 class="mb-2 text-sm font-medium">Autor</h4>
				<div class="flex max-h-48 flex-col gap-1.5 overflow-y-auto">
					{#each topOwners as owner (owner)}
						<label class="flex items-center justify-between gap-2 text-sm">
							<span class="flex items-center gap-2">
								<Checkbox checked={f.owners.has(owner)} onCheckedChange={() => store.filterOwner(owner)} />
								{owner}
							</span>
							<span class="text-muted-foreground text-xs">{ownerCounts.get(owner) ?? 0}</span>
						</label>
					{/each}
				</div>
			</div>
		{/if}

		<div class="flex flex-col gap-1.5">
			<label class="flex items-center gap-2 text-sm">
				<Checkbox bind:checked={f.showDeprecated} />
				Veraltete zeigen
			</label>
			<label class="flex items-center gap-2 text-sm">
				<Checkbox bind:checked={f.showNsfw} />
				NSFW zeigen
			</label>
		</div>

		<Button variant="link" class="h-auto justify-start p-0" onclick={() => f.reset()}>Filter zurücksetzen</Button>
	</aside>

	<div class="flex min-h-0 flex-col gap-3">
		<div class="flex gap-2">
			<Input placeholder="Suchen…" bind:value={f.query} class="flex-1" />
			<NativeSelect.Root bind:value={f.sort} class="w-auto">
				<NativeSelect.Option value="auto">Relevanz</NativeSelect.Option>
				<NativeSelect.Option value="rating">Bewertung</NativeSelect.Option>
				<NativeSelect.Option value="dl">Downloads</NativeSelect.Option>
				<NativeSelect.Option value="upd">Aktualisiert</NativeSelect.Option>
				<NativeSelect.Option value="name">Name</NativeSelect.Option>
			</NativeSelect.Root>
		</div>

		<div class="text-muted-foreground flex items-center gap-1 text-xs">
			{#if store.indexLoading && !store.packages.length}
				Index wird geladen…
			{:else if store.indexError}
				{store.indexError}
			{:else}
				{filtered.length.toLocaleString("de")} Treffer
				{#if store.indexFetchedAt}· Index {relativeTime(store.indexFetchedAt)}{/if}
			{/if}
			<Button variant="link" size="xs" class="h-auto p-0 pl-1" onclick={() => store.refreshIndex()}>aktualisieren</Button>
		</div>

		<ScrollArea class="min-h-0 flex-1">
			<ul class="flex flex-col gap-1 pr-3">
				{#each filtered.slice(0, visibleCount) as p (p.id)}
					{@const s = store.status(p.id)}
					<li>
						<div
							role="button"
							tabindex="0"
							class="hover:bg-accent flex w-full cursor-pointer items-center gap-3 rounded-md p-2 text-left"
							onclick={() => store.openPackage(p.id)}
							onkeydown={(e) => (e.key === "Enter" || e.key === " ") && store.openPackage(p.id)}
						>
							<img src={p.icon} alt="" loading="lazy" class="size-9 shrink-0 rounded-md" />
							<div class="min-w-0 flex-1">
								<div class="flex items-center gap-1.5">
									<span class="truncate text-sm font-medium">{p.name}</span>
									<span class="text-muted-foreground shrink-0 text-xs">{p.ns} · v{p.ver}</span>
									{#if s.m}<Badge variant="secondary">{s.inst ? `v${s.inst}` : "im Profil"}</Badge>{/if}
									{#if s.asDep}<Badge variant="secondary">Abhängigkeit</Badge>{/if}
									{#if s.update}<Badge>→ {s.update}</Badge>{/if}
									{#if p.dep}<Badge variant="destructive">veraltet</Badge>{/if}
								</div>
								<p class="text-muted-foreground truncate text-xs">{p.desc}</p>
								<p class="text-muted-foreground text-xs">
									⬇ {formatNumber(p.dl)} · ★ {p.rating} · {relativeTime(p.upd)}
									{#if p.ndeps}· {p.ndeps} Abh.{/if}
								</p>
							</div>
							<Button
								size="icon-sm"
								variant={s.update ? "default" : s.m ? "secondary" : "outline"}
								onclick={(e) => {
									e.stopPropagation();
									store.toggleMod(p.id);
								}}
								title={s.update ? "Aktualisieren" : s.m ? "Entfernen" : "Zum Profil hinzufügen"}
							>
								{s.update ? "↑" : s.m ? "✓" : "+"}
							</Button>
						</div>
					</li>
				{/each}
			</ul>
			{#if visibleCount < filtered.length}
				<div class="flex justify-center py-3">
					<Button variant="outline" size="sm" onclick={() => (visibleCount += 60)}>Mehr laden</Button>
				</div>
			{/if}
		</ScrollArea>
	</div>
</div>
```

(Die Zeile ist jetzt ein `div role="button"` statt `<button>`: ein `<button>` im `<button>` ist ungültiges HTML.)

- [ ] **Step 10: `ImportProfileDialog.svelte` ersetzen (Code oder Datei)**

```svelte
<script lang="ts">
	import { open as openDialog } from "@tauri-apps/plugin-dialog";
	import * as Dialog from "$lib/components/ui/dialog";
	import { Button } from "$lib/components/ui/button";
	import { Input } from "$lib/components/ui/input";
	import { Label } from "$lib/components/ui/label";
	import { Checkbox } from "$lib/components/ui/checkbox";
	import { store } from "$lib/api/store.svelte";

	let { open = $bindable(false) }: { open?: boolean } = $props();
	let mode = $state<"code" | "file">("code");
	let code = $state("");
	let file = $state<string | null>(null);
	let name = $state("");
	let withConfigs = $state(true);
	let busy = $state(false);

	const ready = $derived(mode === "code" ? !!code.trim() : !!file);
	const fileName = $derived(file?.split(/[\\/]/).pop() ?? null);

	async function pickFile() {
		const sel = await openDialog({ multiple: false, filters: [{ name: "r2modman-Profil", extensions: ["r2z", "zip"] }] });
		if (typeof sel === "string") file = sel;
	}

	async function submit() {
		if (!ready || busy) return;
		busy = true;
		try {
			const ok = mode === "code" ? await store.importCode(code.trim(), name.trim(), withConfigs) : await store.importFile(file!, name.trim(), withConfigs);
			if (ok) {
				open = false;
				code = "";
				file = null;
				name = "";
			}
		} finally {
			busy = false;
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>Profil importieren</Dialog.Title>
			<Dialog.Description>Aus r2modman / Thunderstore Mod Manager: per Code („Share“) oder als .r2z-Datei.</Dialog.Description>
		</Dialog.Header>
		<div class="grid gap-4">
			<div class="flex gap-2">
				<Button size="sm" variant={mode === "code" ? "secondary" : "ghost"} onclick={() => (mode = "code")}>Code</Button>
				<Button size="sm" variant={mode === "file" ? "secondary" : "ghost"} onclick={() => (mode = "file")}>Datei</Button>
			</div>
			{#if mode === "code"}
				<div class="grid gap-2">
					<Label for="import-code">Profilcode</Label>
					<Input id="import-code" bind:value={code} placeholder="z. B. 018f2c1a-…" />
				</div>
			{:else}
				<div class="flex items-center gap-2">
					<Button variant="outline" size="sm" onclick={pickFile}>Datei wählen…</Button>
					<span class="text-muted-foreground truncate text-sm">{fileName ?? "keine Datei gewählt"}</span>
				</div>
			{/if}
			<div class="grid gap-2">
				<Label for="import-name">Name (optional)</Label>
				<Input id="import-name" bind:value={name} placeholder="Originalname übernehmen" />
			</div>
			<label class="flex items-center gap-2 text-sm">
				<Checkbox bind:checked={withConfigs} />
				Configs aus dem Profil übernehmen
			</label>
		</div>
		<Dialog.Footer>
			<Button variant="outline" onclick={() => (open = false)}>Abbrechen</Button>
			<Button onclick={submit} disabled={busy || !ready}>Importieren</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
```

- [ ] **Step 11: `ConfigTab.svelte` an Profil-Configs anpassen**

Im `<script>`: `loadFiles` und den Aufruf ersetzen, `openFile` absichern, Profilwechsel beachten:

```ts
async function loadFiles() {
	loading = true;
	try {
		files = await api.listConfigFiles();
	} catch (e) {
		files = [];
		if (store.state.active) store.toast(e instanceof ApiError ? e.message : "Configs konnten nicht geladen werden.", "err");
	} finally {
		loading = false;
	}
}

$effect(() => {
	// neu laden, wenn das aktive Profil wechselt
	void store.state.active;
	currentFile = null;
	settings = [];
	dirty = new Map();
	loadFiles();
});
```

```ts
async function openFile(f: string) {
	if (dirty.size && !confirm("Ungespeicherte Änderungen verwerfen?")) return;
	try {
		const data = await api.getConfigFile(f);
		currentFile = f;
		settings = data.settings;
		dirty = new Map();
	} catch (e) {
		store.toast(e instanceof ApiError ? e.message : "Datei konnte nicht gelesen werden.", "err");
	}
}
```

Im Markup: Leermeldung ersetzen durch
`Keine .cfg-Dateien. Die meisten Mods legen ihre Config beim ersten Spielstart an.`
und unter dem Dateifilter-Input ergänzen:

```svelte
<Button variant="outline" size="sm" onclick={() => store.openFolder("config")} disabled={!store.state.active}>Config-Ordner öffnen</Button>
```

- [ ] **Step 12: Layout und Seiten**

`src/routes/+layout.svelte`:

```svelte
<script lang="ts">
	import "../app.css";
	import { onMount } from "svelte";
	import { page } from "$app/state";
	import { Button } from "$lib/components/ui/button";
	import { Badge } from "$lib/components/ui/badge";
	import * as NativeSelect from "$lib/components/ui/native-select";
	import { Toaster } from "$lib/components/ui/sonner";
	import { store } from "$lib/api/store.svelte";
	import PackageSheet from "$lib/components/app/PackageSheet.svelte";
	import NameDialog from "$lib/components/app/NameDialog.svelte";
	import SyncIndicator from "$lib/components/app/SyncIndicator.svelte";

	let { children } = $props();
	let newProfileOpen = $state(false);

	const NAV = [
		{ href: "/", label: "Durchsuchen" },
		{ href: "/profile", label: "Profil" },
		{ href: "/config", label: "Config" },
		{ href: "/logs", label: "Log" },
		{ href: "/settings", label: "Einstellungen" },
	];

	onMount(() => {
		let cleanup: (() => void) | undefined;
		let disposed = false;
		store.init().then((c) => {
			if (disposed) c();
			else cleanup = c;
		});
		return () => {
			disposed = true;
			cleanup?.();
		};
	});
</script>

<div class="flex h-screen flex-col">
	<header class="flex items-center gap-3 border-b px-4 py-2.5">
		<strong class="text-sm font-semibold">Valheim Mods</strong>
		<nav class="mx-2 flex gap-1">
			{#each NAV as item (item.href)}
				<Button href={item.href} size="sm" variant={page.url.pathname === item.href ? "secondary" : "ghost"}>
					{item.label}
					{#if item.href === "/profile" && store.state.mods.length}
						<Badge variant="outline" class="ml-1">{store.state.mods.length}</Badge>
					{/if}
				</Button>
			{/each}
		</nav>

		<div class="flex-1"></div>
		<SyncIndicator />

		<NativeSelect.Root value={store.state.active ?? ""} onchange={(e) => store.activateProfile(e.currentTarget.value)} size="sm" aria-label="Aktives Profil">
			{#if !store.state.active}
				<NativeSelect.Option value="">— kein Profil —</NativeSelect.Option>
			{/if}
			{#each store.state.profiles as p (p)}
				<NativeSelect.Option value={p}>{p}</NativeSelect.Option>
			{/each}
		</NativeSelect.Root>
		<Button variant="outline" size="icon-sm" title="Neues Profil" onclick={() => (newProfileOpen = true)}>+</Button>

		<div class="flex">
			<Button size="sm" class="rounded-r-none" disabled={store.launching || !store.state.active} onclick={() => store.launch(true)}>
				{store.launching ? "Startet…" : "▶ Spielen"}
			</Button>
			<Button
				size="sm"
				variant="outline"
				class="rounded-l-none border-l-0"
				disabled={store.launching}
				title="Valheim ohne Mods starten"
				onclick={() => store.launch(false)}
			>
				Vanilla
			</Button>
		</div>
	</header>

	{#if store.loaded && !store.state.game.found}
		<div class="bg-destructive/10 text-destructive px-4 py-1.5 text-sm">
			Valheim wurde nicht gefunden. <a href="/settings" class="underline">Spielordner in den Einstellungen festlegen</a>.
		</div>
	{/if}

	<main class="min-h-0 flex-1 overflow-hidden p-4">
		{@render children()}
	</main>
</div>

<PackageSheet />
<NameDialog
	bind:open={newProfileOpen}
	title="Neues Profil"
	description="Name für das neue Mod-Profil."
	submitLabel="Anlegen"
	onSubmit={(n) => store.newProfile(n)}
/>
<Toaster richColors position="bottom-right" />
```

`src/routes/+page.svelte`:

```svelte
<script lang="ts">
	import ModsTab from "$lib/components/app/ModsTab.svelte";
</script>

<ModsTab />
```

`src/routes/config/+page.svelte`:

```svelte
<script lang="ts">
	import ConfigTab from "$lib/components/app/ConfigTab.svelte";
</script>

<ConfigTab />
```

- [ ] **Step 13: Prüfen**

Run: `npm run check && npm run build`
Expected: 0 Fehler, 0 Warnungen; `build/index.html` existiert. Alle geänderten `.svelte`-Dateien mit dem Svelte-Autofixer prüfen und Meldungen beheben.

- [ ] **Step 14: Commit**

```bash
git add -A
git commit -m "feat(ui): migrate to SvelteKit SPA with invoke-based API and browse page"
```

---

### Task 13: Profil-, Log- und Einstellungsseite

**Files:**

- Create: `src/lib/components/app/ProfileView.svelte`, `ExportCodeDialog.svelte`, `LogView.svelte`, `SettingsView.svelte`
- Create: `src/routes/profile/+page.svelte`, `src/routes/logs/+page.svelte`, `src/routes/settings/+page.svelte`

**Interfaces:**

- Consumes: `store`, `api`, `modId`, `NameDialog`, `ImportProfileDialog` (Task 12), Tauri-Plugins `dialog`, `clipboard-manager`, `@tauri-apps/api/webview` (Drag & Drop), Event `log://lines`
- Produces: vollständige Seiten `/profile`, `/logs`, `/settings`

- [ ] **Step 1: `ExportCodeDialog.svelte`**

```svelte
<script lang="ts">
	import { writeText } from "@tauri-apps/plugin-clipboard-manager";
	import * as Dialog from "$lib/components/ui/dialog";
	import { Button } from "$lib/components/ui/button";
	import { store } from "$lib/api/store.svelte";

	let { code = $bindable(null) }: { code: string | null } = $props();
	let copied = $state(false);

	async function copy() {
		if (!code) return;
		try {
			await writeText(code);
			copied = true;
		} catch {
			store.toast("Kopieren fehlgeschlagen.", "err");
		}
	}

	$effect(() => {
		copied = false;
		if (code) copy();
	});
</script>

<Dialog.Root open={code !== null} onOpenChange={(o) => !o && (code = null)}>
	<Dialog.Content class="sm:max-w-sm">
		<Dialog.Header>
			<Dialog.Title>Profil geteilt</Dialog.Title>
			<Dialog.Description>
				Der Code funktioniert hier, in r2modman und im Thunderstore Mod Manager.
				{copied ? "Er ist bereits in der Zwischenablage." : ""}
			</Dialog.Description>
		</Dialog.Header>
		<div class="bg-muted rounded-md p-4 text-center font-mono text-lg tracking-wider select-all">{code}</div>
		<Dialog.Footer>
			<Button variant="outline" onclick={copy}>Kopieren</Button>
			<Button onclick={() => (code = null)}>Fertig</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
```

- [ ] **Step 2: `ProfileView.svelte`**

```svelte
<script lang="ts">
	import { onMount } from "svelte";
	import { getCurrentWebview } from "@tauri-apps/api/webview";
	import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
	import { Button } from "$lib/components/ui/button";
	import { Badge } from "$lib/components/ui/badge";
	import { Switch } from "$lib/components/ui/switch";
	import { ScrollArea } from "$lib/components/ui/scroll-area";
	import * as Dialog from "$lib/components/ui/dialog";
	import { store, modId } from "$lib/api/store.svelte";
	import NameDialog from "./NameDialog.svelte";
	import ImportProfileDialog from "./ImportProfileDialog.svelte";
	import ExportCodeDialog from "./ExportCodeDialog.svelte";

	let renameOpen = $state(false);
	let cloneOpen = $state(false);
	let importOpen = $state(false);
	let confirmDelete = $state(false);
	let sharing = $state(false);
	let exportCode = $state<string | null>(null);
	let dragging = $state(false);

	const active = $derived(store.state.active);
	const plan = $derived(store.state.plan);
	const pendingIds = $derived(new Set(plan?.toInstall.map((t) => t.id) ?? []));
	const deps = $derived(plan ? Object.entries(plan.resolved).filter(([id]) => !store.modsMap.has(id)) : []);
	const updateCount = $derived(Object.keys(store.state.updates).length);

	onMount(() => {
		let unlisten: (() => void) | undefined;
		let disposed = false;
		getCurrentWebview()
			.onDragDropEvent((e) => {
				const p = e.payload;
				if (p.type === "enter" || p.type === "over") dragging = true;
				else if (p.type === "leave") dragging = false;
				else if (p.type === "drop") {
					dragging = false;
					const files = p.paths.filter((f) => /\.(zip|dll)$/i.test(f));
					if (files.length) store.addLocalMods(files);
					else store.toast("Nur .zip- oder .dll-Dateien werden unterstützt.", "err");
				}
			})
			.then((u) => {
				if (disposed) u();
				else unlisten = u;
			});
		return () => {
			disposed = true;
			unlisten?.();
		};
	});

	async function pickLocal() {
		const sel = await openDialog({ multiple: true, filters: [{ name: "Mods", extensions: ["zip", "dll"] }] });
		if (!sel) return;
		await store.addLocalMods(Array.isArray(sel) ? sel : [sel]);
	}

	async function shareCode() {
		sharing = true;
		try {
			exportCode = await store.exportCode();
		} finally {
			sharing = false;
		}
	}

	async function exportFile() {
		if (!active) return;
		const path = await saveDialog({ defaultPath: `${active}.r2z`, filters: [{ name: "r2modman-Profil", extensions: ["r2z"] }] });
		if (path) await store.exportFile(path);
	}

	async function doDelete() {
		await store.deleteActiveProfile();
		confirmDelete = false;
	}
</script>

<div class="relative flex h-full flex-col gap-4">
	{#if !active}
		<div class="text-muted-foreground flex flex-col items-start gap-3 text-sm">
			<p>Kein Profil aktiv. Lege oben mit „+“ eins an oder importiere eins.</p>
			<Button size="sm" variant="outline" onclick={() => (importOpen = true)}>Profil importieren</Button>
		</div>
	{:else}
		<div class="flex flex-wrap items-center gap-2">
			<Button size="sm" onclick={() => store.updateAll()} disabled={!updateCount}>
				Alle aktualisieren
				{#if updateCount}<Badge variant="secondary" class="ml-1.5">{updateCount}</Badge>{/if}
			</Button>
			<Button size="sm" variant="outline" onclick={pickLocal}>Lokaler Mod…</Button>
			<Button size="sm" variant="outline" onclick={() => (importOpen = true)}>Importieren</Button>
			<Button size="sm" variant="outline" onclick={shareCode} disabled={sharing || !store.state.mods.length}>
				{sharing ? "Lädt hoch…" : "Teilen (Code)"}
			</Button>
			<Button size="sm" variant="outline" onclick={exportFile}>Exportieren (.r2z)</Button>
			<div class="flex-1"></div>
			<Button size="sm" variant="ghost" onclick={() => store.openFolder("profile")}>Ordner</Button>
			<Button size="sm" variant="ghost" onclick={() => store.repair()}>Reparieren</Button>
			<Button size="sm" variant="ghost" onclick={() => (cloneOpen = true)}>Klonen</Button>
			<Button size="sm" variant="ghost" onclick={() => (renameOpen = true)}>Umbenennen</Button>
			<Button size="sm" variant="destructive" onclick={() => (confirmDelete = true)}>Löschen</Button>
		</div>

		{#if plan?.errors.length}
			<div class="bg-destructive/10 text-destructive rounded-md p-3 text-sm">
				<ul class="space-y-0.5">
					{#each plan.errors as err (err)}<li>{err}</li>{/each}
				</ul>
			</div>
		{/if}

		{#if !store.state.mods.length}
			<p class="text-muted-foreground text-sm">Noch keine Mods. Unter „Durchsuchen“ hinzufügen oder .zip/.dll-Dateien hierher ziehen.</p>
		{/if}

		<ScrollArea class="min-h-0 flex-1">
			<ul class="flex flex-col gap-1 pr-3">
				{#each store.state.mods as m (modId(m))}
					{@const id = modId(m)}
					{@const s = store.status(id)}
					<li class="flex items-center gap-3 rounded-md border p-2 text-sm {m.enabled ? '' : 'opacity-60'}">
						<Switch checked={m.enabled} onCheckedChange={(v) => store.setEnabled(id, v)} aria-label="{m.name} aktivieren" />
						{#if s.p}<img src={s.p.icon} alt="" loading="lazy" class="size-8 shrink-0 rounded" />{/if}
						<div class="min-w-0 flex-1">
							<div class="flex items-center gap-1.5">
								{#if m.source === "local"}
									<span class="font-medium">{m.name}</span>
									<Badge variant="outline">lokal</Badge>
								{:else}
									<button class="font-medium hover:underline" onclick={() => store.openPackage(id)}>{m.name}</button>
									<span class="text-muted-foreground text-xs">{m.namespace}</span>
								{/if}
							</div>
							<div class="text-muted-foreground text-xs">
								v{m.version}
								{#if pendingIds.has(id)}· wird installiert…{:else if !s.inst}· nicht installiert{/if}
							</div>
						</div>
						{#if s.update}
							<Button size="sm" variant="outline" onclick={() => store.toggleMod(id, s.update)}>Update → {s.update}</Button>
						{/if}
						<Button size="sm" variant="ghost" onclick={() => store.removeMod(id)}>Entfernen</Button>
					</li>
				{/each}
				{#if deps.length}
					<li class="text-muted-foreground pt-3 text-xs">Automatische Abhängigkeiten</li>
					{#each deps as [id, r] (id)}
						<li class="text-muted-foreground flex items-center justify-between gap-2 rounded-md border border-dashed p-2 text-sm">
							<button class="hover:underline" onclick={() => store.openPackage(id)}>{id} v{r.version}</button>
							<span class="text-xs">{r.requiredBy.length ? `für ${r.requiredBy.join(", ")}` : "Basis (BepInEx)"}</span>
						</li>
					{/each}
				{/if}
			</ul>
		</ScrollArea>
	{/if}

	{#if dragging}
		<div
			class="bg-background/80 border-primary pointer-events-none absolute inset-0 flex items-center justify-center rounded-lg border-2 border-dashed text-sm font-medium"
		>
			.zip / .dll hier ablegen
		</div>
	{/if}
</div>

<NameDialog
	bind:open={renameOpen}
	title="Profil umbenennen"
	description={`Neuer Name für „${active}“.`}
	submitLabel="Umbenennen"
	initial={active ?? ""}
	onSubmit={(n) => store.renameActive(n)}
/>
<NameDialog
	bind:open={cloneOpen}
	title="Profil klonen"
	description={`Kopie von „${active}“ mit allen Mods und Configs.`}
	submitLabel="Klonen"
	initial={`${active ?? ""} Kopie`}
	onSubmit={(n) => store.cloneActive(n)}
/>
<ImportProfileDialog bind:open={importOpen} />
<ExportCodeDialog bind:code={exportCode} />

<Dialog.Root bind:open={confirmDelete}>
	<Dialog.Content class="sm:max-w-sm">
		<Dialog.Header>
			<Dialog.Title>Profil „{active}“ löschen?</Dialog.Title>
			<Dialog.Description>Mods, Configs und Log dieses Profils werden gelöscht.</Dialog.Description>
		</Dialog.Header>
		<Dialog.Footer>
			<Button variant="outline" onclick={() => (confirmDelete = false)}>Abbrechen</Button>
			<Button variant="destructive" onclick={doDelete}>Löschen</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
```

- [ ] **Step 3: `LogView.svelte`**

```svelte
<script lang="ts">
	import { onMount, tick } from "svelte";
	import { listen } from "@tauri-apps/api/event";
	import { Input } from "$lib/components/ui/input";
	import { Button } from "$lib/components/ui/button";
	import { Checkbox } from "$lib/components/ui/checkbox";
	import { api } from "$lib/api/client";
	import { store } from "$lib/api/store.svelte";
	import type { LogChunk } from "$lib/api/types";

	const MAX_LINES = 5000;
	const LEVELS = ["Fatal", "Error", "Warning", "Message", "Info", "Debug"] as const;
	type Level = (typeof LEVELS)[number];

	let lines = $state.raw<string[]>([]);
	let query = $state("");
	let levels = $state<Set<Level>>(new Set(LEVELS));
	let follow = $state(true);
	let scroller = $state<HTMLDivElement>();

	function levelOf(line: string): Level | null {
		const m = /^\[(\w+)\s*:/.exec(line);
		return m && (LEVELS as readonly string[]).includes(m[1]) ? (m[1] as Level) : null;
	}

	function colorOf(line: string): string {
		switch (levelOf(line)) {
			case "Fatal":
			case "Error":
				return "text-destructive";
			case "Warning":
				return "text-amber-600 dark:text-amber-400";
			case "Debug":
				return "text-muted-foreground";
			default:
				return "";
		}
	}

	const visible = $derived.by(() => {
		const q = query.toLowerCase();
		return lines.filter((l) => {
			const lv = levelOf(l);
			if (lv && !levels.has(lv)) return false;
			return !q || l.toLowerCase().includes(q);
		});
	});

	function append(chunk: LogChunk) {
		const next = chunk.reset ? chunk.lines : [...lines, ...chunk.lines];
		lines = next.length > MAX_LINES ? next.slice(-MAX_LINES) : next;
	}

	function toggleLevel(l: Level) {
		const next = new Set(levels);
		if (next.has(l)) next.delete(l);
		else next.add(l);
		levels = next;
	}

	async function start() {
		try {
			lines = await api.startLogTail();
		} catch (e) {
			lines = [];
			if (store.state.active) store.toast(e instanceof Error ? e.message : "Log konnte nicht geöffnet werden.", "err");
		}
	}

	$effect(() => {
		// Log des aktiven Profils verfolgen
		void store.state.active;
		start();
	});

	$effect(() => {
		void visible.length;
		if (!follow || !scroller) return;
		const el = scroller;
		tick().then(() => (el.scrollTop = el.scrollHeight));
	});

	onMount(() => {
		let unlisten: (() => void) | undefined;
		let disposed = false;
		listen<LogChunk>("log://lines", (e) => append(e.payload)).then((u) => {
			if (disposed) u();
			else unlisten = u;
		});
		return () => {
			disposed = true;
			unlisten?.();
			api.stopLogTail().catch(() => {});
		};
	});
</script>

<div class="flex h-full flex-col gap-3">
	<div class="flex flex-wrap items-center gap-3">
		<Input placeholder="Log durchsuchen…" bind:value={query} class="w-64" />
		{#each LEVELS as l (l)}
			<label class="flex items-center gap-1.5 text-sm">
				<Checkbox checked={levels.has(l)} onCheckedChange={() => toggleLevel(l)} />
				{l}
			</label>
		{/each}
		<div class="flex-1"></div>
		<label class="flex items-center gap-1.5 text-sm">
			<Checkbox bind:checked={follow} />
			Mitlaufen
		</label>
		<Button size="sm" variant="outline" onclick={() => (lines = [])}>Leeren</Button>
		<Button size="sm" variant="outline" onclick={() => store.openFolder("profile")} disabled={!store.state.active}>Ordner öffnen</Button>
	</div>
	<div bind:this={scroller} class="bg-muted/30 min-h-0 flex-1 overflow-auto rounded-md border p-3 font-mono text-xs leading-5">
		{#if !lines.length}
			<p class="text-muted-foreground">Noch kein Log. Starte das Spiel mit diesem Profil – neue Zeilen erscheinen hier live.</p>
		{/if}
		{#each visible as line, i (i)}
			<div class="whitespace-pre-wrap {colorOf(line)}">{line}</div>
		{/each}
	</div>
</div>
```

- [ ] **Step 4: `SettingsView.svelte`**

```svelte
<script lang="ts">
	import { onMount } from "svelte";
	import { open as openDialog } from "@tauri-apps/plugin-dialog";
	import { Button } from "$lib/components/ui/button";
	import { Input } from "$lib/components/ui/input";
	import { Label } from "$lib/components/ui/label";
	import { Switch } from "$lib/components/ui/switch";
	import * as Card from "$lib/components/ui/card";
	import { api } from "$lib/api/client";
	import { store } from "$lib/api/store.svelte";
	import type { GameInfo, Settings } from "$lib/api/types";
	import { formatBytes } from "$lib/format";

	let form = $state<Settings | null>(null);
	let detected = $state<GameInfo | null>(null);
	let busy = $state(false);

	$effect(() => {
		if (store.settings && !form) form = { ...store.settings };
	});

	onMount(() => {
		api
			.detectGame()
			.then((d) => (detected = d))
			.catch(() => {});
	});

	async function pickValheim() {
		const dir = await openDialog({ directory: true });
		if (typeof dir === "string" && form) form.valheimDir = dir;
	}

	async function pickSteam() {
		const file = await openDialog({ filters: [{ name: "steam.exe", extensions: ["exe"] }] });
		if (typeof file === "string" && form) form.steamExe = file;
	}

	async function save() {
		if (!form) return;
		busy = true;
		try {
			if (await store.saveSettings(form)) form = { ...store.settings! };
		} finally {
			busy = false;
		}
	}

	async function clearCache() {
		try {
			const freed = await api.clearDownloadCache();
			store.toast(`Download-Cache geleert (${formatBytes(freed)}).`, "ok");
		} catch (e) {
			store.toast(e instanceof Error ? e.message : "Cache konnte nicht geleert werden.", "err");
		}
	}
</script>

{#if form}
	<div class="mx-auto flex h-full max-w-2xl flex-col gap-4 overflow-y-auto pb-4">
		<Card.Root>
			<Card.Header>
				<Card.Title>Spiel</Card.Title>
				<Card.Description>Leer lassen für automatische Erkennung über Steam.</Card.Description>
			</Card.Header>
			<Card.Content class="grid gap-4">
				<div class="grid gap-2">
					<Label for="valheim-dir">Valheim-Ordner</Label>
					<div class="flex gap-2">
						<Input
							id="valheim-dir"
							bind:value={() => form!.valheimDir ?? "", (v) => (form!.valheimDir = v || null)}
							placeholder={detected?.valheimDir ?? "nicht gefunden"}
						/>
						<Button variant="outline" onclick={pickValheim}>Wählen…</Button>
						<Button variant="ghost" onclick={() => store.openFolder("game")}>Öffnen</Button>
					</div>
				</div>
				<div class="grid gap-2">
					<Label for="steam-exe">steam.exe</Label>
					<div class="flex gap-2">
						<Input
							id="steam-exe"
							bind:value={() => form!.steamExe ?? "", (v) => (form!.steamExe = v || null)}
							placeholder={detected?.steamExe ?? "nicht gefunden"}
						/>
						<Button variant="outline" onclick={pickSteam}>Wählen…</Button>
					</div>
				</div>
			</Card.Content>
		</Card.Root>

		<Card.Root>
			<Card.Header>
				<Card.Title>Downloads & Index</Card.Title>
			</Card.Header>
			<Card.Content class="grid grid-cols-2 gap-4">
				<div class="grid gap-2">
					<Label for="concurrency">Parallele Downloads (1–16)</Label>
					<Input id="concurrency" type="number" min="1" max="16" bind:value={form.downloadConcurrency} />
				</div>
				<div class="grid gap-2">
					<Label for="ttl">Index aktualisieren alle (Minuten)</Label>
					<Input id="ttl" type="number" min="5" bind:value={form.indexTtlMinutes} />
				</div>
				<label class="col-span-2 flex items-center gap-2 text-sm">
					<Switch bind:checked={form.showNsfw} />
					NSFW-Mods standardmäßig anzeigen
				</label>
			</Card.Content>
		</Card.Root>

		<div class="flex justify-end">
			<Button onclick={save} disabled={busy}>Speichern</Button>
		</div>

		<Card.Root>
			<Card.Header>
				<Card.Title>Speicher</Card.Title>
				<Card.Description>Profile, Cache und Einstellungen liegen im App-Datenordner.</Card.Description>
			</Card.Header>
			<Card.Content class="flex flex-wrap gap-2">
				<Button variant="outline" onclick={() => store.refreshIndex()}>Mod-Index jetzt aktualisieren</Button>
				<Button variant="outline" onclick={clearCache}>Download-Cache leeren</Button>
				<Button variant="ghost" onclick={() => store.openFolder("data")}>Datenordner öffnen</Button>
			</Card.Content>
		</Card.Root>
	</div>
{:else}
	<p class="text-muted-foreground text-sm">Lädt…</p>
{/if}
```

- [ ] **Step 5: Routen anlegen**

`src/routes/profile/+page.svelte`:

```svelte
<script lang="ts">
	import ProfileView from "$lib/components/app/ProfileView.svelte";
</script>

<ProfileView />
```

`src/routes/logs/+page.svelte`:

```svelte
<script lang="ts">
	import LogView from "$lib/components/app/LogView.svelte";
</script>

<LogView />
```

`src/routes/settings/+page.svelte`:

```svelte
<script lang="ts">
	import SettingsView from "$lib/components/app/SettingsView.svelte";
</script>

<SettingsView />
```

- [ ] **Step 6: Prüfen**

Run: `npm run check && npm run build`
Expected: 0 Fehler, 0 Warnungen. Neue `.svelte`-Dateien mit dem Svelte-Autofixer prüfen.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(ui): profile, log and settings pages with sharing, toggles and local mods"
```

---

### Task 14: README, Gesamtprüfung, Smoke-Test

**Files:**

- Rewrite: `README.md`

- [ ] **Step 1: README ersetzen**

````markdown
# Valheim Mod Manager

Schneller, eigenständiger Mod-Manager für das lokale Valheim (Steam, Windows) –
als Ersatz für r2modman. Tauri 2 + Rust-Kern, SvelteKit-Oberfläche mit
shadcn-svelte. Kein Server, kein Docker: App starten, fertig.

## Funktionen

- Thunderstore-Suche mit Facetten (Kategorien, Autoren, Status, Alter), Index lokal gecacht
- Profile: anlegen, wechseln, klonen, umbenennen, löschen, reparieren
- Automatische Abhängigkeitsauflösung inkl. BepInExPack
- Installation sofort im Hintergrund, parallele Downloads, geteilter Zip-Cache
- Mods einzeln an/aus, Updates pro Mod oder für alle
- Spielen mit Mods oder Vanilla (Doorstop-Start per Steam, Spielordner bleibt sauber)
- r2modman-kompatibel teilen: Code oder `.r2z` importieren/exportieren
- Lokale Mods (`.zip`/`.dll`) per Dateiauswahl oder Drag & Drop
- Config-Editor für BepInEx-`.cfg` (Nutzer-Configs werden bei Updates nie überschrieben)
- BepInEx-Log live mit Level-Filter und Suche

## Entwicklung

Voraussetzungen: Node.js, Rust (rustup), Tauri-Voraussetzungen für Windows
(MSVC Build Tools, WebView2).

```bash
npm install
npm run tauri dev      # Dev-Modus mit Hot-Reload
npm run tauri build    # Installer (.msi/.exe)
npm run check          # Svelte/TypeScript prüfen
cd src-tauri && cargo test   # Rust-Tests
```

## Wie es funktioniert

Jedes Profil ist ein eigener Ordner unter `%APPDATA%\io.github.drloloto.valheim-mod-manager\profiles\<Name>\`
mit vollständigem `BepInEx/`. Im Valheim-Ordner liegen nur `winhttp.dll` und
`doorstop_config.ini`. Beim Start übergibt die App Steam die Doorstop-Argumente,
die auf das Profil zeigen – Profilwechsel kopiert daher keine Dateien.

## Struktur

- `src-tauri/src/` — Rust-Kern: `thunderstore` (Index), `resolver`, `install`, `sync`,
  `profiles`, `share` (r2modman), `config`, `game` (Steam/Start), `localmod`, `logs`,
  `commands` (Tauri-Fassade)
- `src/routes/` — Seiten: Durchsuchen, Profil, Config, Log, Einstellungen
- `src/lib/api/` — `invoke`-Client, Typen, reaktiver Store (Svelte 5 Runes)
- `src/lib/components/ui/` — shadcn-svelte-Komponenten
- `src/lib/components/app/` — App-Komponenten
````

- [ ] **Step 2: Alles prüfen**

Run: `cd src-tauri && cargo clippy --all-targets -- -D warnings && cargo test && cd .. && npm run check && npm run build`
Expected: keine Warnungen, alle Tests PASS, Build ok.

- [ ] **Step 3: App starten (Smoke-Test)**

Run: `npm run tauri dev` im Hintergrund, Ausgabe beobachten.
Expected: Fenster öffnet, keine Panics, im Log kein `Index-Refresh fehlgeschlagen`. App-Datenordner mit `cache/index.json` entsteht.

Manueller Abnahmetest (durch Nutzer, echtes Valheim): Valheim erkannt → Profil anlegen → Mod mit Abhängigkeit hinzufügen → Sync fertig → Spielen → Log zeigt Mod → Mod deaktivieren → Spielen → Mod lädt nicht → Vanilla ohne BepInEx.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "docs: README for the standalone mod manager"
```
