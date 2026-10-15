# P0 Speicher-Fundament — Implementation Plan

> **ZURÜCKGESTELLT (2026-10-02):** Dieser Plan wird nicht ausgeführt. Der git-Hybrid-Ansatz ist verworfen, bis er neu bewertet wird. Aktueller Plan: `docs/superpowers/plans/2026-10-02-ui-foundation.md`.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die v1-Datenablage wird auf ein dedupliziertes, versioniertes Fundament umgebaut: internierter Binär-Index, inhaltsadressierter Store mit Hardlinks, Packs mit UUID, `pack.json` und `pack.lock` in einem git-Repo.

**Architecture:**

- **Store:** Neues Modul `store.rs` (Objekte nach BLAKE3-Hash, Recipes pro Paket-Zip, `materialize` per Hardlink).
- **Packs:** Neues Modul `pack.rs` ersetzt `profiles.rs` (UUID-Ordner, Manifest, Lock, Status und git-Commits über `git2`).
- **Resolver und Sync:** Der Resolver erzeugt einen Lock; der Sync installiert nur noch aus dem Lock über den Store.
- **Index:** Der Thunderstore-Index interniert die Abhängigkeits-Strings und wird mit `postcard` gecacht.
- **Frontend:** Nur minimale Änderungen (Profil-IDs, Speicheranzeige).

**Tech Stack:** Rust (Tauri 2, git2 0.21 mit vendored libgit2, blake3, postcard, uuid), SvelteKit/Svelte 5.

**Spec:** `docs/superpowers/specs/2026-09-26-p0-storage-foundation-design.md` (Kontext: `docs/vision/2026-09-26-mod-platform-vision.md`, `docs/superpowers/specs/2026-09-26-vision-impact-analysis.md`)

## Global Constraints

- `git2 = { version = "0.21", default-features = false, features = ["vendored-libgit2"] }`, `blake3 = "1"`, `postcard = { version = "1", features = ["alloc"] }`, `uuid = { version = "1", features = ["v4"] }`.
- Jede von der App geschriebene Datei hat `schema: 1`.
- Configs (`BepInEx/config/**`) werden nie verlinkt; sie werden nur kopiert, wenn sie fehlen, und nie überschrieben.
- Der Sync installiert ausschließlich aus `pack.lock`. Ein frischer Lock (Fingerprint passt zum Manifest) braucht keinen Index.
- Profilordner = UUID. Anzeigenamen sind frei (1–64 Zeichen, keine Steuerzeichen), Duplikate sind erlaubt.
- Keine Migration von v1-Daten. Eine alte `cache/index.json` wird gelöscht.
- Texte in Deutsch. Commit-Nachrichten enden mit `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Gate je Task: `cargo clippy --all-targets -- -D warnings` und `cargo test --lib`, ab Task 5 zusätzlich `npm run check` und `npm run build`.

## Review Focus

1. **Ein Mod ändert zur Laufzeit seine eigene (verlinkte) DLL.** Erwartet: „Reparieren“ erkennt das über den Hash und stellt die Datei in allen Profilen wieder her. Test in Task 2 (`verify_and_invalidate_restore_tampered_objects`) und Task 4 (`repair_restores_tampered_link`).
2. **Das gecachte Zip wurde manipuliert oder ist beschädigt, der Lock kennt den Hash.** Erwartet: Das Zip wird verworfen und es erscheint ein klarer Fehler statt einer Installation. Test in Task 4 (`rejects_zip_with_wrong_hash`).
3. **Der Index ändert sich nach dem Locken** (neue Versionen, Paket gelöscht). Erwartet: Das Profil bleibt bitgenau auf dem Lock-Stand. Test in Task 4 (`lock_pins_versions_when_index_changes`).
4. **Profil löschen, obwohl git schreibgeschützte Objektdateien angelegt hat (Windows).** Erwartet: Der Ordner verschwindet vollständig. Test in Task 3 (`delete_removes_folder_and_active`) sowie der `remove_tree`-Test.
5. **Zwei Profile nutzen dieselbe Mod-Version, und eines ändert seine Configs.** Erwartet: Das andere Profil bleibt unberührt. Test in Task 2 (`materialize_links_files_and_copies_configs`).

---

## Dateistruktur

```
src-tauri/Cargo.toml                  (T1, T2, T3: Abhängigkeiten)
src-tauri/src/thunderstore.rs         (T1: Interning, postcard-Cache, Index-API)
src-tauri/src/resolver.rs             (T1: arbeitet auf &Index; T4: lock/plan/fingerprint)
src-tauri/src/paths.rs                (T1, T2, T3, T4)
src-tauri/src/install.rs              (T2: plan_archive; T4: extract_zip/install_local entfallen)
src-tauri/src/store.rs                (T2: neu)
src-tauri/src/util.rs                 (T3: remove_tree)
src-tauri/src/models.rs               (T3: Manifest, Lock, LockEntry, SCHEMA; T4: Profile entfällt)
src-tauri/src/pack.rs                 (T3: neu; ersetzt profiles.rs in T4)
src-tauri/src/sync.rs                 (T1 Anpassung; T4 Neufassung)
src-tauri/src/localmod.rs, share.rs   (T4)
src-tauri/src/commands.rs, lib.rs     (T1 Anpassung; T4 Neufassung)
src/lib/api/{types,client}.ts, store.svelte.ts, routes/+layout.svelte,
src/lib/components/app/{ProfileView,SettingsView}.svelte   (T5)
README.md, docs/superpowers/specs/2026-09-26-p0-storage-foundation-design.md (T6: Messwerte)
```

---

### Task 1: Internierter Binär-Index

**Files:**

- Modify: `src-tauri/Cargo.toml` (+ `postcard`)
- Modify: `src-tauri/src/thunderstore.rs` (IPkg, Index-API, build, Cache)
- Modify: `src-tauri/src/resolver.rs` (Signaturen auf `&Index`)
- Modify: `src-tauri/src/paths.rs` (`index_cache` → `index.bin`, `legacy_index_cache`)
- Modify: `src-tauri/src/sync.rs`, `src-tauri/src/commands.rs` (Aufrufstellen)

**Interfaces:**

- Produces:
  - `thunderstore::{IVersion{v, deps: Vec<u32>, size, date}, IPkg{…, versions: Vec<IVersion>}}`
  - `Index`, Felder `fetched_at`, `slim_json` public, dazu die Methoden `get(&str) -> Option<&IPkg>`, `dep(u32) -> &str`, `dep_count() -> usize` und `pkg(&str) -> Option<Pkg>` (mit Strings, fürs Frontend)
  - `build(i64, Vec<Pkg>) -> Index`, `save_cache(&Path, &Index) -> Result<()>`, `load_cache(&Path) -> Option<Index>`
  - `resolver::plan(&[ProfileMod], &Index, &Installed) -> Plan`, `resolver::updates(&[ProfileMod], &Index)`
  - `Paths::legacy_index_cache()`

- [ ] **Step 1: Abhängigkeit ergänzen**

In `[dependencies]` von `src-tauri/Cargo.toml`:

```toml
postcard = { version = "1", features = ["alloc"] }
```

- [ ] **Step 2: Failing Tests schreiben**

Im Test-Modul von `thunderstore.rs` wird `builds_slim_payload_and_roundtrips_cache` ersetzt und ein Interning-Test ergänzt:

```rust
    #[test]
    fn builds_slim_payload_and_roundtrips_binary_cache() {
        let pkgs = parse_raw(RAW.as_bytes()).unwrap();
        let idx = build(1000, pkgs.clone());
        let slim: serde_json::Value = serde_json::from_slice(&idx.slim_json).unwrap();
        assert_eq!(slim["fetchedAt"], 1000);
        assert_eq!(slim["packages"][0]["ver"], "5.4.2351");
        assert_eq!(slim["packages"][0]["size"], 123);
        assert!(slim["packages"][0].get("versions").is_none());

        let dir = tempfile::tempdir().unwrap();
        let cache = dir.path().join("cache").join("index.bin");
        assert!(load_cache(&cache).is_none());
        save_cache(&cache, &idx).unwrap();
        assert_ne!(std::fs::read(&cache).unwrap()[0], b'{', "Cache ist binär, kein JSON");
        let loaded = load_cache(&cache).unwrap();
        assert_eq!(loaded.fetched_at, 1000);
        assert_eq!(loaded.pkg("denikson-BepInExPack_Valheim"), Some(pkgs[0].clone()));
    }

    #[test]
    fn interns_dependency_strings() {
        use crate::models::test_pkg;
        let idx = build(0, vec![
            test_pkg("a-A", &[("2.0.0", &["x-Y-1.0.0"]), ("1.0.0", &["x-Y-1.0.0"])]),
            test_pkg("b-B", &[("1.0.0", &["x-Y-1.0.0", "z-Z-1.0.0"])]),
        ]);
        assert_eq!(idx.dep_count(), 2);
        assert_eq!(idx.pkg("b-B").unwrap().versions[0].deps, vec!["x-Y-1.0.0", "z-Z-1.0.0"]);
        let a = idx.get("a-A").unwrap();
        assert_eq!(idx.dep(a.versions[1].deps[0]), "x-Y-1.0.0");
    }
```

- [ ] **Step 3: Tests laufen lassen, Fehlschlag prüfen**

Run: `cd src-tauri && cargo test --lib thunderstore::`
Expected: Kompilierfehler (`save_cache`-Signatur, `pkg`, `dep_count` fehlen) = RED

- [ ] **Step 4: `thunderstore.rs` umbauen**

`Pkg`, `Version`, `parse_raw`, `fetch`, `http_client`, `download_url`, `IndexStore` und `refresh` bleiben. Ersetzt wird alles von `struct SlimPkg` bis einschließlich `save_cache`, außerdem der Block in `refresh`, der den Index baut:

```rust
const CACHE_SCHEMA: u32 = 1;

/// Version mit internierten Abhängigkeiten (Index in `Index::deps`).
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct IVersion {
    pub v: String,
    pub deps: Vec<u32>,
    pub size: u64,
    pub date: i64,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct IPkg {
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
    pub versions: Vec<IVersion>,
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
    deps: Vec<String>,
    by_id: HashMap<String, IPkg>,
    pub slim_json: Vec<u8>,
}

impl Index {
    pub fn get(&self, id: &str) -> Option<&IPkg> {
        self.by_id.get(id)
    }

    pub fn dep(&self, i: u32) -> &str {
        &self.deps[i as usize]
    }

    pub fn dep_count(&self) -> usize {
        self.deps.len()
    }

    /// Paket mit ausgeschriebenen Abhängigkeiten (für das Frontend).
    pub fn pkg(&self, id: &str) -> Option<Pkg> {
        let p = self.get(id)?;
        Some(Pkg {
            id: p.id.clone(),
            ns: p.ns.clone(),
            name: p.name.clone(),
            desc: p.desc.clone(),
            icon: p.icon.clone(),
            cats: p.cats.clone(),
            rating: p.rating,
            dl: p.dl,
            upd: p.upd,
            created: p.created,
            dep: p.dep,
            nsfw: p.nsfw,
            pinned: p.pinned,
            url: p.url.clone(),
            web: p.web.clone(),
            versions: p
                .versions
                .iter()
                .map(|v| Version { v: v.v.clone(), deps: v.deps.iter().map(|&i| self.dep(i).to_string()).collect(), size: v.size, date: v.date })
                .collect(),
        })
    }
}

fn intern(table: &mut HashMap<String, u32>, deps: &mut Vec<String>, d: String) -> u32 {
    if let Some(&i) = table.get(&d) {
        return i;
    }
    let i = deps.len() as u32;
    table.insert(d.clone(), i);
    deps.push(d);
    i
}

/// Baut den Index aus der API-Form; jede Abhängigkeits-Zeichenkette wird genau einmal gespeichert.
pub fn build(fetched_at: i64, pkgs: Vec<Pkg>) -> Index {
    let mut table = HashMap::new();
    let mut deps = Vec::new();
    let ipkgs = pkgs
        .into_iter()
        .map(|p| IPkg {
            versions: p
                .versions
                .into_iter()
                .map(|v| IVersion {
                    deps: v.deps.into_iter().map(|d| intern(&mut table, &mut deps, d)).collect(),
                    v: v.v,
                    size: v.size,
                    date: v.date,
                })
                .collect(),
            id: p.id,
            ns: p.ns,
            name: p.name,
            desc: p.desc,
            icon: p.icon,
            cats: p.cats,
            rating: p.rating,
            dl: p.dl,
            upd: p.upd,
            created: p.created,
            dep: p.dep,
            nsfw: p.nsfw,
            pinned: p.pinned,
            url: p.url,
            web: p.web,
        })
        .collect();
    from_parts(fetched_at, deps, ipkgs)
}

fn from_parts(fetched_at: i64, deps: Vec<String>, pkgs: Vec<IPkg>) -> Index {
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
    Index { fetched_at, deps, by_id, slim_json }
}

#[derive(Serialize)]
struct CacheRef<'a> {
    schema: u32,
    fetched_at: i64,
    deps: &'a [String],
    pkgs: Vec<&'a IPkg>,
}

#[derive(Deserialize)]
struct CacheOwned {
    schema: u32,
    fetched_at: i64,
    deps: Vec<String>,
    pkgs: Vec<IPkg>,
}

pub fn load_cache(path: &Path) -> Option<Index> {
    let bytes = std::fs::read(path).ok()?;
    let c: CacheOwned = postcard::from_bytes(&bytes).ok()?;
    (c.schema == CACHE_SCHEMA).then(|| from_parts(c.fetched_at, c.deps, c.pkgs))
}

pub fn save_cache(path: &Path, idx: &Index) -> Result<()> {
    let data = CacheRef { schema: CACHE_SCHEMA, fetched_at: idx.fetched_at, deps: &idx.deps, pkgs: idx.by_id.values().collect() };
    let bytes = postcard::to_allocvec(&data).map_err(|e| AppError::Invalid(format!("Index-Cache: {e}")))?;
    write_atomic(path, &bytes)
}
```

In `refresh` wird der `spawn_blocking`-Block ersetzt:

```rust
            let idx = tokio::task::spawn_blocking(move || {
                let idx = build(at, pkgs);
                let _ = save_cache(&cache, &idx);
                idx
            })
            .await
            .map_err(|e| AppError::Invalid(e.to_string()))?;
```

- [ ] **Step 5: Resolver auf `&Index` umstellen**

In `resolver.rs`:

- `use crate::models::{Installed, Pkg, …}` → `Pkg` entfernen, `use crate::thunderstore::Index;` ergänzen.
- `struct Resolver<'a> { by_id: &'a HashMap<String, Pkg>, … }` → `index: &'a Index`.
- In `visit`:
  - `let by_id = self.by_id; let Some(pkg) = by_id.get(&id)` → `let index = self.index; let Some(pkg) = index.get(&id)`.
  - Die Abhängigkeitsschleife wird ersetzt:

```rust
        let deps: Vec<u32> = pkg.versions.iter().find(|v| v.v == want).map(|v| v.deps.clone()).unwrap_or_default();
        for d in deps {
            if let Some(f) = parse_full_name(index.dep(d)) {
                self.visit(&f.ns, &f.name, &f.version, Some(&id));
            }
        }
```

- `pub fn plan(mods: &[ProfileMod], index: &Index, installed: &Installed) -> Plan`: `Resolver { index, … }`; `by_id.get(BEPINEX_PACK_ID)` → `index.get(BEPINEX_PACK_ID)`.
- `pub fn updates(mods: &[ProfileMod], index: &Index)`: `by_id.get(&m.id())` → `index.get(&m.id())`.
- `use std::collections::{BTreeMap, HashMap}` → `use std::collections::BTreeMap`.
- Im Test-Helfer `index()` wird der Rückgabetyp zu `crate::thunderstore::Index` und der Körper zu `crate::thunderstore::build(0, all)` (`all` = pkgs plus BepInExPack). Die Test-Imports werden entsprechend angepasst (`HashMap` entfällt).

- [ ] **Step 6: Aufrufstellen anpassen**

`paths.rs`:

```rust
    pub fn index_cache(&self) -> PathBuf {
        self.root.join("cache").join("index.bin")
    }
    pub fn legacy_index_cache(&self) -> PathBuf {
        self.root.join("cache").join("index.json")
    }
```

`sync.rs`:

- `resolver::plan(&profile.mods, &index.by_id, &installed)` → `resolver::plan(&profile.mods, &index, &installed)`.
- Im Download-Stream: `let pkg = index.by_id.get(&id).cloned();` → `let pkg = index.get(&id).map(|p| (p.ns.clone(), p.name.clone()));`
- `Some(p) => download(&client, &download_url(&p.ns, &p.name, &version), &dest)` → `Some((ns, name)) => download(&client, &download_url(&ns, &name, &version), &dest)`.

`commands.rs`:

- In `build_state`: `resolver::plan(&mods, &i.by_id, &installed)` → `resolver::plan(&mods, &i, &installed)` und `resolver::updates(&mods, &i.by_id)` → `resolver::updates(&mods, &i)`.
- `get_package`: `idx.by_id.get(&id).cloned()` → `idx.pkg(&id)`.
- `index_worker` beginnt mit `let _ = std::fs::remove_file(ctx.paths.legacy_index_cache());`.

- [ ] **Step 7: Tests, Lints**

Run: `cd src-tauri && cargo clippy --all-targets -- -D warnings && cargo test --lib`
Expected: alles PASS (56 Tests, 1 ignored)

- [ ] **Step 8: Commit**

```bash
git add src-tauri
git commit -m "perf(index): intern dependency strings and cache index as postcard"
```

---

### Task 2: Inhaltsadressierter Store

**Files:**

- Modify: `src-tauri/Cargo.toml` (+ `blake3`)
- Modify: `src-tauri/src/install.rs` (`plan_archive` herauslösen)
- Create: `src-tauri/src/store.rs`
- Modify: `src-tauri/src/paths.rs` (`store_dir`), `src-tauri/src/lib.rs` (`mod store;`)

**Interfaces:**

- Consumes: `install::{map_target, detect_layout, zip_entry_parts}` (intern), `util::{safe_join, with_old, read_json, write_json, write_atomic}`
- Produces:
  - `install::plan_archive<R: Read + Seek>(&mut ZipArchive<R>, &str id) -> Result<Vec<(String, usize)>>`, sortiert nach Zielpfad
  - `store::{hash_file(&Path) -> Result<String>, hash_bytes(&[u8]) -> String}`
  - `store::RecipeFile{path, hash, size}`, `store::Recipe{schema, zip, files}` mit `linked_bytes() -> u64`
  - `store::StoreStats{objects: u64, bytes: u64}`
  - `store::Store` (Clone) mit `new(PathBuf)`, `object_path(&str)`, `recipe(&str id, &str zip) -> Option<Recipe>`, `ingest_zip(&Path, &str hash, &str id) -> Result<Recipe>`, `ingest_file(&Path, &str hash, &str id) -> Result<Recipe>`, `materialize(&Recipe, &Path) -> Result<Vec<String>>`, `verify(&Recipe) -> Vec<String>`, `invalidate(&str id, &Recipe) -> Result<usize>`, `gc(&HashSet<(String, String)>) -> Result<u64>`, `stats() -> StoreStats`
  - `Paths::store_dir()`

- [ ] **Step 1: Abhängigkeit, Pfad, `plan_archive`**

`Cargo.toml`: `blake3 = "1"`. `paths.rs`:

```rust
    pub fn store_dir(&self) -> PathBuf {
        self.root.join("store")
    }
```

In `Paths::ensure` wird `std::fs::create_dir_all(self.store_dir())?;` ergänzt.

In `install.rs` den Import um `use std::io::{Read, Seek};` und `use zip::ZipArchive;` erweitern. Den Anfang von `extract_zip` bis einschließlich der Schleife ersetzen durch einen Aufruf von `plan_archive`:

```rust
/// Zielpfade (relativ zum Profil, `/`-getrennt) und Zip-Eintragsindex jeder zu
/// installierenden Datei, sortiert nach Zielpfad. Lehnt unsichere Pfade ab.
pub fn plan_archive<R: Read + Seek>(archive: &mut ZipArchive<R>, id: &str) -> Result<Vec<(String, usize)>> {
    let mut entries = vec![];
    for i in 0..archive.len() {
        let e = archive.by_index(i)?;
        let parts = zip_entry_parts(e.name()).ok_or_else(|| AppError::Invalid(format!("Unsicherer Pfad in {id}: {}", e.name())))?;
        if !parts.is_empty() {
            entries.push((i, parts, e.is_dir()));
        }
    }
    let layout = detect_layout(&entries);
    let mut out: Vec<(String, usize)> = entries
        .iter()
        .filter(|(_, _, is_dir)| !is_dir)
        .filter_map(|(i, parts, _)| map_target(&layout, parts, id).map(|t| (t.join("/"), *i)))
        .collect();
    out.sort();
    out.dedup_by(|a, b| a.0 == b.0);
    Ok(out)
}

pub fn extract_zip(zip_path: &Path, profile_dir: &Path, id: &str) -> Result<Vec<String>> {
    let mut archive = zip::ZipArchive::new(BufReader::new(File::open(zip_path)?))?;
    let plan = plan_archive(&mut archive, id)?;
    let mut written = vec![];
    for (rel, i) in plan {
        let dest = safe_join(profile_dir, &rel)?;
        let is_config = rel.starts_with(CONFIG_PREFIX);
        if is_config && dest.exists() {
            continue; // Nutzer-Configs nie überschreiben
        }
        if let Some(parent) = dest.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let mut entry = archive.by_index(i)?;
        let mut out = File::create(&dest)?;
        std::io::copy(&mut entry, &mut out)?;
        if !is_config {
            written.push(rel);
        }
    }
    Ok(written)
}
```

Run: `cd src-tauri && cargo test --lib install::`
Expected: 8 PASS. Das Verhalten ist unverändert, weil die Ausgabe wie bisher sortiert und ohne Duplikate ist.

- [ ] **Step 2: Failing Tests für `store.rs` schreiben**

`src-tauri/src/store.rs` wird mit den Signaturen aus „Interfaces“ als `todo!()`-Rümpfen angelegt, dazu `mod store;` in `lib.rs`. Die Tests:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::install::tests::make_zip;

    fn setup() -> (tempfile::TempDir, Store) {
        let d = tempfile::tempdir().unwrap();
        let s = Store::new(d.path().join("store"));
        (d, s)
    }

    fn ingest(s: &Store, zip: &Path, id: &str) -> Recipe {
        s.ingest_zip(zip, &hash_file(zip).unwrap(), id).unwrap()
    }

    #[test]
    fn ingest_is_idempotent_and_dedupes_identical_files() {
        let (d, s) = setup();
        let z1 = make_zip(d.path(), "a.zip", &[("A.dll", "same"), ("readme.txt", "a")]);
        let z2 = make_zip(d.path(), "b.zip", &[("B.dll", "same")]);
        let r1 = ingest(&s, &z1, "a-A");
        ingest(&s, &z2, "b-B");
        assert_eq!(s.stats().objects, 2);
        assert_eq!(r1.files[0].path, "BepInEx/plugins/a-A/A.dll");
        assert_eq!(ingest(&s, &z1, "a-A"), r1);
    }

    #[test]
    fn materialize_links_files_and_copies_configs() {
        let (d, s) = setup();
        let z = make_zip(d.path(), "m.zip", &[("plugins/A.dll", "dll"), ("config/a.cfg", "default")]);
        let r = ingest(&s, &z, "a-A");
        let (pa, pb) = (d.path().join("pa"), d.path().join("pb"));
        let files = s.materialize(&r, &pa).unwrap();
        s.materialize(&r, &pb).unwrap();
        assert_eq!(files, vec!["BepInEx/plugins/A.dll"]);
        assert_eq!(std::fs::read_to_string(pb.join("BepInEx/plugins/A.dll")).unwrap(), "dll");
        std::fs::write(pa.join("BepInEx/config/a.cfg"), "mine").unwrap();
        assert_eq!(std::fs::read_to_string(pb.join("BepInEx/config/a.cfg")).unwrap(), "default");
        s.materialize(&r, &pa).unwrap();
        assert_eq!(std::fs::read_to_string(pa.join("BepInEx/config/a.cfg")).unwrap(), "mine");
        assert!(s.verify(&r).is_empty(), "Config-Objekt darf nicht verändert sein");
    }

    #[test]
    fn verify_and_invalidate_restore_tampered_objects() {
        let (d, s) = setup();
        let z = make_zip(d.path(), "m.zip", &[("A.dll", "good")]);
        let r = ingest(&s, &z, "a-A");
        let p = d.path().join("p");
        s.materialize(&r, &p).unwrap();
        std::fs::write(p.join("BepInEx/plugins/a-A/A.dll"), "evil").unwrap();
        assert_eq!(s.verify(&r).len(), 1, "Hardlink: Schreiben im Profil ändert das Objekt");
        assert_eq!(s.invalidate("a-A", &r).unwrap(), 1);
        let r2 = ingest(&s, &z, "a-A");
        assert!(s.verify(&r2).is_empty());
        s.materialize(&r2, &p).unwrap();
        assert_eq!(std::fs::read_to_string(p.join("BepInEx/plugins/a-A/A.dll")).unwrap(), "good");
    }

    #[test]
    fn gc_removes_only_unreferenced() {
        let (d, s) = setup();
        let za = make_zip(d.path(), "a.zip", &[("A.dll", "a")]);
        let zb = make_zip(d.path(), "b.zip", &[("B.dll", "b")]);
        let ra = ingest(&s, &za, "a-A");
        let rb = ingest(&s, &zb, "b-B");
        let keep = HashSet::from([("a-A".to_string(), ra.zip.clone())]);
        assert_eq!(s.gc(&keep).unwrap(), 1);
        assert!(s.recipe("a-A", &ra.zip).is_some());
        assert!(s.recipe("b-B", &rb.zip).is_none());
        assert!(s.verify(&ra).is_empty());
        assert_eq!(s.stats().objects, 1);
    }

    #[test]
    fn ingests_single_dll() {
        let (d, s) = setup();
        let f = d.path().join("My Plugin.dll");
        std::fs::write(&f, "x").unwrap();
        let r = s.ingest_file(&f, &hash_file(&f).unwrap(), "local-My").unwrap();
        assert_eq!(r.files[0].path, "BepInEx/plugins/local-My/My Plugin.dll");
        assert_eq!(r.linked_bytes(), 1);
    }

    #[test]
    fn rejects_zip_slip() {
        let (d, s) = setup();
        let z = make_zip(d.path(), "m.zip", &[("../evil.dll", "x")]);
        assert!(s.ingest_zip(&z, &hash_file(&z).unwrap(), "a-A").is_err());
    }
}
```

- [ ] **Step 3: RED prüfen**

Run: `cd src-tauri && cargo test --lib store::`
Expected: 6 FAILED (`not yet implemented`)

- [ ] **Step 4: `store.rs` implementieren (oberhalb der Tests)**

```rust
//! Inhaltsadressierter Speicher: Jede entpackte Mod-Datei liegt genau einmal unter
//! `store/objects/<ab>/<blake3>`. Profile verlinken sie per Hardlink; Configs werden
//! kopiert, weil sie pro Profil verändert werden.
use crate::error::{AppError, Result};
use crate::install::plan_archive;
use crate::util::{read_json, safe_join, with_old, write_atomic, write_json};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs::File;
use std::io::{BufReader, Read};
use std::path::{Path, PathBuf};

const RECIPE_SCHEMA: u32 = 1;
const CONFIG_PREFIX: &str = "BepInEx/config/";

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct RecipeFile {
    pub path: String,
    pub hash: String,
    pub size: u64,
}

/// Welche Datei eines Pakets (identifiziert über den Hash seines Zips) wohin gehört.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Recipe {
    pub schema: u32,
    pub zip: String,
    pub files: Vec<RecipeFile>,
}

impl Recipe {
    /// Größe der verlinkten Dateien (ohne Configs).
    pub fn linked_bytes(&self) -> u64 {
        self.files.iter().filter(|f| !f.path.starts_with(CONFIG_PREFIX)).map(|f| f.size).sum()
    }
}

#[derive(Serialize, Clone, Debug, PartialEq, Default)]
pub struct StoreStats {
    pub objects: u64,
    pub bytes: u64,
}

pub fn hash_bytes(bytes: &[u8]) -> String {
    blake3::hash(bytes).to_hex().to_string()
}

pub fn hash_file(path: &Path) -> Result<String> {
    let mut hasher = blake3::Hasher::new();
    std::io::copy(&mut BufReader::new(File::open(path)?), &mut hasher)?;
    Ok(hasher.finalize().to_hex().to_string())
}

fn children(dir: &Path) -> Vec<PathBuf> {
    std::fs::read_dir(dir).map(|rd| rd.flatten().map(|e| e.path()).collect()).unwrap_or_default()
}

fn file_name(p: &Path) -> String {
    p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default()
}

#[derive(Clone, Debug)]
pub struct Store {
    root: PathBuf,
}

impl Store {
    pub fn new(root: PathBuf) -> Self {
        Store { root }
    }

    fn objects(&self) -> PathBuf {
        self.root.join("objects")
    }

    pub fn object_path(&self, hash: &str) -> PathBuf {
        self.objects().join(&hash[..2]).join(hash)
    }

    fn recipe_path(&self, id: &str, zip: &str) -> PathBuf {
        self.root.join("recipes").join(id).join(format!("{zip}.json"))
    }

    pub fn recipe(&self, id: &str, zip: &str) -> Option<Recipe> {
        read_json(&self.recipe_path(id, zip)).ok().flatten()
    }

    fn put_object(&self, bytes: &[u8]) -> Result<String> {
        let hash = hash_bytes(bytes);
        let p = self.object_path(&hash);
        if !p.exists() {
            write_atomic(&p, bytes)?;
        }
        Ok(hash)
    }

    fn cached(&self, id: &str, zip: &str) -> Option<Recipe> {
        self.recipe(id, zip).filter(|r| r.files.iter().all(|f| self.object_path(&f.hash).is_file()))
    }

    fn save_recipe(&self, id: &str, zip: &str, files: Vec<RecipeFile>) -> Result<Recipe> {
        let r = Recipe { schema: RECIPE_SCHEMA, zip: zip.to_string(), files };
        write_json(&self.recipe_path(id, zip), &r)?;
        Ok(r)
    }

    /// Entpackt eine Paket-Zip in den Store (idempotent) und liefert ihre Recipe.
    pub fn ingest_zip(&self, zip: &Path, zip_hash: &str, id: &str) -> Result<Recipe> {
        if let Some(r) = self.cached(id, zip_hash) {
            return Ok(r);
        }
        let mut archive = zip::ZipArchive::new(BufReader::new(File::open(zip)?))?;
        let plan = plan_archive(&mut archive, id)?;
        let mut files = Vec::with_capacity(plan.len());
        for (path, i) in plan {
            let mut entry = archive.by_index(i)?;
            let mut buf = Vec::with_capacity(entry.size() as usize);
            entry.read_to_end(&mut buf)?;
            let hash = self.put_object(&buf)?;
            files.push(RecipeFile { path, hash, size: buf.len() as u64 });
        }
        self.save_recipe(id, zip_hash, files)
    }

    /// Einzelne Datei (lokale `.dll`) → `BepInEx/plugins/<id>/<Dateiname>`.
    pub fn ingest_file(&self, file: &Path, file_hash: &str, id: &str) -> Result<Recipe> {
        if let Some(r) = self.cached(id, file_hash) {
            return Ok(r);
        }
        let name = file.file_name().map(|n| n.to_string_lossy().to_string()).ok_or_else(|| AppError::Invalid("Dateiname fehlt.".into()))?;
        let bytes = std::fs::read(file)?;
        let hash = self.put_object(&bytes)?;
        let files = vec![RecipeFile { path: format!("BepInEx/plugins/{id}/{name}"), hash, size: bytes.len() as u64 }];
        self.save_recipe(id, file_hash, files)
    }

    /// Verlinkt die Dateien der Recipe ins Profil (Kopie als Fallback). Configs werden
    /// nur kopiert, wenn sie fehlen, und nicht zurückgegeben – sie gehören dem Profil.
    pub fn materialize(&self, r: &Recipe, profile_dir: &Path) -> Result<Vec<String>> {
        let mut linked = vec![];
        for f in &r.files {
            let dest = safe_join(profile_dir, &f.path)?;
            let obj = self.object_path(&f.hash);
            if let Some(parent) = dest.parent() {
                std::fs::create_dir_all(parent)?;
            }
            if f.path.starts_with(CONFIG_PREFIX) {
                if !dest.exists() {
                    std::fs::copy(&obj, &dest)?;
                }
                continue;
            }
            for p in [dest.clone(), with_old(&dest)] {
                if p.exists() {
                    std::fs::remove_file(&p)?;
                }
            }
            if std::fs::hard_link(&obj, &dest).is_err() {
                std::fs::copy(&obj, &dest)?;
            }
            linked.push(f.path.clone());
        }
        linked.sort();
        linked.dedup();
        Ok(linked)
    }

    /// Hashes der Objekte, die fehlen oder deren Inhalt nicht mehr passt.
    pub fn verify(&self, r: &Recipe) -> Vec<String> {
        r.files
            .iter()
            .filter(|f| hash_file(&self.object_path(&f.hash)).map(|h| h != f.hash).unwrap_or(true))
            .map(|f| f.hash.clone())
            .collect()
    }

    /// Entfernt beschädigte Objekte und die Recipe, damit ein erneutes `ingest_*`
    /// sie frisch schreibt. Liefert die Zahl der beschädigten Objekte.
    pub fn invalidate(&self, id: &str, r: &Recipe) -> Result<usize> {
        let bad = self.verify(r);
        for h in &bad {
            let p = self.object_path(h);
            if p.exists() {
                std::fs::remove_file(p)?;
            }
        }
        let rp = self.recipe_path(id, &r.zip);
        if rp.exists() {
            std::fs::remove_file(rp)?;
        }
        Ok(bad.len())
    }

    /// Löscht Recipes außerhalb von `keep` (Paar aus Paket-ID und Zip-Hash) sowie alle
    /// Objekte, auf die keine verbleibende Recipe verweist. Liefert freigegebene Bytes.
    pub fn gc(&self, keep: &HashSet<(String, String)>) -> Result<u64> {
        let mut referenced = HashSet::new();
        for id_dir in children(&self.root.join("recipes")) {
            let id = file_name(&id_dir);
            for rf in children(&id_dir) {
                let zip = rf.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
                if keep.contains(&(id.clone(), zip)) {
                    if let Ok(Some(r)) = read_json::<Recipe>(&rf) {
                        referenced.extend(r.files.into_iter().map(|f| f.hash));
                    }
                } else {
                    std::fs::remove_file(&rf)?;
                }
            }
            let _ = std::fs::remove_dir(&id_dir); // nur wenn leer
        }
        let mut freed = 0;
        for bucket in children(&self.objects()) {
            for obj in children(&bucket) {
                if !referenced.contains(&file_name(&obj)) {
                    freed += obj.metadata().map(|m| m.len()).unwrap_or(0);
                    std::fs::remove_file(&obj)?;
                }
            }
            let _ = std::fs::remove_dir(&bucket);
        }
        Ok(freed)
    }

    pub fn stats(&self) -> StoreStats {
        let mut s = StoreStats::default();
        for bucket in children(&self.objects()) {
            for obj in children(&bucket) {
                s.objects += 1;
                s.bytes += obj.metadata().map(|m| m.len()).unwrap_or(0);
            }
        }
        s
    }
}
```

- [ ] **Step 5: GREEN und Gate**

Run: `cd src-tauri && cargo clippy --all-targets -- -D warnings && cargo test --lib`
Expected: alles PASS (62 Tests, 1 ignored). Clippy meldet `store` gegebenenfalls als ungenutzt (`dead_code`). In dem Fall bekommt `mod store;` in `lib.rs` für diesen Task `#[allow(dead_code)]`; das entfällt in Task 4.

- [ ] **Step 6: Commit**

```bash
git add src-tauri
git commit -m "feat(store): content-addressed object store with hardlink materialization"
```

---
