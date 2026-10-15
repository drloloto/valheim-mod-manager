# P0: Speicher-Fundament — Design

Datum: 2026-09-26
Status: **Zurückgestellt** (2026-10-02, git-Hybrid wird vorerst nicht umgesetzt; siehe Analyse §8)
Bezug:

- Vision: `docs/vision/2026-09-26-mod-platform-vision.md`
- Analyse: `docs/specs/2026-09-26-vision-impact-analysis.md` (F1–F3, F5, F6)
- Vorgänger-Spec: `docs/specs/2026-09-26-local-modmanager-design.md` (v1)

## 1. Ziel

Die Datenablage von v1 wird so umgebaut, dass Snapshots (P1), eigenes Teilen (P2) und Sync/Kollaboration (P3) darauf aufsetzen können, ohne dass die Ablage erneut umgebaut werden muss. Nach außen bleibt die App funktional gleich. Neu sichtbar sind nur:

- eine Anzeige des belegten und gesparten Speichers;
- „Speicher aufräumen“;
- deutlich schnellere Starts.

### Erfolgskriterien

- Jede Datei einer Mod-Version liegt **genau einmal** auf der Platte, egal in wie vielen Profilen sie verwendet wird.
- Ein neues Profil mit 50 bereits gecachten Mods ist in **unter 1 s** installiert.
- Der Index-Cache ist **15 MB oder kleiner** und lädt in **unter 100 ms** (Release-Build).
- Die App braucht nach dem Start im Release-Build **weniger als 150 MB RAM**.
- Jedes Profil ist ein git-Repository. Jede Änderung an der Modliste erzeugt einen Commit.
- Ein Profil lässt sich allein aus `pack.json` und `pack.lock` bitgenau wiederherstellen (vorausgesetzt, die Pakete sind verfügbar).
- Alle v1-Funktionen laufen weiter. Die bestehenden Tests werden angepasst, keiner wird ersatzlos entfernt.

### Nicht in P0

Snapshot-Oberfläche, Wiederherstellen, Vergleichen, Templates (P1), Teilen per git-Remote (P2), Server und Konten (P3), Migration von v1-Daten (es gibt keine Nutzerdaten).

## 2. Entscheidungen

| Thema             | Entscheidung                                                                        | Begründung                                                                                                                                                                                                                           |
| ----------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Fundament         | **git-Hybrid** (Entscheidung des Projektinhabers)                                   | siehe Analyse §5                                                                                                                                                                                                                     |
| git-Bibliothek    | `git2` 0.21, `default-features = false`, Feature `vendored-libgit2`                 | Ausgereifte API für init, commit, log und checkout. libgit2 wird mitgebaut, ein installiertes git ist nicht nötig. HTTPS/SSH kommen erst in P2.                                                                                      |
| Hash              | BLAKE3 (`blake3`)                                                                   | Sehr schnell, 256 Bit. Wird für Store-Objekte und Zip-Prüfsummen genutzt.                                                                                                                                                            |
| Store-Verknüpfung | **Hardlinks** (`std::fs::hard_link`)                                                | Kein Admin-Recht nötig. Store und Profile liegen unter `%APPDATA%`, also auf demselben Laufwerk.                                                                                                                                     |
| Store-Schutz      | Store-Objekte **nicht** schreibgeschützt; „Reparieren“ prüft die Hashes             | Unter Windows müsste man vor dem Löschen eines Links den Schreibschutz der gemeinsamen Datei aufheben, das ist fehleranfällig. Das Restrisiko (ein Mod schreibt in seine eigene DLL) wird über die Hash-Prüfung erkannt und behoben. |
| Configs           | Werden **nie** verlinkt; sie liegen normal im Profil und werden von git versioniert | Configs ändern sich pro Profil und sind der Kern von Snapshots.                                                                                                                                                                      |
| Profil-ID         | UUID v4 (`uuid`), Ordnername = ID                                                   | Übersteht Umbenennungen, eignet sich für Sync und Forks. Keine Einschränkungen mehr durch Windows-Dateinamen.                                                                                                                        |
| Index-Cache       | Dependency-Interning + `postcard`-Binärformat                                       | 93 % des Caches sind Abhängigkeits-Strings mit etwa 110 Wiederholungen je Eintrag.                                                                                                                                                   |
| Schema            | Jede gespeicherte Datei hat `schema: 1`                                             | Macht spätere Migrationen möglich.                                                                                                                                                                                                   |

## 3. Datenablage (neu)

```
%APPDATA%\io.github.drloloto.valheim-mod-manager\
  settings.json                     { schema, … }
  active.txt                        Profil-ID
  cache/
    index.bin                       postcard: { schema, fetchedAt, deps: [String], pkgs: [Pkg] }
    downloads/<id>-<ver>.zip        Original-Zips (Bibliothek, B1)
    local/<blake3>.<zip|dll>        Originale lokaler Mods
  store/
    objects/<ab>/<blake3>           jede entpackte Datei genau einmal
    recipes/<id>/<ver>.json         { schema, zip: <blake3>, files: [[relPath, blake3, size]] }
  profiles/<uuid>/                  ← git-Repository
    .gitignore                      (von der App geschrieben, siehe §4.3)
    pack.json                       Manifest (versioniert)
    pack.lock                       Lock (versioniert)
    BepInEx/config/**               Configs (versioniert)
    BepInEx/{core,plugins,patchers,…}  Hardlinks auf store/objects (ignoriert)
    doorstop/…                      Hardlinks (ignoriert)
    .mm/state.json                  was tatsächlich verlinkt ist (ignoriert)
    BepInEx/LogOutput.log           (ignoriert)
```

### 3.1 `pack.json` (Manifest: was der Nutzer will)

```json
{
	"schema": 1,
	"id": "0f8c…-uuid",
	"name": "Freunde Server",
	"forkedFrom": null,
	"mods": [
		{ "namespace": "ValheimModding", "name": "Jotunn", "version": "2.20.1", "enabled": true, "source": "thunderstore" },
		{ "namespace": "local", "name": "MyMod", "version": "0.0.0", "enabled": true, "source": "local", "hash": "<blake3>", "deps": [] }
	]
}
```

### 3.2 `pack.lock` (exakt aufgelöster Stand)

```json
{
	"schema": 1,
	"packages": {
		"denikson-BepInExPack_Valheim": { "version": "5.4.2351", "zip": "<blake3>", "requiredBy": [] },
		"ValheimModding-Jotunn": { "version": "2.20.1", "zip": "<blake3>", "requiredBy": [] }
	}
}
```

- Der Lock wird aus Manifest und Index vom Resolver erzeugt, **nur wenn sich das Manifest ändert**, und bei „Updates prüfen“.
- Der Sync installiert **ausschließlich aus dem Lock**. Ein späterer Index-Refresh ändert ein Profil also nie still.
- `zip` ist der BLAKE3-Hash des Original-Zips. Er dient beim erneuten Download zur Prüfung, später auch bei Empfängern eines geteilten Packs.
- Die Dateiliste steht nicht im Lock, sondern in der Recipe. Sie ergibt sich deterministisch aus Zip und Layout-Regeln.

## 4. Komponenten

### 4.1 `store.rs` (neu)

- `ingest_zip(zip, id, version) -> Recipe`: nutzt die Layout-Logik aus `install.rs` (`map_target`), hasht jede Datei, schreibt neue Objekte nach `objects/`, speichert die Recipe. Das ist idempotent: Existiert die Recipe schon, wird nichts getan.
- `materialize(recipe, profile_dir) -> Vec<String>`: legt die Hardlinks an. Configs (`BepInEx/config/**`) aus der Recipe werden nur **kopiert**, und nur wenn sie im Profil noch fehlen. Das ist der Config-Schutz aus v1.
- `dematerialize(files, profile_dir)`: entfernt Links und räumt leere Ordner auf (die Logik aus `install::remove_files`).
- `verify(recipe) -> Vec<beschädigte Objekte>`, `repair` extrahiert beschädigte Objekte neu aus dem Zip.
- `gc(all_profiles) -> freigegebene Bytes`: Mark-and-Sweep über die `state.json` aller Profile. Nicht referenzierte Objekte und Recipes werden gelöscht; Zips bleiben (Bibliothek).
- `stats() -> { objects, bytes, linkedBytes }`: Aus `linkedBytes - bytes` ergibt sich die Ersparnis für die Anzeige.
- Fallback: Schlägt `hard_link` fehl (anderes Laufwerk, FAT32), wird kopiert und ein Hinweis protokolliert.

### 4.2 `install.rs` (geändert)

- Behält `zip_entry_parts`, `detect_layout`, `map_target` und den Zip-Slip-Schutz. Die Funktion `plan_zip(zip, id) -> [(target, zip-index)]` wird als reine Planung herausgelöst und von `store::ingest_zip` genutzt.
- `set_enabled` bleibt (`x` ↔ `x.old`). Das Umbenennen eines Hardlinks betrifft nur den Verzeichniseintrag im Profil, nicht das Store-Objekt.

### 4.3 `pack.rs` (neu, ersetzt `profiles.rs`)

- Profil-CRUD über die UUID: `create(name)`, `rename(id, name)` (ändert nur `pack.json`), `clone(id, name)` (neue UUID, `forkedFrom` = Quelle, git-Historie wird mitgenommen), `delete(id)`, `list() -> [{id, name}]`, `active` / `set_active`.
- Git-Anbindung über `git2`:
  - `init` beim Anlegen, mit `.gitignore`:
    ```
    /*
    !/.gitignore
    !/pack.json
    !/pack.lock
    !/BepInEx/
    /BepInEx/*
    !/BepInEx/config/
    ```
  - `commit(message)` nach jeder Änderung an Manifest oder Lock (hinzufügen, entfernen, Version, an/aus, Import). Autor ist „Valheim Mod Manager“, die Nachricht ist deutsch und beschreibend, z. B. „Jotunn 2.20.1 hinzugefügt“.
  - Config-Änderungen werden in P0 **nicht** automatisch committet; das ist Aufgabe von P1 (Snapshots). `git status` kann sie aber bereits erkennen.

### 4.4 `resolver.rs` (geändert)

- `plan` arbeitet auf dem internierten Index: `Version.deps: Vec<u32>`, aufgelöst über `index.dep(u32) -> &str`.
- Neu: `lock(manifest, index) -> (Lock, errors)`.
- `diff(lock, state) -> Plan`: vergleicht den Lock mit dem, was tatsächlich verlinkt ist.

### 4.5 `sync.rs` (geändert)

Der Ablauf wird zu:

1. Lock lesen oder erzeugen.
2. Fehlende Zips parallel laden und den BLAKE3-Hash gegen den Lock prüfen.
3. `ingest`.
4. Nicht mehr benötigte Pakete dematerialisieren.
5. Neue Pakete materialisieren.
6. Status schreiben.

Warteschlange, Fortschritts-Events, Fehlertoleranz und die Regel „explizite, im Index fehlende Mods nie entfernen“ bleiben.

### 4.6 `thunderstore.rs` (geändert, F6)

- `parse_raw` interniert die Abhängigkeits-Strings in `deps: Vec<String>` (eindeutig); `Version.deps` wird zu `Vec<u32>`.
- Der Cache wird als `index.bin` mit `postcard` gespeichert. Eine vorhandene alte `index.json` wird einmalig gelöscht.
- `slim_json` für das Frontend bleibt unverändert.

### 4.7 Commands und Frontend

- Alle Profil-Commands nehmen die `profileId` statt eines Namens. `AppState.profiles` wird zu `[{ id, name }]`, `active` ist eine ID.
- Neu:
  - `storage_stats() -> { objects, bytes, savedBytes }`
  - `gc_store() -> freedBytes`
  - `verify_profile(id)`, integriert in „Reparieren“.
- Frontend:
  - Die Profilauswahl zeigt Namen und arbeitet mit IDs.
  - Die Einstellungsseite zeigt „Speicher: X belegt, Y gespart“ und einen Button „Aufräumen“.
- Import (r2modman/Code/Datei) legt ein neues Profil mit neuer UUID an. Die Namens-Sanitisierung für Ordnernamen entfällt, weil der Ordner jetzt die UUID ist.

## 5. Fehlerbehandlung

- Hash-Abweichung beim Download: Die Datei wird verworfen, es folgt ein Fehler mit Paketname. Kein Retry-Loop.
- Hardlink-Fehler: Die App kopiert stattdessen und protokolliert einen Hinweis. Die Installation schlägt deshalb nicht fehl.
- git-Fehler, etwa ein gesperrter Index: Die Profiländerung bleibt gültig, der Commit wird beim nächsten Commit nachgeholt (`git add -A` auf die versionierten Pfade). Es erscheint ein Toast als Warnung.
- `gc` läuft nur, wenn kein Sync läuft (derselbe Mutex).

## 6. Tests

Rust, ohne Netzwerk:

- **Store:**
  - Zwei Profile mit demselben Paket → die Zahl der Objekte bleibt gleich, und beide Profildateien haben identischen Inhalt.
  - Ein Paket entfernen lässt die Store-Objekte stehen; erst `gc` löscht sie.
  - Configs werden kopiert, nicht verlinkt: Eine Änderung im Profil A ist in Profil B nicht sichtbar.
  - `verify` erkennt ein manipuliertes Objekt, `repair` stellt es wieder her.
- **Lock:**
  - Ändert sich der Index nach dem Locken (neue Versionen, gelöschtes Paket), installiert der Sync weiterhin exakt den Lock-Stand.
  - Eine Manifest-Änderung erzeugt einen neuen Lock.
- **Hash-Prüfung:** Ein manipuliertes Zip wird abgelehnt.
- **git:**
  - Nach `create` existiert ein Repo mit dem initialen Commit.
  - Mod hinzufügen erzeugt einen Commit mit sinnvoller Nachricht.
  - Hardlink-Dateien und das Log sind nicht versioniert, `BepInEx/config` schon.
  - `clone` übernimmt die Historie und setzt `forkedFrom`.
- **Index:**
  - Das Interning erhält alle Abhängigkeiten.
  - `postcard` übersteht einen Round-Trip.
  - Die bestehenden Resolver-Tests laufen unverändert gegen die internierte Form.
- **Messung** (manuell, Release-Build, echter Index): Cache-Größe, Ladezeit, RAM nach dem Start, Zeit für ein Profil mit 50 gecachten Mods. Die Ergebnisse kommen in den Abschlussbericht.

Frontend: `svelte-check`, Build, Autofixer.

## 7. Risiken

| Risiko                                                                                    | Gegenmaßnahme                                                                                    |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Ein Mod schreibt zur Laufzeit in seine eigenen Dateien und verändert damit andere Profile | „Reparieren“ prüft die Hashes. Später (P1) möglich: pro Mod die Option „als Kopie installieren“. |
| Virenscanner blockieren das massenhafte Anlegen von Hardlinks                             | Hardlinks werden nacheinander angelegt, bei Fehlern greift der Kopier-Fallback.                  |
| libgit2 verlängert den Build                                                              | Einmalig beim ersten Build; ohne HTTPS/SSH bleibt der Aufwand gering.                            |
