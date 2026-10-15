# Auswirkungsanalyse: Plattform-Vision → aktueller Stand (v1)

Datum: 2026-09-26
Bezug: `docs/vision/2026-09-26-mod-platform-vision.md` (Bausteine B1–B6),
aktueller Code auf Branch `feat/local-modmanager` (v1, 54 Rust-Tests grün).

## 1. Kernaussage

Der v1-Stand passt in großen Teilen zur Vision: Resolver, Index, Sync-Engine, Config-Parser, Spielstart und r2modman-Kompatibilität bleiben. **Die Datenablage** muss sich aber jetzt ändern. Sie ist heute auf „ein Profil = ein Ordner mit kopierten Dateien, benannt nach dem Anzeigenamen“ gebaut. Snapshots, Deduplizierung, Teilen und Forken brauchen stabile IDs, einen reproduzierbaren Lock-Stand und Dateien, die nur einmal gespeichert werden.

Der Zeitpunkt ist günstig: Noch existieren keine Nutzerdaten im v1-Format, eine Migration entfällt. Jede Woche Nutzung mit dem alten Layout macht den Umbau teurer.

## 2. Was es heute schon gibt

| Vision                | Stand v1                                                                                                                                                                                                                                        |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1 Versions-Cache     | **Teilweise da.** `cache/downloads/<id>-<version>.zip` wird profilübergreifend geteilt; eine Version wird nie zweimal geladen. **Fehlt:** Die entpackten Dateien werden pro Profil kopiert (doppelter Platz); es gibt keine Bibliotheksansicht. |
| B2 Snapshots          | Nicht vorhanden. Nur „Profil klonen“ (vollständige Kopie).                                                                                                                                                                                      |
| B3 Config-Templates   | Nicht vorhanden. Configs sind nur als Teil eines r2modman-Exports teilbar.                                                                                                                                                                      |
| B4 Eigener Share      | Nicht vorhanden. Nur Thunderstore-Code und `.r2z` (Kompatibilität, bleibt).                                                                                                                                                                     |
| B5 Sync-Infrastruktur | Nicht vorhanden. Der Docker-Server nutzt noch den alten Sidecar.                                                                                                                                                                                |
| B6 Kollaboration      | Nicht vorhanden.                                                                                                                                                                                                                                |

## 3. Was sich jetzt ändern sollte (Fundament)

### F1 Stabile Profil-Identität

- **Heute:** Der Ordnername ist der Anzeigename (`profiles/<Name>/`). Umbenennen verschiebt den Ordner, einen Bezug über Geräte hinweg gibt es nicht.
- **Neu:** Jedes Profil bzw. Pack hat eine unveränderliche ID (UUID), einen Anzeigenamen als Feld und eine Herkunft (`forkedFrom`).
- **Betroffen:** `paths.rs`, `profiles.rs`, `commands.rs`, Frontend (Profilauswahl über ID).
- **Warum jetzt:** Forken, Syncen und Snapshots brauchen einen Bezug, der Umbenennungen übersteht.

### F2 Manifest und Lock trennen

- **Heute:** `profile.json` enthält nur die gewählten Mods. Die Abhängigkeiten werden bei jedem Aufruf aus dem aktuellen Index neu berechnet. Das ist weitgehend, aber nicht garantiert reproduzierbar: Fehlt eine Version, wird die neueste genommen, und das BepInExPack kommt ebenfalls in der neuesten Version dazu.
- **Neu:**
  - `manifest`: die Absicht des Nutzers (gewählte Mods, fest gepinnt oder „neueste“, an/aus).
  - `lock`: der exakt aufgelöste Stand inklusive Abhängigkeiten, Versionen und Datei-Hashes. Er entspricht dem Lockfile bei npm oder Cargo.
- **Warum:** Ein Snapshot oder geteilter Stand muss bei jedem Empfänger bitgenau dasselbe ergeben. Das ist die Grundlage für B2, B4, B5 und B6.
- **Betroffen:** `models.rs`, `resolver.rs` (erzeugt den Lock), `sync.rs` (installiert aus dem Lock).

### F3 Inhaltsadressierter Speicher + Hardlinks

- **Heute:** Jede Mod-Version wird in jedes Profil entpackt, also kopiert.
- **Neu:** Ein Store `store/<hash>` enthält jede entpackte Datei genau einmal, adressiert über ihren Inhalt (Hash). Profile bestehen aus Hardlinks auf den Store. Die Original-Zips bleiben pro Version als Quelle erhalten (B1).
- **Effekt:**
  - Ein neues Profil mit bekannten Mods entsteht fast sofort.
  - Zehn Profile mit Jötunn belegen den Platz einmal.
  - Ein Snapshot besteht nur noch aus Metadaten.
- **Risiko:** Manche Mods schreiben zur Laufzeit in ihren eigenen Plugin-Ordner. Bei einem Hardlink würde das die gemeinsame Datei für alle Profile verändern.
  - **Gegenmaßnahme:** Store-Dateien als schreibgeschützt markieren. Beim Snapshot bzw. Sync werden die Hashes geprüft. Configs (`BepInEx/config`) werden nie verlinkt, sondern pro Profil kopiert und versioniert.
- **Randbedingung:** Hardlinks funktionieren nur innerhalb eines Laufwerks. Store und Profile liegen beide unter `%APPDATA%`, das passt. Beim Spielordner wird ohnehin nichts verlinkt, dort setzt Doorstop die Pfade per Argument.
- **Betroffen:** `install.rs` (Entpacken in den Store statt ins Profil; die Layout-Logik bleibt), `sync.rs`, `paths.rs`.

### F4 Configs als versionierter Zustand

- **Heute:** `BepInEx/config` ist ein normaler Ordner im Profil.
- **Neu:** Jeder Config-Stand ist ein Snapshot-fähiger Baum mit Historie. Das ermöglicht Zurücksetzen und Vergleichen, auch für einzelne Dateien (die Grundlage für B3-Templates).
- **Betroffen:** `config.rs` (Parser und Writer bleiben), eine neue Snapshot-Schicht.

### F5 Schema-Versionen in allen gespeicherten Dateien

- **Neu:** Jede Datei, die die App schreibt, bekommt ein Feld `"schema": N`, damit künftige Formatänderungen migrierbar bleiben.
- **Aufwand:** klein; betrifft `models.rs` und `settings.rs`.

### F6 Index-Interning (unabhängig, weiterhin sinnvoll)

- Die Abhängigkeitslisten machen 93 % des Index-Caches aus (110 von 119 MB): 3,18 Mio. Einträge, davon nur 28.860 verschieden.
- **Neu:** Eine String-Tabelle plus `u32`-Verweise, gespeichert im Binärformat.
- **Erwartet:** etwa 15 MB, weniger als 100 ms Ladezeit, zweistelliger MB-Bedarf im RAM. Diese Werte sind geschätzt und noch nicht gemessen.
- **Betroffen:** `thunderstore.rs`, `models.rs` (`Version.deps`), `resolver.rs`.

## 4. Was bleiben kann

- `resolver.rs`: Die Logik bleibt, sie erzeugt künftig zusätzlich den Lock.
- `thunderstore.rs`: bleibt, plus F6.
- `sync.rs`: Warteschlange, Download-Pool und Fehlerbehandlung bleiben; das Installationsziel wechselt auf F3.
- `install.rs`: Die Layout-Erkennung und der Zip-Slip-Schutz bleiben; das Ziel wechselt auf den Store.
- `config.rs`, `game.rs`, `logs.rs`, `localmod.rs`: bleiben.
- `share.rs`: bleibt als Kompatibilitätsschicht für r2modman/Thunderstore.
- Frontend: Die Seiten bleiben. Neu kommen eine Snapshot-Ansicht und eine Bibliotheksansicht hinzu.

## 5. Technologie-Einschätzung für Snapshots und Teilen

| Ansatz                                                                             | Stärken                                                                                                                                                  | Schwächen                                                                                                                                                |
| ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **git** (Bibliothek `gix`/`git2`, kein CLI nötig)                                  | Historie, Diff, Branches und Merge fertig vorhanden. Forken, Kollaborieren und Hosting funktionieren sofort mit jedem Git-Host (GitHub, Gitea, Forgejo). | Große Binärdateien blähen Repos auf. Das ist aber lösbar: Mod-Binärdateien gehören nicht ins Repo, sondern werden per ID, Version und Hash referenziert. |
| **rsync `--link-dest`**                                                            | Das Prinzip „Snapshot = Hardlinks auf unveränderte Dateien“ ist genau richtig.                                                                           | Unter Windows nicht nativ verfügbar, kein Teilen, keine Historie. Das **Prinzip** übernehmen wir in F3, das Werkzeug nicht.                              |
| restic / borg                                                                      | Hervorragende deduplizierte Backups.                                                                                                                     | Reine Backup-Werkzeuge, keine Kollaboration.                                                                                                             |
| Eigener Objektspeicher + Manifeste (git-artiges Datenmodell, selbst implementiert) | Volle Kontrolle, schnell, einfach.                                                                                                                       | Diff, Merge, Forken und Hosting müssten alle selbst gebaut werden.                                                                                       |

**Empfehlung (Hybrid):** Ein **Pack ist ein git-Repository**. Es enthält Manifest, Lock und Configs, also nur Text: klein, diff- und merge-fähig. Mod-Binärdateien liegen im inhaltsadressierten Store (F3) und werden im Lock per Hash referenziert, ähnlich wie Git LFS mit Zeigern. Bezugsquelle ist Thunderstore oder später die eigene Infrastruktur.

Damit sind Snapshots Commits, Templates Dateien oder Teilbäume, Forks echte Forks und Teilen ein Push/Pull. Anfangs funktioniert das mit jedem vorhandenen Git-Host. Die eigene Plattform (B5/B6) kann später ein Git-Server mit Mod-spezifischer Oberfläche werden.

## 6. Vorgeschlagene Zerlegung in Teilprojekte

Jedes Teilprojekt bekommt einen eigenen Zyklus aus Spec, Plan und Umsetzung.

| #   | Teilprojekt                  | Inhalt                                                                                                            | Abhängig von |
| --- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------ |
| P0  | **Speicher-Fundament**       | F1–F3, F5, F6. Umbau der v1-Datenablage, noch ohne neue Oberfläche.                                               | –            |
| P1  | **Snapshot-Manager (lokal)** | Snapshots auf Profil-, Modlisten- und Config-Ebene, Wiederherstellen, Vergleichen, Config-Templates (F4, B2, B3). | P0           |
| P2  | **Eigenes Share-Format**     | Pack exportieren und importieren als Datei, Link oder Git-Remote; r2modman-Kompatibilität bleibt (B4).            | P0, P1       |
| P3  | **Sync und Kollaboration**   | Konten, Einladen, Forken, Server-Sync inklusive eigenem Dedicated Server (B5, B6).                                | P2           |

## 7. Folgen für den offenen v1-Branch

v1 ist funktionsfähig und getestet. P0 ersetzt dessen Datenablage, bevor echte Nutzerdaten entstehen. Beide Wege sind möglich:

- **v1 nach `main` mergen und P0 auf einem neuen Branch bauen.** `main` hat dann einen lauffähigen Stand; P0 ändert gezielt die Ablage.
- **P0 auf `feat/local-modmanager` weiterbauen.** `main` bekommt erst den Stand mit der neuen Ablage.

## 8. Entscheidungen

- **2026-09-26 — Fundament: git-Hybrid** (Entscheidung des Projektinhabers). Ein Pack ist ein git-Repository mit Manifest, Lock und Configs. Mod-Binärdateien liegen im inhaltsadressierten Store mit Hardlinks und werden im Lock per Hash referenziert. Snapshots sind Commits, Forks sind Git-Forks, und das Hosting ist anfangs über jeden Git-Host möglich.
- **2026-10-02 — git-Hybrid zurückgestellt** (Entscheidung des Projektinhabers). Der Ansatz überzeugt noch nicht und wird vorerst nicht umgesetzt. Spec und Plan zu P0 bleiben als Referenz erhalten. Vorrang hat jetzt das UI-Fundament (`docs/superpowers/plans/2026-10-02-ui-foundation.md`).
