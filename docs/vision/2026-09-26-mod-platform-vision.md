# Vision: Vom Mod-Manager zur Mod-Plattform

Datum: 2026-09-26
Quelle: Projektinhaber, festgehalten während der Planung des lokalen Mod-Managers.
Status: Leitbild. Gilt für alle weiteren Specs und Pläne dieses Repos.

## 1. Originaltext (wörtlich)

> ich würde generell zu einer logik tendieren, die original downloads liegen immer nochmal in einem separaten ordner pro version, um es auch als chache zu nutzen. oft wird ja ein mod in vielen profilen/modspacks gespielt mit der identischen version, warum dann. dann muss man nicht immer wieder downloaden und man hat noch mehr freiheiten am mods/versionen/configs rumzutüfteln. genial wäre eine art snapshotmanager, der zum einen backuped, aber auch configuration states auf allen möglichen ebenen festhalten kann und widerherrstellen, backuppen teilen etc. kann. eigentlich eignet sich dafür auch git, aber auch rsync hat glaube ich so ein feature. was denkst du? dann würde man auch einen entkoppelten und unabhängigen config-share mechanismus haben zu thunderstore, und man kann einen eigenen modlist share und server sync infrastruktur bauen, der client soll einfach eine unabhängigere und kompatible alternative werden. in zukunft stelle ich mir vor, dass der modmanager wirklich viel mehr unterstützen kann, weil man einzelene mod config states speichern und auch teilen kann, als template. im endeffekt stelle ich es mit vor wie github. ich kann teilen, einladen, collab, forken, versionieren etc. nur dass es nicht ein "code interface" hat sondern eher um modlisten/packs/configs zu managen.

Vorher im selben Gespräch (Kontext):

> das repository hier modmanager-client soll ausschließlich für lokales valheim-spiel sein. r2modman ist einfach eine sehr schlechte app, die möchte ich replacen. mit modernerem, flexibleren, performanteren, feature-richer!

> ich war sehr zufrieden mit der performance etc.

## 2. Strukturierte Lesart

### 2.1 Leitidee

Der Client wird eine **unabhängige, aber kompatible Alternative** zum Thunderstore-/r2modman-Ökosystem. Das Vorbild ist **GitHub, nur für Modlisten, Modpacks und Configs statt für Code**: teilen, einladen, gemeinsam bearbeiten, forken, versionieren.

### 2.2 Bausteine

| #   | Baustein                        | Was der Inhaber will                                                                                                                             | Warum                                                                                                 |
| --- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| B1  | **Versions-Cache / Bibliothek** | Jede Mod-Version liegt genau einmal separat vor (Originaldownload, pro Version eigener Ordner). Profile und Modpacks nutzen sie gemeinsam.       | Kein erneuter Download, kein doppelter Platz, freies Experimentieren mit Mods, Versionen und Configs. |
| B2  | **Snapshot-Manager**            | Zustände festhalten und wiederherstellen, auf allen Ebenen: ganzes Profil, Modliste, einzelne Mod-Config. Dazu Backup, Wiederherstellen, Teilen. | Sicheres Herumprobieren, Backups, reproduzierbare Stände.                                             |
| B3  | **Config-Templates**            | Einzelne Mod-Config-Zustände speichern und als Vorlage teilen.                                                                                   | Wiederverwendbare, teilbare „Presets“ unabhängig vom ganzen Profil.                                   |
| B4  | **Eigener Share-Mechanismus**   | Modlisten und Configs teilen, entkoppelt von Thunderstore (dessen Legacy-Profil-Codes bleiben als Kompatibilität).                               | Unabhängigkeit, mehr Möglichkeiten als ein kurzlebiger Code.                                          |
| B5  | **Sync-Infrastruktur**          | Eigene Infrastruktur für Modlisten-Sharing und Server-Sync.                                                                                      | Freundeskreis und eigener Dedicated Server (siehe `../webapp`, Docker-Stack) auf demselben Stand.     |
| B6  | **Kollaboration à la GitHub**   | Teilen, einladen, zusammenarbeiten, forken, versionieren von Modlisten, Packs und Configs.                                                       | Gemeinsames Pflegen von Modpacks.                                                                     |

### 2.3 Technische Ideen aus dem Text

- **git** als mögliche Grundlage für Versionierung und Snapshots.
- **rsync**: Der Projektinhaber erinnert sich an ein Snapshot-Feature. Gemeint ist `rsync --link-dest`: Snapshots, in denen unveränderte Dateien per Hardlink auf den vorherigen Snapshot zeigen, sodass sie keinen zusätzlichen Platz belegen (das Time-Machine-Prinzip).

### 2.4 Prinzipien, die daraus folgen

1. **Kompatibel bleiben:** Import und Export im r2modman-/Thunderstore-Format bleiben erhalten.
2. **Unabhängig werden:** Das eigene Format und die eigene Infrastruktur sind führend, Thunderstore ist eine Quelle unter mehreren.
3. **Einmal speichern, überall nutzen:** Mod-Dateien werden dedupliziert, Profile verweisen darauf.
4. **Alles ist versionierbar:** Modliste, aufgelöste Versionen und Configs haben eine Historie, die man wiederherstellen und teilen kann.
5. **Granularität:** Snapshots und Teilen funktionieren auf mehreren Ebenen, vom ganzen Pack bis zur einzelnen Config-Datei.
6. **Performance bleibt ein Kernwert:** Der Nutzer war mit der Performance der bisherigen Lösung sehr zufrieden. Neue Schichten dürfen sie nicht verschlechtern.

## 3. Offene Fragen (zu klären pro Teilprojekt)

- Wer betreibt die Sync-Infrastruktur, und für wen ist sie gedacht: ein privater Freundeskreis oder öffentlich?
- Sind Konten und Anmeldung nötig, und wenn ja, welche?
- Soll der eigene Valheim-Dedicated-Server (Docker) als Sync-Ziel angebunden werden?
- Wie verhalten sich Snapshots gegenüber Mods, die zur Laufzeit in ihren eigenen Ordner schreiben?
