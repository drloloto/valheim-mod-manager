# Lokaler Valheim Mod Manager (r2modman-Ersatz) — Design

Datum: 2026-09-26
Status: Entwurf zur Freigabe

## 1. Ziel

`modmanager-client` wird ein eigenständiger Desktop-Mod-Manager für das **lokale
Valheim-Spiel** (Steam, Windows). Er ersetzt r2modman: moderner, schneller,
flexibler, mit mehr Funktionen. Die App enthält die gesamte Logik; es wird kein
Server, Docker-Container oder Sidecar benötigt. Tauri starten reicht.

Die bestehende Server-Lösung (`../webapp`, `../docker-compose.yaml`) bleibt
unangetastet und ist nicht mehr Teil dieses Repos.

### Erfolgskriterien

- `npm run tauri dev` startet die App. Valheim wird automatisch gefunden.
- Ein Profil anlegen, einen Mod hinzufügen, „Spielen“ drücken: Valheim startet
  mit BepInEx und dem Mod, ohne dass etwas von Hand in den Spielordner
  kopiert werden muss.
- Suche und Bedienung fühlen sich mindestens so schnell an wie der bisherige
  Client.
- Ein in r2modman / Thunderstore Mod Manager geteilter Profil-Code lässt sich
  importieren, und ein hier exportierter Code lässt sich in r2modman
  importieren.

### Umfang v1

Parität mit dem bisherigen Client (Suche mit Facetten, Paketdetails, Profile,
Mods hinzufügen/entfernen/Version wählen/updaten, Abhängigkeitsauflösung,
r2modman-Code-Import, Config-Editor) **plus**:

1. Spiel starten (modded / vanilla)
2. Mods einzeln aktivieren/deaktivieren
3. Profil teilen (Export als Code und als `.r2z`-Datei; Import auch aus `.r2z`)
4. Lokale Mods (Zip/DLL) installieren und BepInEx-Log anzeigen
5. Profil klonen/umbenennen, Profilordner öffnen, Profil reparieren

### Nicht in v1

Linux/macOS, andere Spiele, Mod-Konfliktanalyse, Auto-Update der App, E2E-Tests.

## 2. Architektur

```
┌──────────────── SvelteKit SPA (Webview) ────────────────┐
│ routes/  ── store.svelte.ts ── api/client.ts (invoke)   │
│ In-Memory-Suche über SlimPkg[]                          │
└───────────────▲──────────────────────┬──────────────────┘
      Events    │                      │ invoke()
┌───────────────┴──────────────────────▼──────────────────┐
│ Rust-Kern (src-tauri/src)                               │
│ commands ─┬─ profiles ── install ── resolver            │
│           ├─ thunderstore (Index, RAM + Disk-Cache)     │
│           ├─ share (r2x/r2z, Legacyprofile-API)         │
│           ├─ config (.cfg)   ├─ logs   ├─ game          │
│           └─ settings / paths                           │
└─────────────────────────────────────────────────────────┘
```

Entscheidungen:

- **Logik in Rust** (Tauri 2 Commands). Begründung: Zip, Dateisystem und
  parallele Downloads laufen außerhalb des Webviews, die UI bleibt flüssig,
  und das Frontend braucht keine breiten FS-Berechtigungen.
- **Installationsmodell: Profil-Ordner + Doorstop.** Jedes Profil enthält ein
  vollständiges BepInEx. Der Spielordner bekommt nur die Doorstop-Dateien. Das
  aktive Profil wird per Kommandozeile beim Start gewählt.
- **Frontend: SvelteKit** mit `@sveltejs/adapter-static` im SPA-Modus
  (`ssr = false`, `prerender = false`, `fallback: "index.html"`). Die
  vorhandenen shadcn-svelte-Komponenten werden übernommen.

## 3. Rust-Module

| Modul             | Verantwortung                                                                               | Abhängig von           |
| ----------------- | ------------------------------------------------------------------------------------------- | ---------------------- |
| `error.rs`        | `AppError` (thiserror), serialisiert als `{ kind, message }`                                | –                      |
| `paths.rs`        | App-Datenordner, Profil-/Cache-Pfade, `ensure_dirs`                                         | Tauri `path()`         |
| `util.rs`         | `cmp_version`, `parse_full_name`, atomisches JSON-Schreiben, `safe_join`                    | –                      |
| `settings.rs`     | `settings.json` laden/speichern mit Defaults                                                | paths                  |
| `game.rs`         | Steam/Valheim finden, Doorstop-Version erkennen, Doorstop-Dateien abgleichen, Spiel starten | settings               |
| `thunderstore.rs` | Index holen, kompaktieren, RAM + Disk-Cache, TTL, Hintergrund-Refresh                       | paths                  |
| `resolver.rs`     | Reine Funktion: Mods + Index + installed → `Plan`                                           | util                   |
| `install.rs`      | Download-Pool, Zip-Cache, Extraktion, Entfernen, Enable/Disable-Umbenennung                 | paths, util            |
| `sync.rs`         | Sync-Job: Serialisierung, Nachschieben, Fortschritts-Events                                 | resolver, install      |
| `profiles.rs`     | Profil-CRUD, `profile.json`, `installed.json`, aktives Profil                               | paths, util            |
| `share.rs`        | r2x-YAML, r2z-Zip, Import/Export per Code und Datei                                         | profiles, config-Pfade |
| `config.rs`       | `.cfg` auflisten, parsen, Änderungen schreiben                                              | util                   |
| `logs.rs`         | `LogOutput.log` lesen und per Polling verfolgen                                             | paths                  |
| `commands.rs`     | `#[tauri::command]`-Fassade, baut `AppState`                                                | alle                   |
| `lib.rs`          | App-Setup, State registrieren, Plugins, Hintergrund-Tasks                                   | –                      |

Gemeinsamer Zustand (`tauri::State<AppCtx>`):

```rust
struct AppCtx {
    paths: Paths,
    settings: RwLock<Settings>,
    index: RwLock<Option<Arc<Index>>>,     // byId + vorgerendertes Slim-JSON
    sync: SyncHandle,                       // Mutex + "dirty"-Flag
    log_tail: Mutex<Option<JoinHandle>>,
}
```

Crates (Richtwert): `tokio`, `reqwest` (rustls, gzip, stream),
`serde`/`serde_json`, `serde_yaml`, `zip`, `base64`, `thiserror`, `winreg`,
`keyvalues-parser` (VDF), `futures`, `tempfile` (dev).
Tauri-Plugins: `opener` (vorhanden), `dialog`, `clipboard-manager`.

## 4. Datenablage

Wurzel: Tauri `app_data_dir()` → `%APPDATA%\io.github.drloloto.valheim-mod-manager\`.

```
settings.json
active.txt
cache/index.json                   kompaktierter Index { fetchedAt, pkgs }
cache/downloads/<id>-<ver>.zip     profilübergreifend geteilt
profiles/<Name>/
  profile.json                     { name, mods: ProfileMod[] }
  installed.json                   { <id>: { version, files: string[] } }
  local/                           Originaldateien lokaler Mods
  doorstop/                        winhttp.dll, doorstop_config.ini, doorstop_libs/ aus dem BepInExPack
  BepInEx/                         core, plugins, patchers, config, LogOutput.log
  unstripped_corlib/               falls vom BepInExPack geliefert
```

`files` in `installed.json` sind relativ zum Profilordner.

`ProfileMod`:

```ts
{ namespace: string; name: string; version: string; enabled: boolean; source: "thunderstore" | "local"; deps?: string[] }
```

`deps` wird nur für lokale Mods gesetzt (aus deren `manifest.json` beim Hinzufügen
übernommen), damit der Resolver ohne Datei-I/O auskommt.

Alte `profile.json` ohne `enabled`/`source` werden als `true`/`"thunderstore"`
gelesen (serde defaults).

`Settings`:

```ts
{
	valheimDir: string | null;
	steamExe: string | null;
	downloadConcurrency: number; /*4*/
	indexTtlMinutes: number; /*30*/
	showNsfw: boolean; /*false*/
}
```

## 5. Abläufe

### 5.1 Index

- Beim Start: Disk-Cache laden (falls vorhanden), sofort nutzbar. Ist er älter
  als die TTL oder fehlt er: Refresh im Hintergrund. Danach periodisch alle
  TTL-Minuten. Nach einem Fehlschlag 5 Minuten Pause (wie bisher).
- `GET https://thunderstore.io/c/valheim/api/v1/package/` → kompaktieren (Port
  von `compact`) → `Index { fetched_at, by_id: HashMap<String, Pkg>, slim_json: Vec<u8> }`.
- An das Frontend geht `slim_json` als rohe Bytes (`tauri::ipc::Response`), also
  ohne erneutes Serialisieren. `get_index(since)` liefert `null`, wenn
  `since == fetched_at` (ersetzt das ETag).
- Nach einem erfolgreichen Refresh wird das Event `index://updated` gesendet.

### 5.2 Resolver (rein)

Port von `planProfile` mit zwei Änderungen:

- `BepInExPack_Valheim` wird **nicht** mehr übersprungen. Enthält das Profil
  mindestens einen Mod, wird `denikson-BepInExPack_Valheim` (neueste Version)
  automatisch als Wurzel ergänzt, falls kein Mod ihn schon mitbringt.
- Mods mit `source: "local"` werden nicht im Index gesucht. Ihre
  Abhängigkeiten stehen in `ProfileMod.deps` und werden normal aus dem Index
  aufgelöst.

Deaktivierte Mods werden trotzdem aufgelöst; ihre Abhängigkeiten bleiben
installiert. Zyklen enden, weil ein bereits aufgelöster Eintrag mit gleicher
oder neuerer Version nicht erneut besucht wird.

Ausgabe:

```ts
Plan { resolved: Record<id, { version, requiredBy: string[] }>, toInstall: { id, from?, to }[], toRemove: string[], errors: string[] }
```

Zusätzlich im `AppState`: `updates: Record<id, latestVersion>` für explizite
Mods mit neuerer Version im Index.

### 5.3 Sync

Auslöser: jede Änderung an der Mod-Liste (`set_mods`, Import, lokaler Mod) und
`repair_profile`. Ablauf pro Profil:

1. Plan berechnen (bei `repair` gilt jede aufgelöste Mod als „zu installieren“).
2. Fehlende Zips parallel laden (`downloadConcurrency`, Standard 4). Fortschritt
   pro Paket als Event.
3. `toRemove`: Dateien löschen, leere Ordner aufräumen (nicht über den
   Profilordner hinaus).
4. `toInstall` nacheinander: alte Version entfernen, Zip extrahieren (5.4),
   Dateiliste speichern. Ist der Mod deaktiviert: sofort umbenennen (5.5).
5. `installed.json` atomar schreiben. Event `sync://done` mit
   `{ installed, removed, errors }`.

Nebenläufigkeit: ein Mutex, immer nur ein Sync gleichzeitig. Kommt während
eines Syncs eine weitere Anfrage, wird ein `dirty`-Flag gesetzt; nach Ende
läuft genau ein weiterer Sync. Commands warten **nicht** auf den Sync; sie
geben sofort den neuen `AppState` mit `sync.running = true` zurück.

Fehlertoleranz wie bisher: Einzelfehler sammeln, den Rest fortsetzen.

### 5.4 Zip-Extraktion

Port von `extractZip`, Ziel ist `profiles/<Name>/BepInEx/`:

- Zip-Wurzel enthält `BepInEx/` → Inhalt direkt hineinmischen.
- Zip-Wurzel enthält `plugins/`, `patchers/`, `config/`, `core/` oder
  `monomod/` → jeweils hineinmischen; übrige Dateien nach
  `plugins/<id>/`.
- Sonst: alles außer `icon.png`, `manifest.json`, `README.md`, `CHANGELOG.md`
  nach `plugins/<id>/`.
- **Sonderfall BepInExPack:** Die Zip enthält `BepInExPack_Valheim/`. Daraus wird
  `BepInEx/` ins Profil-`BepInEx/` kopiert, `winhttp.dll`,
  `doorstop_config.ini` und `doorstop_libs/` nach `profiles/<Name>/doorstop/`,
  und `unstripped_corlib/` (falls vorhanden) nach `profiles/<Name>/`. Der genaue
  Aufbau des aktuellen Packs wird während der Umsetzung an der echten Zip
  geprüft und als Test-Fixture festgehalten.
- Einträge mit `..`, absoluten Pfaden oder Laufwerksbuchstaben werden abgelehnt
  (Zip-Slip).
- Die Extraktion erfolgt direkt aus der Zip ins Ziel, ohne Temp-Ordner.

### 5.5 Mod aktivieren/deaktivieren

`set_mod_enabled(profile, id, enabled)` setzt das Flag in `profile.json` und
benennt alle Dateien des Mods aus `installed.json` um, die **nicht** unter
`BepInEx/config/` liegen: `x` ↔ `x.old`. `installed.json` speichert immer die
Originalnamen; die Umbenennung wird aus `enabled` abgeleitet. Kein Sync nötig.
Der Command nimmt denselben Mutex wie der Sync und wartet daher ggf. auf dessen
Ende. Ist der Mod noch nicht installiert, wird nur das Flag gesetzt (der Sync
berücksichtigt es beim Extrahieren).

### 5.6 Spiel starten

`launch_game(modded)`:

1. Valheim-Ordner aus den Settings, sonst automatisch erkennen:
   `HKCU\Software\Valve\Steam\SteamPath` → `steamapps/libraryfolders.vdf` →
   Bibliothek mit App `892970` → `steamapps/common/Valheim`. Fehlt er:
   `AppError::GameNotFound` (UI zeigt Link zu den Einstellungen).
2. Läuft ein Sync: auf dessen Ende warten.
3. `modded`: Doorstop-Dateien aus `profiles/<Name>/doorstop/` in den
   Valheim-Ordner kopieren, falls sie fehlen oder sich (Größe + Hash)
   unterscheiden. Fehlt `doorstop/` (Profil ohne BepInExPack): Fehler mit Hinweis.
4. Doorstop-Version aus `doorstop_config.ini` ableiten: Abschnitt
   `[UnityDoorstop]` → v3, `[General]` → v4.
5. Argumente:
   - v3 modded: `--doorstop-enable true --doorstop-target "<P>/BepInEx/core/BepInEx.Preloader.dll"`
     (+ `--mono-dll-search-path-override "<P>/unstripped_corlib"`, falls vorhanden)
   - v4 modded: `--doorstop-enabled true --doorstop-target-assembly "<P>/BepInEx/core/BepInEx.Preloader.dll"`
     (+ `--doorstop-mono-dll-search-path-override "<P>/unstripped_corlib"`, falls vorhanden)
   - vanilla: `--doorstop-enable false` (v3) bzw. `--doorstop-enabled false` (v4).
     Sind keine Doorstop-Dateien im Spielordner: keine Argumente.
6. Starten: `steam.exe -applaunch 892970 <args>`, losgelöst vom App-Prozess.

### 5.7 Teilen

Format (r2modman-kompatibel):

```yaml
profileName: <Name>
mods:
  - name: <Namespace>-<Name>
    version: { major: 1, minor: 2, patch: 3 }
    enabled: true
```

- `.r2z` = Zip mit `export.r2x` + `BepInEx/config/**`.
- **Export Code:** r2z-Bytes → `"#r2modman\n" + base64` → `POST https://thunderstore.io/api/experimental/legacyprofile/create/`
  (`Content-Type: application/octet-stream`) → Antwort `{ key }` → in die
  Zwischenablage kopieren und anzeigen.
- **Export Datei:** r2z über den Speichern-Dialog.
- **Import Code:** `GET …/legacyprofile/get/<code>/` → Präfix abschneiden → Base64 →
  r2z. **Import Datei:** r2z direkt lesen.
- Import legt ein **neues** Profil an (Name aus dem Dialog, sonst `profileName`,
  bei Kollision mit Suffix ` (2)`), übernimmt `enabled`, kopiert Configs mit
  Pfad-Schutz, aktiviert das Profil und startet den Sync.
- Lokale Mods werden nicht exportiert (r2modman kann sie ohnehin nicht
  auflösen). Der Export meldet, welche fehlen.

### 5.8 Lokale Mods

`add_local_mod(profile, path)`:

- **Zip mit `manifest.json`:** `name`, `version_number` und `dependencies` lesen,
  Namespace `local`, `dependencies` → `ProfileMod.deps`. Die Zip wird nach `local/<name>-<version>.zip` kopiert.
- **Zip ohne Manifest:** Name aus dem Dateinamen, Version `0.0.0`, keine
  Abhängigkeiten.
- **`.dll`:** wird nach `local/` kopiert und landet bei der Installation unter
  `BepInEx/plugins/<name>/`.
- Eintrag mit `source: "local"` in `profile.json`, dann Sync. Beim Sync
  kommen lokale Mods aus `local/` statt aus dem Download-Cache.

### 5.9 Log

- `read_log(profile)` → die letzten 2000 Zeilen von `BepInEx/LogOutput.log`.
- `start_log_tail` / `stop_log_tail`: Tokio-Task pollt alle 500 ms die
  Dateigröße und sendet neue Zeilen als Event `log://lines`. Wird die Datei
  kürzer (neuer Spielstart): von vorn lesen und `reset: true` senden.
- Die UI filtert nach Level (`[Error`, `[Warning`, `[Info`, `[Message`, `[Debug`)
  und Suchtext.

### 5.10 Configs

Port von `bepinexconfig.ts`, bezogen auf `profiles/<aktiv>/BepInEx/config/`.
Beim Schreiben bleiben CRLF-Zeilenenden erhalten. `safe_join` verhindert, dass
Pfade aus dem Config-Ordner herausführen.

## 6. Command-API

Alle Commands geben `Result<T, AppError>` zurück. Mutierende Profil-Commands
liefern den neuen `AppState`.

```ts
AppState {
  profiles: string[]; active: string | null;
  mods: ProfileMod[];
  installed: Record<string, string>;          // id -> version
  plan: Plan | null; updates: Record<string, string>;
  indexAge: number | null;
  sync: { running: boolean; queued: boolean };
  game: { valheimDir: string | null; found: boolean };
}
```

| Command                                                                             | Rückgabe                           |
| ----------------------------------------------------------------------------------- | ---------------------------------- |
| `get_state()`                                                                       | `AppState`                         |
| `get_index(since: number \| null)`                                                  | Slim-JSON-Bytes oder `null`        |
| `refresh_index()`                                                                   | `{ indexAge }`                     |
| `get_package(id)`                                                                   | `Pkg`                              |
| `create_profile(name)` / `delete_profile(name)` / `activate_profile(name)`          | `AppState`                         |
| `rename_profile(from, to)` / `clone_profile(from, to)`                              | `AppState`                         |
| `set_mods(profile, mods)`                                                           | `AppState` (startet Sync)          |
| `set_mod_enabled(profile, id, enabled)`                                             | `AppState`                         |
| `repair_profile(profile)`                                                           | `AppState` (startet Sync)          |
| `import_profile_code(code, name, withConfigs)`                                      | `AppState & { imported }`          |
| `import_profile_file(path, name, withConfigs)`                                      | `AppState & { imported }`          |
| `export_profile_code(profile)`                                                      | `{ code, skippedLocal: string[] }` |
| `export_profile_file(profile, path)`                                                | `{ skippedLocal: string[] }`       |
| `add_local_mod(profile, path)`                                                      | `AppState`                         |
| `launch_game(modded)`                                                               | `()`                               |
| `get_settings()` / `save_settings(s)`                                               | `Settings`                         |
| `detect_game()`                                                                     | `{ valheimDir, steamExe }`         |
| `list_config_files()` / `get_config_file(file)` / `save_config_file(file, changes)` | wie bisher                         |
| `read_log()` / `start_log_tail()` / `stop_log_tail()`                               | `string[]` / `()`                  |
| `open_folder(kind: "profile" \| "game" \| "config" \| "data")`                      | `()`                               |

Events: `sync://progress { id, phase, done, total }`,
`sync://done { installed, removed, errors }`, `index://updated { fetchedAt }`,
`log://lines { lines, reset }`.

## 7. Frontend

- `src/lib/api/client.ts`: gleiche Methodennamen wie bisher, intern
  `invoke()`. Der Index wird über `invoke<ArrayBuffer>` geholt und mit
  `TextDecoder` + `JSON.parse` gelesen.
- `src/lib/api/store.svelte.ts`: bleibt der zentrale Store. Die Server-URL-Logik
  und `connected` entfallen; Event-Listener für Sync, Index und Log kommen dazu.
- Routen:
  - `+layout.svelte`: Header mit Profilauswahl, „Spielen“ (Split-Button:
    Vanilla), Sync-Indikator, Navigation. Lädt beim Start State + Index.
  - `/`: Durchsuchen (bisher `ModsTab` + `PackageSheet`)
  - `/profile`: Installierte Mods mit An/Aus, Updates, Abhängigkeitsmarkierung,
    Drag & Drop für lokale Mods, Import/Export/Klonen/Umbenennen/Reparieren
  - `/config`: bisher `ConfigTab`
  - `/logs`: Log-Ansicht
  - `/settings`: Pfade, Parallelität, TTL, NSFW, Cache leeren
- Die UI-Komponenten in `src/lib/components/ui/` bleiben unverändert. Neue
  shadcn-Bausteine nur bei Bedarf (z. B. Dropdown-Menu für den Split-Button).

## 8. Fehlerbehandlung

- `AppError`-Varianten: `Io`, `Network`, `NotFound`, `Invalid`,
  `GameNotFound`, `Busy`. Meldungen auf Deutsch.
- Im Frontend wird daraus `ApiError(message)` → Toast. `GameNotFound` zeigt
  zusätzlich eine Aktion „Einstellungen öffnen“.
- Atomisches Schreiben (Temp-Datei + Umbenennen) für `profile.json`,
  `installed.json`, `settings.json` und den Index-Cache.
- Offline: Der Index kommt aus dem Cache. Downloads schlagen mit Meldung fehl,
  Spielen und Konfigurieren funktionieren weiterhin.

## 9. Tests

Rust (`cargo test`), ohne Netzwerk:

- `util`: `cmp_version`, `parse_full_name`, `safe_join`
- `resolver`: Kette, Diamant mit Versions-Upgrade, fehlendes Paket, Zyklus,
  automatisches BepInExPack, lokaler Mod mit Abhängigkeiten, deaktivierter Mod
- `config`: Parsen, Round-Trip mit CRLF, Pfad-Schutz
- `share`: r2x-YAML hin und zurück, r2z bauen/lesen, Base64-Präfix
- `install`: die vier Layouts (BepInEx-Root, Unterordner, Bare, BepInExPack)
  mit in `tempdir` erzeugten Zips; Zip-Slip wird abgelehnt; Enable/Disable-Umbenennung
- `game`: Doorstop-Versionserkennung und Argumentbau; VDF-Parsing mit Fixture

Frontend: `svelte-check` und `vite build` ohne Fehler.

Manueller Abnahmetest (Windows, echtes Valheim):
Valheim erkannt → Profil anlegen → einen Mod mit Abhängigkeit hinzufügen →
Sync fertig → Spielen (modded) → BepInEx-Log zeigt Laden des Mods →
Mod deaktivieren → Spielen → Mod lädt nicht → Vanilla-Start ohne BepInEx.

## 10. Umbau des Repos

- Vite-SPA → SvelteKit: `index.html`, `src/main.ts`, `src/App.svelte`,
  `src/lib/Counter.svelte`, `src/assets/*`, `tsconfig.app.json`,
  `tsconfig.node.json` entfallen; dazu kommen `svelte.config.js`
  (adapter-static), `src/app.html`, `src/routes/**`.
- `tauri.conf.json`: `frontendDist` → `../build`, `devUrl` bleibt Port 1420.
- Paketmanager: npm (`package-lock.json` bleibt, `bun.lock` wird entfernt).
- README wird neu geschrieben.
