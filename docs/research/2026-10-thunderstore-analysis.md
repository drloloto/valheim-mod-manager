# Valheim Mod Manager: In-App-Moddetails, Feature-Gaps und Thunderstore-API (Stand Oktober 2026)

Für die Moddetails empfehle ich ein natives Seitenpanel mit Tabs (Beschreibung, Changelog, Versionen, Abhängigkeiten, Dependants, Wiki, Links). Gefüllt wird es aus den Cyberstorm-/Experimental-Endpunkten von Thunderstore, die README und CHANGELOG bereits als **gerendertes HTML** liefern. Dieses HTML wird im Client per DOMPurify nachgereinigt, eine strenge CSP gesetzt und jeder Link ins Systembrowser-Fenster umgeleitet. Eine eingebettete Webview ist nicht nötig. Wichtiger als jedes neue Feature ist jedoch die Migration weg von `/api/v1/package/`, das Thunderstore mit Release 0.182.0 (10. August 2026, PR #1354: „Added package-listing-index to Swagger and depcated old /v1/package/“) offiziell als deprecated markiert hat.

## TL;DR

- **Details-Ansicht:** Ein Slide-over-Panel mit Tabs nach dem Muster von r2modman 3.2 (Online-Preview mit README, CHANGELOG und Dependencies) und Gale (README im Details-Menü, Cache für README/Changelog, Code-Highlighting). Datenquelle ist `/api/cyberstorm/package/{ns}/{name}/latest/readme/`, das HTML liefert. Dazu kommen Lazy-Loading und ein unbefristeter Cache pro Version (Versionen sind unveränderlich, aber README-Overrides siehe Caveats). Die Bereinigung erfolgt mit DOMPurify im Frontend oder ammonia in Rust. Bilder laufen über ein `img-src`-Allowlisting. Eine Child-Webview (Tauri `unstable`) braucht man nicht.
- **Größte Lücken gegenüber der Konkurrenz:**
  1. Index-Migration auf die gechunkte `package-listing-index`, weil v1 deprecated ist.
  2. Profil als Modpack auf Thunderstore veröffentlichen (Gale hat das).
  3. Schema-bewusster Config-Editor mit Slidern, Checkboxen und Listen (Gale).
  4. Changelog-Diff vor dem Update sowie Version-Pinning und Rollback.
  5. Live-Profil-Sync per Link (Gale) und CLI bzw. Auto-Update von Profilen (r2modman #1670).
  6. Kategorie-Blacklist, z. B. um KI-generierte Mods auszublenden (r2modman #2213).
  7. Game-Version-Kompatibilität nach Valheim 1.0 (Patch-Welle, inoffizielle Forks).
- **API-Lage:** v1 bleibt vorerst funktionsfähig, gilt aber als deprecated. `package-listing-index` (gzip-Blobs über CDN) ist der Nachfolger. Cyberstorm-Endpunkte sind öffentlich und cachebar (`PublicCacheMixin`), aber nicht als stabile Public API dokumentiert. Pfade können sich ändern, deshalb gehört ein Adapter-Layer mit Fallback auf die Experimental-Endpunkte dazu.

## Section A – In-App-Details / README / Wiki / Changelog

### A.1 Was Thunderstore liefert (verifiziert am Beispiel PlantEverything)

Beispiel: Advize/PlantEverything, Valheim.

- **Version und Nutzung:** Aktuell ist 1.21.3 (25.09.2026). Das Paket hat laut old.thunderstore.io 2.779.564 Downloads, Rating 437 und 3.316 Dependants.
- **Kategorien:** Mods, Server-side, Client-side, Deep North Update.
- **Abhängigkeit:** genau eine, `denikson-BepInExPack_Valheim` (Preferred version 5.4.2351).
- **Downloads pro Version:** z. B. 1.21.3 mit 155.204, 1.21.2 mit 188.597 und 1.20.0 mit 521.223 (laut Thunderstore-Versionsseite; die Zahlen ändern sich laufend).
- **Inhalt der README:** Abschnitte Description, Features, Installing, Compatibility, Config, Source, Screenshots. Sie enthält externe Bilder ("Image hosting"), einen GitHub-Link und einen Nexus-Link als website_url.
- **CHANGELOG:** Separate CHANGELOG.md; v1.21.0 ist laut Changelog "Compiled against Valheim v1.0.7 & BepInEx 5.4.2350".
- **Tabs auf der Website:** Die neue Seite zeigt zusätzlich die Tabs "Source" (dekompilierter Code), "Versions", "Required" und "Dependants".

**Konsequenz:** Ein gutes Details-Panel braucht mindestens diese Bausteine:

- Header mit Icon, Autor/Team, Kategorien, Downloads, Likes, Größe, Last updated und Dependency-String zum Kopieren.
- Tabs **Beschreibung | Changelog | Versionen | Abhängigkeiten | Dependants | Links**.
- **Wiki** nur dann als Tab, wenn das Paket ein Wiki hat.

Nach dem Valheim-1.0-Bruch kommt Folgendes hinzu: Inoffizielle Rebuilds wie fedorovdgap/PlantEverything („Unofficial rebuild of Advize's PlantEverything for the Valheim 1.0 update. Fixes the ZRoutedRpc.Everybody startup crash“, gebaut aus „upstream master at commit 7a2bbc5“) oder TeamNibake/PlantEverything1point0fork sollten erkannt und als "Fork von …" markiert werden.

### A.2 Endpunkte für die Details-Ansicht

| Zweck                                                                                            | Endpunkt                                                                                               | Format                                  | Status                                                              |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ | --------------------------------------- | ------------------------------------------------------------------- |
| README (latest)                                                                                  | `GET /api/cyberstorm/package/{ns}/{name}/latest/readme/`                                               | `{ html, is_edited, … }` (HTML!)        | in Nutzung belegt (r2modman #434, thunderstore-ui Schema)           |
| README (Version)                                                                                 | `GET /api/experimental/package/{ns}/{name}/{version}/readme/`                                          | Markdown/HTML-Feld (Swagger)            | experimental, im Swagger gelistet                                   |
| CHANGELOG (Version)                                                                              | `GET /api/experimental/package/{ns}/{name}/{version}/changelog/`                                       | wie README                              | experimental                                                        |
| CHANGELOG (latest, Cyberstorm)                                                                   | `/api/cyberstorm/package/{ns}/{name}/latest/changelog/`                                                | vermutlich `{ html }`                   | **unverifiziert**                                                   |
| Paket + alle Versionen                                                                           | `GET /api/experimental/package/{ns}/{name}/`                                                           | JSON (latest, versions, rating, …)      | experimental                                                        |
| Kennzahlen                                                                                       | `GET /api/v1/package-metrics/{ns}/{name}/`                                                             | downloads, rating_score, latest_version | v1, leichtgewichtig                                                 |
| Listing-Detail (Community-Kontext, Kategorien, Dependencies inkl. `is_removed`/`is_unavailable`) | `/api/cyberstorm/listing/{community}/{ns}/{name}/`                                                     | JSON                                    | Pfad **unverifiziert**, View `package_listing.py` belegt (PR #1439) |
| Dependants                                                                                       | `/api/cyberstorm/listing/{community}/{ns}/{name}/dependants/`                                          | JSON paginiert                          | **unverifiziert**                                                   |
| Wiki                                                                                             | `GET /api/experimental/package/wikis/`, `…/{ns}/{name}/wiki/`, `GET /api/experimental/wiki/page/{id}/` | JSON + Markdown                         | experimental                                                        |
| Markdown-Rendering serverseitig                                                                  | `POST /api/experimental/frontend/render-markdown/`                                                     | HTML                                    | experimental, nur für eigene Texte nötig                            |

**Wichtig:** Seit thunderstore-ui PR #1952 (September 2026) können Autoren README und CHANGELOG auf der Website **nachträglich editieren**. Die Edits liegen in der Datenbank, nicht im ZIP ("Stored in the DB, not in the package archive"), und das Flag `is_edited` zeigt das an. Die App muss deshalb die README über die API holen und nicht aus dem ZIP lesen. Den Cache pro Version sollte sie per TTL oder ETag revalidieren, statt ihn "für immer" zu halten.

### A.3 Wie die Konkurrenz es macht

- **r2modman ab 3.2.0:** Ein Online-Preview-Panel zeigt README, CHANGELOG und Dependencies (PR #1680). Die Umsetzung hat markdown-it entfernt ("Converted markdown fetch to pre-determined content via TS endpoint"), rendert also das von Thunderstore vorgerenderte HTML. Weitere Details aus PR #1680:
  - Bildlinks öffnen nicht im internen Browser, Mittelklick öffnet kein Electron-Fenster.
  - Eine Race-Condition ist behoben ("Incorrect README and CHANGELOG can no longer appear if loaded after a new selected README/CHANGELOG has been loaded").
  - Ein "missing changelog"-Banner, ein Dependency-Zähler und ein Light/Dark-Theme für Markdown.
- **Gale (Tauri und Svelte, gleicher Stack):**
  - README im Details-Menü, angezeigt sobald das Fenster breit genug ist.
  - Mod-Icon im Details-Menü, Dateigröße, "View dependants", Dependency-String kopieren.
  - Code-Highlighting in Markdown und ein Cache für READMEs und Changelogs.
  - Laut Changelog 1.19.1 (27.07.2026) respektiert Gale HTTP-Cache-Header, außer bei README und Changelog, die "always aggressively cached" werden; seit 1.22.3 (16.09.2026) hat der HTTP-Request-Cache eine Maximalgröße von 100 MB.
  - Seit 1.23.0 (02.10.2026) zeigt die Liste Downloads und "time since last update".
- **Modrinth App, CurseForge, Nexus/Vortex** (Muster, nicht in dieser Recherche einzeln verifiziert): Detailseite mit Tabs Description, Gallery, Changelog, Versions sowie Links zu Source, Wiki, Discord und Donate. Externe Links öffnen extern.

### A.4 Empfohlener technischer Ansatz (Tauri 2 / Svelte 5)

1. **Datenpfad in Rust:**
   - Ein Command `get_package_details(ns, name, version)` holt README und CHANGELOG parallel, dazu Metrics und Listing.
   - Gespeichert wird in einem Disk-Cache (z. B. SQLite oder zstd-Datei) mit dem Schlüssel `{ns}-{name}-{version}`, inklusive ETag bzw. Last-Modified.
   - Gerendert wird stale-while-revalidate. Nicht-latest-Versionen haben eine lange TTL, latest wegen `is_edited` etwa 1 h.
   - Ein Request-Token bzw. AbortController verhindert das veraltete Anzeigen, das r2modman beheben musste.
2. **Rendering:**
   - Da Thunderstore HTML liefert, ist kein Markdown-Parser nötig. Das HTML wird trotzdem **erneut gereinigt**, entweder mit DOMPurify im Frontend (Allowlist für Tags/Attribute, keine `style`, `on*`, `iframe` oder `form`) oder mit `ammonia` in Rust vor der Übergabe.
   - Für Wiki-Seiten und lokale Mods (Markdown aus ZIP oder lokalem README) gibt es zwei Optionen: `comrak` bzw. `pulldown-cmark` plus `ammonia` in Rust (eine Pipeline, kein JS-Bundle) oder `markdown-it` bzw. `marked` plus DOMPurify im Frontend.
   - Ich empfehle Rust (comrak + ammonia), weil damit auch lokale READMEs abgedeckt sind und das HTML schon sauber im IPC ankommt.
   - Ein Hook schreibt alle `<a>` auf `data-href` um. Ein Klick ruft `opener.openUrl()` nach Bestätigung bzw. Allowlist auf. Thunderstore-Paketlinks (`/c/valheim/p/{ns}/{name}/`) werden abgefangen und **in-app** geöffnet.
3. **Bilder und CSP:**
   - Variante 1: `img-src https: data:` erlauben. Das ist einfach, gibt aber die IP an Dritt-Hoster weiter.
   - Variante 2: Ein Image-Proxy über ein Custom-Protokoll (`register_asynchronous_uri_scheme_protocol`, z. B. `vmm-img://`). Er lädt in Rust, cacht, begrenzt die Größe und prüft Content-Type `image/*`.
   - Ich empfehle Variante 2 mit optionalem Toggle "Externe Bilder laden" (Privacy).
   - In jedem Fall gelten `script-src 'self'`, kein `unsafe-inline` für Skripte und `frame-src 'none'`.
   - Bilder kommen mit `loading="lazy"`, Klick öffnet eine Lightbox-Galerie, GIFs werden erst bei Hover abgespielt (optional).
4. **Keine eingebettete Webview als Standard:**
   - Child-Webviews (`Window::add_child`, JS `new Webview()`) sind in Tauri 2 weiterhin hinter dem `unstable`-Feature. Sie brauchen zusätzlich die Permission `core:webview:allow-create-webview`.
   - Für Remote-Inhalte gibt es Capability-Probleme (tauri #10317). Eine Remote-Seite im selben Prozess vergrößert außerdem die Angriffsfläche, wenn sie IPC erreicht.
   - Wenn überhaupt, sollte ein **separates WebviewWindow** (stabil) ohne Capabilities für "Auf Thunderstore öffnen (in-app)" dienen, für Wiki-Seiten auf GitHub oder für Nexus.
5. **XSS-Risiko:**
   - Package-READMEs sind nutzergenerierter Inhalt. Im Tauri-Kontext würde XSS Zugriff auf `invoke` bedeuten, also Dateisystem, Prozessstart und Updater.
   - Deshalb gilt doppelte Sanitization (Server und Client), dazu minimale Capabilities für das Hauptfenster.
   - Das Details-Panel bekommt keine Sonderrechte, und `withGlobalTauri` bleibt aus.

**UX-Vorschlag "slim und elegant":** Ein Sheet von rechts mit 40–50 % Breite, das sich per Doppelklick oder Enter auf eine Zeile öffnet. Die Tabs sind sticky, der Header kompakt mit den Buttons Install/Update/Version wählen. Ein Dropdown wählt die Version und lädt dazu die passende README bzw. den passenden Changelog. Im Update-Dialog erscheint der **Changelog-Ausschnitt zwischen installierter und neuer Version**. Dafür werden die `##`-Überschriften geparst und der Bereich von > installiert bis ≤ neu angezeigt.

## Section B – Feature-Gap-Liste

### B.1 Feature-Matrix (Kurzform)

| Bereich                         | Valheim MM (heute)   | r2modman         | Gale                           | Weitere                     |
| ------------------------------- | -------------------- | ---------------- | ------------------------------ | --------------------------- |
| In-App README/Changelog         | ✗                    | ✓ (3.2.0)        | ✓ inkl. Cache                  | Modrinth/CurseForge/Nexus ✓ |
| Dependants-Ansicht              | ✗                    | teilw.           | ✓                              | Thunderstore-Web ✓          |
| Downloads/Last updated in Liste | ✓ (Filter)           | ✓                | ✓ (1.23)                       | –                           |
| Schema-aware Config-Editor      | Text-Editor          | Basis            | ✓ Slider/Checkbox/Listen/Farbe | MO2 ✗                       |
| Modpack-Export und Upload zu TS | ✗                    | ✗                | ✓                              | tcli                        |
| Live-Profil-Sync per Link       | Snapshot/Server-Link | Code/.r2z        | ✓ Live-Sync                    | PhValheim                   |
| CLI                             | ✗                    | ✗ (Wunsch #1670) | ✓                              | –                           |
| Version pinning/ändern          | teilw.               | –                | ✓ "Change version", Pinning    | Modrinth ✓                  |
| Custom-Sortierung/Load-Order    | –                    | –                | ✓                              | MO2/Vortex ✓                |
| Hardlinks statt Kopie           | Shared Zip-Cache     | Kopie            | ✓ Hardlinks                    | Vortex Hardlink-Deploy      |
| i18n                            | EN/DE                | EN/FR (3.2.20)   | viele Locales                  | –                           |
| Ecosystem-Schema genutzt        | ✗ (nur Valheim)      | ✓ (PR #1724)     | ✓                              | –                           |

### B.2 Gap-Liste (priorisiert)

| #   | Feature                                                                                                                                                                                                       | Nutzen für           | Evidenz                                                                                          | Aufwand | Prio                  |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------ | ------- | --------------------- |
| 1   | **Index-Migration auf `package-listing-index`** (gzip-Chunks, CDN-Fallback, conditional GET)                                                                                                                  | alle                 | TS-Release 0.182.0: "deprecated old /v1/package/"; r2modman PR #1345/#1457; TS #1407 (CDN-Links) | M       | Must                  |
| 2   | **In-App-Details-Panel** (Section A) inkl. Versionsauswahl, Dependants, Links                                                                                                                                 | Spieler              | r2modman 3.2.0, Gale                                                                             | M       | Must                  |
| 3   | **Changelog-before-Update** (Diff-Bereich installiert→neu) im Update-Dialog                                                                                                                                   | Spieler, Admin       | Gale "Dialog before updating all mods"; Owner-Wunsch                                             | S       | Must                  |
| 4   | **Version pinnen / Downgrade / Rollback pro Mod** (Pin schützt vor "Update all")                                                                                                                              | Admin, Spieler       | Gale "Change version", Pinning; Valheim-1.0-Bruch                                                | S–M     | Must                  |
| 5   | **Game-Kompatibilitätshinweis Valheim 1.0** (Mods ohne Update seit 09.09.2026 und "Compiled against …" aus dem Changelog parsen; inoffizielle Forks erkennen)                                                 | Spieler, Admin       | Valheim 1.0.7 am 09.09.2026, Hotfix 1.0.12; PlantEverything-Forks                                | M       | Must                  |
| 6   | **Schema-aware BepInEx-Config-Editor** (Typen, Default, AcceptableValueRange/List aus Kommentaren → Slider, Dropdown, Checkbox, Listen-Editor, Farbwähler; "Reset to default"; verwaiste Einträge ausblenden) | Spieler, Admin       | Gale-Wiki "Feature-rich config editor", Orphan-Handling                                          | M       | Should                |
| 7   | **Profil als Modpack veröffentlichen** (manifest/README/icon/CHANGELOG generieren, Configs beilegen, Upload per Service-Account-Token; alternativ `thunderstore.toml` für tcli exportieren)                   | Modpack-Autor, Admin | Gale Modpack-Upload; tcli `build`/`publish`                                                      | M–L     | Should                |
| 8   | **Kategorie-Blacklist und globale Filter-Defaults** (z. B. "AI Generated", NSFW, deprecated)                                                                                                                  | Spieler              | r2modman #2213 (Okt. 2026 kommentiert)                                                           | S       | Should                |
| 9   | **Live-Profil-Sync per Link/ID** (Abo auf ein Remote-Profil; Server-Admin pusht, Clients ziehen automatisch) über den vorhandenen Companion-Container hinaus                                                  | Admin, Gruppe        | Gale "Live profile sync updates", "Sync profile import links"; PhValheim; AutoModSync (Nexus)    | M–L     | Should                |
| 10  | **CLI / Headless** (`vmm sync --profile X --code Y`, `vmm launch`) für Verknüpfungen und Skripte                                                                                                              | Power-User, Admin    | r2modman #1670; Gale CLI                                                                         | M       | Should                |
| 11  | **Client/Server-Seite pro Mod** (Kategorien Server-side/Client-side sowie Jötunn-NetworkCompatibility/ServerSync-Erkennung → Warnung "muss auf beiden Seiten sein")                                           | Admin                | Jötunn NetworkCompatibility-Doku; Hoster-Guides (LOW.MS, Nitrado)                                | M       | Should                |
| 12  | **Log-Analyse mit Ursachen-Hints** (Stacktrace → Plugin-GUID → Mod, bekannte Fehlermuster, "Incompatible version", fehlende Dependency)                                                                       | Spieler              | Hoster-Troubleshooting-Guides                                                                    | M       | Should                |
| 13  | **Hardlinks statt Kopien** zwischen Profilen                                                                                                                                                                  | alle                 | Gale "linking mod files instead of copying"                                                      | M       | Could                 |
| 14  | **Ecosystem-Schema nutzen** (`/api/experimental/schema/dev/latest/`) für Install-Rules und Loader-Paket statt Hardcoding, als Basis für spätere Mehrspiel-Fähigkeit                                           | Wartung              | r2modman PR #1724; thunderstore-engine                                                           | S–M     | Could                 |
| 15  | **Dependants/Popularität als Discovery** ("Wird verwendet von 3.316 Mods", Trending nach Downloads der letzten Versionen)                                                                                     | Spieler              | Thunderstore-Web; Gale                                                                           | S       | Could                 |
| 16  | **Benachrichtigungen** (Update-Badge, Tray-Hinweis "Server-Profil geändert")                                                                                                                                  | Admin, Spieler       | Gale Live-Sync                                                                                   | S       | Could                 |
| 17  | **Export der Modliste als Text/Markdown** (für Discord)                                                                                                                                                       | Admin                | Gale 1.13.1 "export mod list to file"                                                            | S       | Could                 |
| 18  | **Zusätzliche Paketquellen** (eigene Repos, Nexus-Mods als lokal mit Update-Check)                                                                                                                            | Power-User           | r2modman #1273; Gale "switch between sources"                                                    | L       | Could                 |
| 19  | Offline-Modus (expliziter Schalter, Index aus Cache, Installationen nur aus Zip-Cache)                                                                                                                        | Spieler              | allgemeiner Standard                                                                             | S       | Could                 |
| 20  | Auto-Update abschaltbar / Kanal wählbar                                                                                                                                                                       | Spieler              | r2modman #1626                                                                                   | S       | Could (vorhanden-nah) |

**Vorhanden, aber bei der Konkurrenz besser:** Der Config-Editor ist heute nur ein Text-Editor, Gale ist hier deutlich besser (siehe #6). Server-Sync ist vorhanden; Gale bietet zusätzlich Live-Sync über die Cloud, PhValheim und AutoModSync arbeiten serverseitig getrieben. Das eigene Companion-Container-Modell ist für Admins mit eigenem Server stark, für Gruppen ohne eigenen Server fehlt aber ein leichtgewichtiger Sync-Link (#9).

### B.3 Community-Wünsche (Ranking nach Häufigkeit und Signal)

1. **Client/Server-Mismatch nach Updates** ist der mit Abstand häufigste Schmerzpunkt. Alle Hoster-Guides (LOW.MS, Nitrado, Host Havoc) nennen ihn als Hauptursache für Verbindungsprobleme, und mit Valheim 1.0 hat er sich verstärkt. Teilweise abgedeckt ist er durch Server-Vergleich vor Play; es fehlen #4, #5, #9 und #11.
2. **Mods nach Game-Update kaputt bzw. veraltet** → #5 (der Health-Hint "älter als letztes Game-Update" existiert bereits, die Changelog-Analyse fehlt).
3. **Profil-Updates für Mitspieler ohne Aufwand** (r2modman #1670) → #9, #10.
4. **Filter merken und Kategorien ausblenden** (r2modman #2213) → gespeicherte Views sind vorhanden, Blacklist bzw. Default-Filter fehlen (#8).
5. **In-App-Beschreibungen** (r2modman 3.2 hat es nachgerüstet) → #2.
6. Eigene Quellen (#1273), Auto-Update aus (#1626) → nachrangig.

_Hinweis:_ Upvote-Zahlen ließen sich für die r2modman-Issues nicht zuverlässig erheben. Das Ranking beruht auf der Häufigkeit in Issues, Changelogs und Hoster-Guides.

## Section C – Thunderstore-API-Referenz

| Endpunkt                                                                                       | Zweck                                                          | Auth                                               | Stabilität                                                                                                   | Nützliche Felder                                                                                                                  |
| ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| `/c/valheim/api/v1/package/`                                                                   | Voller Index (heute genutzt)                                   | –                                                  | **deprecated** (Release 0.182.0, #1354); Last-Modified, `Cache-Control: max-age=30`, 304 bei conditional GET | name, owner, versions[], rating_score, is_pinned, is_deprecated, has_nsfw_content, categories, date_updated, file_size, downloads |
| `package-listing-index` (Community-scoped, `?cdn=`)                                            | Gechunkter Index: 302 → Index-Blob → gzip-JSON-Chunks über CDN | –                                                  | neu, Nachfolger von v1; Chunk-Links nutzen derzeit immer Default-CDN (#1407)                                 | wie v1, Dependency-Namen serverseitig aufgelöst (#1370)                                                                           |
| `/api/experimental/package-index/`                                                             | Älterer Experimental-Index                                     | –                                                  | experimental                                                                                                 | –                                                                                                                                 |
| `/api/v1/package-metrics/{ns}/{name}/`                                                         | Kennzahlen eines Pakets                                        | –                                                  | v1                                                                                                           | downloads, rating_score, latest_version                                                                                           |
| `/api/experimental/package/{ns}/{name}/`                                                       | Paket inkl. Versionen                                          | –                                                  | experimental                                                                                                 | latest, versions, website_url, icon                                                                                               |
| `/api/experimental/package/{ns}/{name}/{ver}/`                                                 | Einzelversion                                                  | –                                                  | experimental                                                                                                 | dependencies, download_url, downloads, file_size                                                                                  |
| `/api/experimental/package/{ns}/{name}/{ver}/readme/` · `/changelog/`                          | README/CHANGELOG je Version                                    | –                                                  | experimental                                                                                                 | markdown                                                                                                                          |
| `/api/cyberstorm/package/{ns}/{name}/latest/readme/`                                           | README (Web-UI)                                                | –                                                  | intern-öffentlich, `PublicCacheMixin`                                                                        | `html`, `is_edited`                                                                                                               |
| `/api/cyberstorm/listing/…`, `/package/…`, `/team/…`, `/community/…`                           | Daten der neuen Website (Listing, Versionen, Dependants, Team) | – (lesend)                                         | intern, Pfade teils **unverifiziert**, kein Stabilitätsversprechen                                           | Dependencies mit `is_removed`/`is_unavailable`                                                                                    |
| `/api/experimental/package/wikis/`, `…/{ns}/{name}/wiki/`, `/api/experimental/wiki/page/{id}/` | Paket-Wikis                                                    | lesend – / schreibend Token                        | experimental                                                                                                 | Seiten-Titel, Markdown                                                                                                            |
| `/api/experimental/community/` · `/community/{c}/category/`                                    | Communities und Kategorien (slug, name)                        | –                                                  | experimental                                                                                                 | slug für Filter/Upload                                                                                                            |
| `/api/experimental/schema/dev/latest/`                                                         | Ecosystem-Schema (Games, Loader, Install-Rules)                | –                                                  | experimental, von r2modman genutzt                                                                           | install rules, loader packages                                                                                                    |
| `/api/experimental/legacyprofile/create/` · `/legacyprofile/get/{key}/`                        | r2modman-Share-Codes                                           | –                                                  | experimental, de-facto stabil                                                                                | –                                                                                                                                 |
| `/api/experimental/frontend/render-markdown/` (POST)                                           | Markdown → HTML wie auf der Website                            | –                                                  | experimental                                                                                                 | html                                                                                                                              |
| `/api/experimental/submission/upload/`, `/submission/submit/`, `/submission/validate/readme/`  | Upload/Publish (Modpack)                                       | **Service-Account-Token** (Bearer, Format `tss_…`) | experimental; validate/readme lieferte bis PR #1453 (11.10.2026) 500                                         | –                                                                                                                                 |
| `/package/download/{ns}/{name}/{ver}/`                                                         | Download (heute genutzt)                                       | –                                                  | stabil                                                                                                       | –                                                                                                                                 |

**Auth, Limits, Nutzungsbedingungen:** Lesende Endpunkte funktionieren ohne Authentifizierung. Für das Publizieren braucht es ein Team-Service-Account-Token, wie es auch tcli bzw. `TCLI_AUTH_TOKEN` in CI nutzen. Offizielle Rate-Limits wurden nicht gefunden. Ich empfehle trotzdem einen eigenen User-Agent, conditional GETs, Request-Bündelung und kein Prefetch aller READMEs. Der Thunderstore-CDN hat bekannte Ausfälle: Das Thunderstore-Wiki („Common Issues“) spricht von einem „ongoing issue with Thunderstore CDN provider (we are working on it)“ und empfiehlt „Toggle preferred Thunderstore CDN“, deshalb braucht es Retry und CDN-Fallback. Die Swagger-Doku liegt unter `/api/docs/`.

**tcli:** `thunderstore.toml` deckt `[package]` (namespace, name, versionNumber, description, websiteUrl, containsNsfwContent, dependencies), `[build]` (icon, readme, outdir, copy) und `[publish]` (repository, communities, categories) ab. Die App könnte genau dieses Format exportieren: Modpack = Profil-Dependencies plus Config-Ordner. Bekannte Einschränkungen: Glob-Patterns in `build.copy` (#116) und HTTP-Repos (#111) werden nicht unterstützt. Ein direkter API-Upload, wie Gale ihn macht, ist UX-seitig besser als ein Aufruf von tcli.

## Recommendations (Reihenfolge)

1. **Sprint 1 (Must):**
   - Den Index-Loader auf `package-listing-index` umstellen und v1 als Fallback behalten.
   - Das Details-Panel bauen: Beschreibung, Changelog, Versionen, Abhängigkeiten.
   - Den Changelog-Diff in den Update-Dialog übernehmen.
   - Version-Pinning einführen.
2. **Sprint 2:**
   - Dependants und Wiki-Tab.
   - Valheim-1.0-Kompatibilitäts-Heuristik und Fork-Erkennung.
   - Kategorie-Blacklist.
   - Image-Proxy.
3. **Sprint 3:**
   - Schema-aware Config-Editor.
   - Modpack-Publish.
   - Sync-Link bzw. CLI.

## Caveats

- Cyberstorm-Pfade für Changelog, Dependants, Versionen, Listing und Team sind in der Tabelle als **unverifiziert** markiert. Sie wurden aus Codebasis-Struktur und Sekundärquellen abgeleitet, Live-Abrufe der JSON-Antworten waren in dieser Recherche nicht möglich. Vor der Implementierung bitte gegen `/api/docs/` bzw. `django/thunderstore/api/cyberstorm/urls.py` prüfen.
- Die Angaben zu Modrinth, CurseForge, Vortex, MO2, Prism und Nexus Mods App beruhen auf allgemeinem Produktwissen, nicht auf Quellen aus dieser Recherche. Die GitHub-Suche `#valheim #mod-manager` ließ sich nicht abrufen. Ein Treffer im Umfeld ist `endoze/thunderstore-engine` (Rust-Engine mit zstd/bincode-Index-Cache, Ecosystem-Schema und r2modman-kompatiblen Profilen, "extracted from valheim-mod-manager"); er lohnt einen Blick als Referenz oder Dependency.
- README-Inhalte sind seit PR #1952 editierbar. Ein "für immer"-Cache pro Version ist deshalb nicht mehr korrekt.
- Download- und Rating-Zahlen von PlantEverything sind Momentaufnahmen von der Thunderstore-Website (Ende September bis Oktober 2026).
