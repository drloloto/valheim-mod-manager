# Durchsuchen: Filter-System, Spaltenkonfiguration, Konsistenz — Design

Umsetzung von Phase 2 aus dem UI-Fundament-Plan (`2026-10-02-ui-foundation.md`, Entscheidung 8)
nach Design 2a (`docs/design/2026-10-02-mod-manager-designs.html`).

## Ziel

Die Durchsuchen-Seite bekommt ein Filter-System, das ein- **und** ausschließen kann, Bereiche
(Datum, Zahlen) mit Operator, Histogramm und Von–Bis-Feldern filtert, aktive Filter als Tokens
über der Tabelle zeigt und häufige Kombinationen als Ansicht speichert. Tabellen bekommen
konfigurierbare Spalten (sichtbar, Reihenfolge, Breite, Dichte). Layout-Sprünge durch
Filterzustände verschwinden. Durchsuchen und Installiert teilen sich Werkzeugleiste,
Zellen-Typografie, Spaltenkonfiguration und ein immer sichtbares Detail-Panel.

## Entscheidungen

1. **Zwei Filter-Bausteine.** Jeder Filter ist eine _Liste_ (Drei-Zustands-Checkbox:
   1× Klick = einschließen, 2× = ausschließen, 3× = aus; Rechtsklick schaltet direkt auf
   ausschließen) oder ein _Bereich_ (Operator, Histogramm, Von–Bis, Presets).
2. **Listen-Semantik** wie im Design: Ein Paket passt, wenn es **mindestens einen** eingeschlossenen
   Wert hat und **keinen** ausgeschlossenen. Nur _Kategorie_ hat zusätzlich den Modus
   „eine / alle“ (OR / AND für eingeschlossene Werte).
3. **Listen:** Status (Im Profil, Update verfügbar, Deaktiviert, Abhängigkeit, Nicht im Profil),
   Kategorie, Autor (mit Suche), Profil (Mods, die in einem anderen Profil liegen),
   Abhängigkeiten (Keine, Alle im Profil, Fehlen im Profil), Merkmale (Veraltet, NSFW, Angepinnt).
   Veraltet und NSFW sind standardmäßig ausgeschlossen; NSFW folgt der Einstellung.
4. **Bereiche:** Aktualisiert und Erstellt (Datum), Downloads, Bewertung, Größe, Anzahl
   Abhängigkeiten (Zahl).
   - Datum: Operatoren `innerhalb` / `älter als` (relativ: N Tage/Wochen/Monate/Jahre) und
     `zwischen` / `außerhalb` (absolut: zwei Datumsfelder). Presets 7 T, 30 T, 90 T, 1 J.
     Histogramm: 24 Monatsbalken plus „älter“.
   - Zahl: Operatoren `≥` / `≤` / `zwischen` / `außerhalb`, Histogramm logarithmisch
     (Downloads, Größe) oder linear (Bewertung, Abhängigkeiten). Balken anklicken setzt
     `zwischen` auf den Balkenbereich.
     `älter als` und `außerhalb` sind die Ausschluss-Formen der Bereiche.
5. **Tokens.** Jeder aktive Filter steht als „Feld · Operator · Wert ✕“ über der Tabelle.
   Listen ergeben je ein Token pro Feld und Vorzeichen; Klick auf den Operator kehrt das
   Vorzeichen um (ist ↔ ist nicht) bzw. wechselt bei Bereichen zur Ausschluss-Form.
   Die Token-Zeile ist immer vorhanden („+ Filter“ öffnet die Sektion, rechts „N von M“),
   damit das Setzen des ersten Filters die Tabelle nicht verschiebt.
6. **Ansichten.** Eingebaute Ansichten (Bewährt & aktuell, Neu diesen Monat, Ohne
   Abhängigkeiten, Updates) und gespeicherte Ansichten (Name + Kriterien, in `localStorage`).
   Die aktive Ansicht ist hervorgehoben, wenn die Kriterien gleich sind.
7. **Keine Abfragesprache in dieser Stufe.** Das Suchfeld bleibt Volltext. Tokens und
   Sektionen decken die Bedienung ab; die Textsyntax aus 2a bleibt Folgearbeit.
8. **Spalten.** `DataTable` bekommt `prefs` (ausgeblendete Spalten, Reihenfolge, Breiten,
   Dichte), ein Kopfzeilen-Kontextmenü (Spalten an/aus, Breiten zurücksetzen, Dichte),
   Ziehen zum Umsortieren und einen Griff zum Verbreitern. Breiten gelten je Tabelle und
   liegen in `localStorage`. Die flexible Spalte („Mod“) ist nicht verbreiterbar.
   Neue Spalten in Durchsuchen: Bewertung, Erstellt, Größe, Abhängigkeiten, Kategorien
   (teils standardmäßig ausgeblendet). Installiert: Downloads, Aktualisiert, Größe, Kategorien.
9. **Sortieren** zusätzlich per Menü in der Werkzeugleiste (Relevanz, Downloads, Bewertung,
   Aktualisiert, Erstellt, Name, Autor, Größe, Abhängigkeiten), gleiche Schlüssel wie die
   Spalten.
10. **Kein Layout-Sprung.** Das Detail-Panel ist immer da (leer: „Mod auswählen“), die
    Trefferzahl hat feste Breite mit Tabellenziffern, Sektionen kollabieren, lange Listen
    zeigen „+ N weitere“, Spaltenbreiten sind fest.
11. **Konsistenz.** Kit bekommt `Toolbar` (eine Höhe, ein Abstand) und `FilterSection`,
    `RangeFilter`, `FilterToken`, `Histogram`, `DetailEmpty`. Zellen nutzen die Utilities
    `cell-mono`, `cell-soft`, `cell-muted` aus `app.css`.
12. **Index-Erweiterung (Rust).** `SlimPkg` bekommt `created`, `nver` und `deps`
    (IDs der Abhängigkeiten der neuesten Version, ohne Version). `AppState` bekommt
    `profileMods` (Profil → Mod-IDs) für den Profil-Filter.
13. **Kontextmenü** der Tabelle: Autor nur anzeigen / ausschließen / alle Mods des Autors
    auswählen, Kategorie ein-/ausschließen (Untermenü), Abhängigkeiten mit auswählen.
14. **Persistenz** der Filterkriterien, Sektionszustände, Spalten und Ansichten in
    `localStorage` unter `werkbank.*`; defensiv gelesen, Fehler ergeben Standardwerte.

## Architektur

```
src/lib/browse/
  criteria.ts        Typen + Standardwerte + (de)serialisierung + Gleichheit        [rein, getestet]
  filter.ts          matchesCriteria, sortPackages, countBy, Facetten-Zähler     [rein, getestet]
  ranges.ts          Bereichs-Operatoren, Histogramm-Buckets, Formatierung      [rein, getestet]
  tokens.ts          Kriterien → Token-Liste, Token-Aktionen                      [rein, getestet]
  views.ts           eingebaute Ansichten, Vergleich                              [rein, getestet]
src/lib/desktop/
  columns.ts         Spalten-Prefs: anwenden, umsortieren, Breite setzen         [rein, getestet]
  storage.ts         localStorage-Wrapper mit JSON und Fallback                   [rein, getestet]
src/lib/components/kit/
  toolbar.svelte, filter-section.svelte, filter-list.svelte, range-filter.svelte,
  histogram.svelte, filter-token.svelte, detail-empty.svelte, data-table.svelte (erweitert)
src/lib/components/app/
  BrowseView.svelte (neu aufgebaut), BrowseFilters.svelte (Seitenleiste), InstalledView.svelte
src/lib/api/store.svelte.ts   BrowseFilters → Kriterien + Prefs + Ansichten
src-tauri/src/thunderstore.rs, commands.rs   Slim-Felder, profileMods
```

Datenfluss: `store.browse.criteria` (Runes) → `matchesCriteria` über `store.packages` →
`sortPackages` → `DataTable`. Facetten-Zähler und Histogramme rechnen über die Treffer
**ohne** die eigene Sektion (`skip`), damit Zahlen und Balken den nächsten Klick vorhersagen.

## Tests

- `criteria.test.ts`: Standardwerte, Round-Trip, Gleichheit, Zähler aktiver Filter.
- `filter.test.ts`: Tri-State-Listen (any/none, Kategorie all/any), Bereiche (alle
  Operatoren, relativ/absolut), Status- und Abhängigkeitsfacetten, Profil-Filter.
- `ranges.test.ts`: Monats- und Log-Buckets, Balken → Bereich, Formatierung.
- `tokens.test.ts`: Token-Erzeugung, Umkehren, Entfernen.
- `columns.test.ts`: Sichtbarkeit, Reihenfolge, Breite, Reset.
- `storage.test.ts`: kaputtes JSON → Standard.
- Gates: `npm test`, `npm run check`, `npm run build`, `cargo test`, `cargo clippy`.
