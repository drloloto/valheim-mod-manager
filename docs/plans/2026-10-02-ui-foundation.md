# UI-Fundament „Werkbank“ — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die App bekommt einen einheitlichen, desktop-optimierten Rahmen nach dem Claude-Design „Werkbank“ (1a). Basis dafür sind Design-Tokens in der Tailwind-Konfiguration, eine eigene Komponenten-Ebene auf shadcn-svelte, eine eigene Titelleiste, Tastatur, Mehrfachauswahl und Kontextmenüs. Alle bestehenden Seiten werden auf diese Ebene umgestellt.

**Architecture:**

- **Tokens:** Alle Farben, Schriften, Radien und Maße stehen als CSS-Variablen in `src/lib/theme.css` und werden in `src/app.css` per `@theme inline` zu Tailwind-Utilities.
- **shadcn-Primitives:** Sie bleiben unter `$lib/components/ui`. Abweichungen vom Design werden zentral in `src/lib/style-desktop.css` überschrieben, nicht in den Komponenten.
- **Kit:** Die neue Ebene `$lib/components/kit` baut auf den Primitives auf (DataTable, Segmented, TriCheckbox, SettingRow …) und re-exportiert die benutzten Primitives.
- **Shell:** `$lib/components/shell` enthält Titelleiste, Werkzeugleiste und Statusleiste.
- **Importregel:** App-Seiten importieren UI nur aus Kit und Shell. Das prüft ein Test.
- **Desktop-Logik:** Auswahl, Virtualisierung, Shortcuts und Browser-Sperren liegen als reine TS-Module unter `src/lib/desktop` und haben Unit-Tests.

**Tech Stack:**

- SvelteKit 2 (SPA) mit Svelte 5 Runes
- Tailwind CSS v4 (CSS-Konfiguration, kein `tailwind.config.js`)
- shadcn-svelte 1.7 (Stil „vega“) auf bits-ui 2
- Tauri 2 mit `tauri-plugin-window-state`
- Vitest
- `@fontsource-variable/archivo` und `@fontsource-variable/jetbrains-mono`

**Spec / Design:**

- Design: `docs/design/2026-10-02-mod-manager-designs.html` (Kopie des Claude-Design-Projekts „Mod Manager Designs“).
  - Maßgeblich ist **1a „Werkbank“** mit Durchsuchen und Einstellungen.
  - Aus **2a** übernimmt dieser Plan nur die Bausteine: Drei-Zustands-Checkbox, Mehrfachauswahl, Auswahlleiste und Kontextmenü.
- Vorgänger-Spec (Funktionsumfang v1): `docs/superpowers/specs/2026-09-26-local-modmanager-design.md`
- Zurückgestellt: P0/git-Hybrid (`docs/superpowers/plans/2026-09-28-p0-storage-foundation.md`)

## Entscheidungen

1. **Der git-Hybrid ist zurückgestellt.** P0 wird nicht umgesetzt; die Ablage bleibt wie in v1. Spec und Plan bleiben als Referenz erhalten.
2. **Es gibt nur ein dunkles Theme.** Das Design ist ausschließlich dunkel. `<html>` trägt fest `class="style-vega dark"`, damit die `dark:`-Varianten der shadcn-Komponenten greifen.
3. **Die Schriften werden lokal gebündelt.** Archivo und JetBrains Mono kommen über Fontsource statt über Google Fonts. So funktioniert die App offline, und es gibt keine externen Requests.
4. **Die App hat eine eigene Titelleiste.** Dafür steht `decorations: false`. Die Titelleiste hat Drag-Region, Doppelklick zum Maximieren und Fensterknöpfe im Windows-Stil. Fenstergröße und -position merkt sich `tauri-plugin-window-state`.
5. **Desktop-Konventionen:**
   - Text ist außerhalb von Eingabefeldern und Log nicht markierbar.
   - Der Cursor bleibt überall der Pfeil (`cursor: default`).
   - Das Browser-Kontextmenü ist aus, außer in Eingabefeldern.
   - Reload, Drucken, Browser-Suche und Zoom sind gesperrt; Reload nur im Release-Build.
   - Bereichsgrößen lassen sich per Drag ändern und werden gespeichert (paneforge `autoSaveId`).
   - Nur einzelne Bereiche scrollen, nie die ganze Seite.
6. **Auswahl wie im Datei-Explorer:**
   - Klick wählt eine Zeile, Strg+Klick schaltet sie um, Shift+Klick wählt einen Bereich.
   - Die Checkbox-Spalte schaltet um. Strg+A, Pfeiltasten, Pos1/Ende und Bild↑/↓ funktionieren, Esc hebt die Auswahl auf, Enter oder Doppelklick öffnen.
   - Ein Rechtsklick auf eine nicht ausgewählte Zeile wählt nur diese Zeile.
   - Das Detail-Panel zeigt die **fokussierte** Zeile, also die zuletzt geklickte.
7. **Navigation:** Durchsuchen, Installiert, Config und Log, rechts Einstellungen. `/profile` heißt jetzt `/installed`.
   - Die Profilaktionen ziehen aus der Profilseite in das Profil-Dropdown der Werkzeugleiste: Neu, Import, Teilen, Export, Umbenennen, Klonen, Ordner, Reparieren und Löschen.
   - Das Paket-Sheet wird durch ein Detail-Panel rechts ersetzt.
8. **Phase 2 bekommt einen eigenen Plan, nicht diesen:**
   - Das Filter-System aus 2a: Listen mit ein- und ausschließenden Einträgen, Bereichsfilter mit Histogramm, Filter-Tokens, Abfragesprache und gespeicherte Ansichten.
   - Der Autoren-Tab aus 2b mit Folgen.
   - Die Log-Fehlermarke im Tab und die Download-Warteschlange mit Restanzahl.
   - Spiel- und BepInEx-Versionen in der Statusleiste: Die Daten liefert das Backend noch nicht.

## Global Constraints

- Texte in Deutsch, Code-Bezeichner in Englisch, Kommentare in Deutsch (wie bisher).
- Svelte 5 Runes. Keine Legacy-Syntax (`export let`, `$:`, `on:click`).
- **Importregel:** Dateien unter `src/routes/**` und `src/lib/components/app/**` importieren **nicht** aus `$lib/components/ui/*`, sondern nur aus `$lib/components/kit` und `$lib/components/shell`. Test: `src/lib/components/kit/boundaries.test.ts` (Task 3).
- **Keine festen Farbwerte** (`oklch(...)`, `#hex`, `rgb(...)`) in `.svelte`-Dateien. Erlaubt sind sie nur in `src/lib/theme.css` und `src/lib/style-desktop.css`. Ausnahme ist der Fenster-Schließen-Hover `#c42b1c` (Windows-Systemfarbe) in `title-bar.svelte`. Test: `boundaries.test.ts`.
- Neue npm-Pakete:
  - `@fontsource-variable/archivo`, `@fontsource-variable/jetbrains-mono`, `vitest` (dev).
  - Die shadcn-Komponenten `context-menu`, `dropdown-menu`, `toggle-group`, `tooltip`, `resizable` und `select` kommen per `npx shadcn-svelte@latest add`. Der Befehl zieht eventuell `paneforge` nach.
- Neue Rust-Abhängigkeit: `tauri-plugin-window-state = "2"`.
- Fenster: Standard 1440×900, mindestens 1100×680, zentriert, `decorations: false`.
- Jede `.svelte`-Datei, die neu ist oder geändert wird, prüft das Svelte-MCP-Tool `svelte-autofixer`, bis keine Probleme mehr gemeldet werden.
- Gate je Task: `npm run check`, `npm run build` und `npm test` (ab Task 3). Bei Rust-Änderungen zusätzlich `cargo clippy --all-targets -- -D warnings` in `src-tauri`.
- Commit-Nachrichten enden mit `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Filter ändern, während weit unten gescrollt ist** (6.844 Zeilen auf 12 Treffer): Die Tabelle zeigt sofort die Treffer statt einer leeren Fläche. Test in Task 3 (`visibleRange clamps scrollTop beyond content`).
2. **Shift+Klick, nachdem der Anker durch einen Filter verschwunden ist:** Es wird nur die geklickte Zeile gewählt, kein Absturz und kein falscher Bereich. Test in Task 3 (`shift-click falls back to single when anchor is gone`).
3. **Rechtsklick auf eine nicht ausgewählte Zeile bei bestehender Mehrfachauswahl:** Das Menü wirkt nur auf diese Zeile. Ein Rechtsklick in die Auswahl wirkt auf alle. Test in Task 3 (`forContext …`).
4. **Strg+A, Strg+C, Strg+V oder Strg+Z im Suchfeld:** Die Tastenkürzel wirken auf den Text, nicht auf die Tabelle, und werden nicht von den Desktop-Sperren geschluckt. Test in Task 3 (`does not block editing shortcuts`).
5. **Schnelles Tippen eines Pfads in den Einstellungen mit Autosave:** Nur der letzte Stand wird gespeichert, und Fehler erscheinen inline statt als Toast-Flut. Test in Task 3 (`debounce runs only the last call`); die Verdrahtung übernimmt Task 10.

---

## Dateistruktur

```
docs/design/2026-10-02-mod-manager-designs.html         (Referenz, schon vorhanden)
package.json, vite.config.ts                             (T1 Fonts; T3 vitest)
src/app.html                                             (T1: class="style-vega dark")
src/app.css                                              (T1: Fonts, @theme-Erweiterungen, Desktop-Basis)
src/lib/theme.css                                        (T1: neu geschrieben, Design-Tokens)
src/lib/style-desktop.css                                (T1: neu, Overrides der shadcn-Klassen)
src-tauri/tauri.conf.json, Cargo.toml, src/lib.rs,
src-tauri/capabilities/default.json                      (T2)
src/lib/desktop/{shortcuts,guards,selection,virtual,debounce}.ts (+ .test.ts)   (T3)
src/lib/api/status.ts (+ .test.ts)                       (T3)
src/lib/format.ts (+ format.test.ts)                     (T3: initials)
src/lib/components/ui/{context-menu,dropdown-menu,toggle-group,tooltip,resizable,select}/  (T3, generiert)
src/lib/components/kit/                                  (T4, T5)
  index.ts, types.ts, boundaries.test.ts (T3)
  section-label, kbd, tri-checkbox, segmented, chip, status-pill, mod-avatar, stat,
  setting-row, stepper, path-field, empty-state, panel-section, split-button,
  confirm-dialog, choice                                 (T4)
  data-table, selection-bar                              (T5)
src/routes/dev/kit/+page.svelte                          (T4/T5: Komponenten-Schaukasten, nur dev)
src/lib/components/shell/{title-bar,top-bar,profile-switcher,nav-tabs,play-button,status-bar}.svelte (T2, T6)
src/routes/+layout.svelte                                (T6)
src/routes/installed/+page.svelte (neu), src/routes/profile/ (entfällt)        (T6)
src/lib/api/store.svelte.ts                              (T6, T7, T8, T10)
src/lib/browse/filter.ts (+ .test.ts)                    (T7)
src/lib/components/app/BrowseView.svelte, PackageDetail.svelte                  (T7)
src/lib/components/app/InstalledView.svelte                                     (T8)
src/lib/components/app/ConfigView.svelte, LogView.svelte                        (T9)
src/lib/components/app/SettingsView.svelte                                      (T10)
Entfällt (T11): ModsTab, ProfileView, PackageSheet, ConfigTab, SyncIndicator,
  ui/{card,native-select,sheet,tabs,badge}
README.md                                                (T11)
```

---

### Task 1: Design-Tokens, Schriften, Desktop-Basis-CSS

**Files:**

- Modify: `package.json` (Abhängigkeiten über npm)
- Modify: `src/app.html`
- Rewrite: `src/lib/theme.css`
- Modify: `src/app.css`
- Create: `src/lib/style-desktop.css`

**Interfaces:**

- Produces (Tailwind-Utilities, die alle späteren Tasks nutzen):
  - **Farben:** `bg-chrome`, `bg-panel`, `bg-hover`, `bg-field`, `bg-raised`, `bg-selected`, `bg-focused`, `bg-muted`, `border-line-subtle`, `border-border`, `border-input`, `border-line-strong`.
  - **Text:** `text-foreground`, `text-foreground-soft`, `text-muted-foreground`, `text-subtle-foreground`.
  - **Primärfarbe:** `bg-primary`, `bg-primary-hover`, `text-primary-foreground`, `bg-primary-soft`, `bg-primary-tint`, `text-primary-text`, `border-primary-line`.
  - **Statusfarben:** `text-success`, `bg-success`, `text-destructive`, `text-destructive-text`, `text-info`, `bg-info-soft`, `border-info-line`.
  - **Maße:** `h-titlebar` (32), `h-toolbar` (52), `h-statusbar` (28), `h-control` (34), `h-control-sm` (28), `w-label` (220).
  - **Schriftgrößen:** `text-2xs` (10.5px), `text-meta` (11px), `text-sm` (13px), `text-row` (13.5px).
  - **Utility** `label-caps` (Mono, 10.5px, Großbuchstaben, gesperrt, gedämpft).
  - **Schriften:** `font-sans` (Archivo), `font-mono` (JetBrains Mono).

- [ ] **Step 1: Schriften installieren**

Run: `npm i @fontsource-variable/archivo @fontsource-variable/jetbrains-mono`
Expected: Beide Pakete stehen unter `dependencies`.

- [ ] **Step 2: `src/app.html` auf festes Dark-Theme stellen**

Ersetze `<html lang="de" class="style-vega">` durch:

```html
<html lang="de" class="style-vega dark"></html>
```

Ersetze außerdem `<body data-sveltekit-preload-data="hover">` durch `<body>`. Preload beim Hover bringt in einer SPA ohne Server-Loads nichts.

- [ ] **Step 3: `src/lib/theme.css` vollständig ersetzen**

```css
/*
 * Design-Tokens „Werkbank“ (docs/design/2026-10-02-mod-manager-designs.html, 1a/2a/2b).
 * Nur dunkel. Warmes Neutral (Hue 60–80), Bernstein als einzige Akzentfarbe.
 * Feste Farbwerte gehören ausschließlich hierher (und in style-desktop.css).
 */
:root {
	color-scheme: dark;

	--font-sans: "Archivo Variable", "Archivo", system-ui, sans-serif;
	--font-mono: "JetBrains Mono Variable", "JetBrains Mono", ui-monospace, monospace;
	--radius: 6px;

	/* Flächen, von außen nach innen */
	--chrome: oklch(0.14 0.005 60); /* Titel- und Statusleiste */
	--background: oklch(0.17 0.005 60); /* Arbeitsfläche */
	--panel: oklch(0.19 0.005 60); /* Werkzeugleiste, Detail-Panel */
	--hover: oklch(0.2 0.005 60);
	--field: oklch(0.21 0.005 60); /* Eingabefelder, Segment-Hintergrund */
	--raised: oklch(0.22 0.006 60); /* Popover, Menüs, Profilwahl */
	--selected: oklch(0.23 0.025 70); /* ausgewählte Zeile */
	--focused: oklch(0.24 0.012 70); /* fokussierte Zeile (Detail offen) */
	--muted: oklch(0.27 0.006 60); /* aktiver Tab, Segment an */

	/* Linien */
	--line-subtle: oklch(0.24 0.005 60); /* Zeilentrenner */
	--border: oklch(0.29 0.006 60); /* Bereichsgrenzen */
	--input: oklch(0.32 0.006 60); /* Feldrahmen */
	--line-strong: oklch(0.36 0.006 60); /* Outline-Buttons, Menürahmen */
	--checkbox-line: oklch(0.42 0.006 60);

	/* Text */
	--foreground: oklch(0.94 0.006 80);
	--foreground-soft: oklch(0.8 0.008 75);
	--muted-foreground: oklch(0.62 0.01 70);
	--subtle-foreground: oklch(0.56 0.01 70);

	/* Bernstein: Spielen, Auswahl, Updates, Fokus */
	--primary: oklch(0.78 0.14 70);
	--primary-hover: oklch(0.72 0.14 70);
	--primary-foreground: oklch(0.2 0.02 60);
	--primary-soft: oklch(0.3 0.03 70); /* Menü-Hover, Profil-Avatar */
	--primary-tint: oklch(0.26 0.02 70); /* aktiver Chip */
	--primary-text: oklch(0.9 0.06 70); /* Text auf Tint */
	--primary-line: oklch(0.42 0.07 70);
	--primary-edge: oklch(0.6 0.12 70); /* Trenner im Split-Button */
	--selection-bar: oklch(0.24 0.012 70);

	/* Status */
	--success: oklch(0.78 0.14 150);
	--destructive: oklch(0.64 0.18 25);
	--destructive-text: oklch(0.72 0.1 25);
	--info: oklch(0.72 0.12 235);
	--info-soft: oklch(0.21 0.02 235);
	--info-line: oklch(0.36 0.05 235);

	/* Schatten */
	--shadow-menu: 0 12px 32px rgb(0 0 0 / 0.55);
	--shadow-float: 0 10px 28px rgb(0 0 0 / 0.5);

	/* Zuordnung auf die shadcn-Variablen */
	--card: var(--panel);
	--card-foreground: var(--foreground);
	--popover: var(--raised);
	--popover-foreground: var(--foreground);
	--secondary: var(--muted);
	--secondary-foreground: var(--foreground);
	--accent: var(--primary-soft);
	--accent-foreground: var(--foreground);
	--destructive-foreground: var(--destructive-text);
	--ring: oklch(0.6 0.1 70);
	--surface: var(--panel);
	--surface-foreground: var(--foreground-soft);
	--selection: var(--primary-line);
	--selection-foreground: var(--foreground);
	--code: var(--field);
	--code-foreground: var(--foreground-soft);
	--code-highlight: var(--muted);
	--code-number: var(--subtle-foreground);
	--sidebar: var(--panel);
	--sidebar-foreground: var(--foreground);
	--sidebar-primary: var(--primary);
	--sidebar-primary-foreground: var(--primary-foreground);
	--sidebar-accent: var(--muted);
	--sidebar-accent-foreground: var(--foreground);
	--sidebar-border: var(--border);
	--sidebar-ring: var(--ring);
	--chart-1: var(--primary);
	--chart-2: var(--success);
	--chart-3: var(--info);
	--chart-4: var(--destructive);
	--chart-5: var(--muted-foreground);
}
```

- [ ] **Step 4: `src/lib/style-desktop.css` anlegen**

Vorher prüfen, ob es alle Klassennamen gibt: `grep -o "\.cn-[a-z-]*" src/lib/style-vega.css | sort -u`. Muss jede unten benutzte `cn-*`-Klasse ausgeben. Fehlt eine, wird die Regel weggelassen.

```css
/*
 * Desktop-Overrides für shadcn-svelte (Stil vega). Gleiche Spezifität wie style-vega.css,
 * daher gewinnt diese Datei durch die spätere Einbindung. Generierte Komponenten bleiben unverändert.
 */
.style-vega {
	/* Buttons: dicht, kein „Eindrücken“, Pfeil-Cursor */
	.cn-button {
		@apply cursor-default text-[13px] shadow-none active:not-aria-[haspopup]:translate-y-0;
	}
	.cn-button-variant-default {
		@apply hover:bg-primary-hover font-bold;
	}
	.cn-button-variant-outline {
		@apply border-line-strong hover:bg-muted dark:border-line-strong dark:hover:bg-muted bg-transparent shadow-none dark:bg-transparent;
	}
	.cn-button-variant-ghost {
		@apply text-foreground-soft hover:bg-muted hover:text-foreground dark:hover:bg-muted;
	}
	.cn-button-variant-secondary {
		@apply bg-muted hover:bg-line-strong;
	}
	.cn-button-size-default {
		@apply h-control rounded-md px-3;
	}
	.cn-button-size-sm {
		@apply h-control-sm rounded-[5px] px-2.5;
	}
	.cn-button-size-lg {
		@apply h-9 rounded-md px-4.5 text-sm;
	}
	.cn-button-size-icon {
		@apply size-control rounded-md;
	}
	.cn-button-size-icon-sm {
		@apply size-control-sm rounded-[5px];
	}

	/* Eingaben */
	.cn-input {
		@apply h-control bg-field dark:bg-field border-input rounded-md text-sm shadow-none md:text-sm;
	}
	.cn-checkbox {
		@apply border-checkbox-line size-3.5 rounded-[3px] shadow-none dark:bg-transparent;
	}
	.cn-switch {
		@apply shadow-none;
	}
	.cn-select-trigger {
		@apply h-control bg-field dark:bg-field dark:hover:bg-field border-input text-sm shadow-none;
	}

	/* Menüs und Popover */
	.cn-context-menu-content,
	.cn-dropdown-menu-content,
	.cn-select-content {
		@apply border-line-strong bg-raised rounded-lg border p-[5px] shadow-(--shadow-menu) ring-0;
	}
	.cn-context-menu-item,
	.cn-dropdown-menu-item,
	.cn-dropdown-menu-radio-item,
	.cn-select-item {
		@apply focus:bg-primary-soft h-[30px] cursor-default rounded-[5px] py-0 text-[13px];
	}
	.cn-context-menu-label,
	.cn-dropdown-menu-label {
		@apply label-caps px-2.5 pt-1.5 pb-2;
	}
	.cn-context-menu-shortcut,
	.cn-dropdown-menu-shortcut {
		@apply text-subtle-foreground text-meta font-mono tracking-normal;
	}
	.cn-context-menu-separator,
	.cn-dropdown-menu-separator {
		@apply bg-border mx-1.5 my-1;
	}
	.cn-tooltip-content {
		@apply bg-raised text-foreground border-line-strong border text-xs;
	}

	/* Dialoge */
	.cn-dialog-content {
		@apply bg-panel ring-line-strong rounded-lg;
	}
	.cn-dialog-overlay {
		@apply bg-black/50;
	}
}
```

- [ ] **Step 5: `src/app.css` erweitern**

Den Dateianfang bis einschließlich `@custom-variant dark …` ersetzen durch:

```css
@import "@fontsource-variable/archivo";
@import "@fontsource-variable/jetbrains-mono";
@import "tailwindcss";
@import "tw-animate-css";
@import "shadcn-svelte/tailwind.css";
@import "./lib/style-vega.css" layer(base);
@import "./lib/style-desktop.css" layer(base);
@import "./lib/theme.css";

@custom-variant style-vega (&:where(.style-vega *));
@custom-variant dark (&:is(.dark *));
```

Im Block `@theme inline { … }` direkt vor die schließende `}` einfügen:

```css
/* Werkbank-Flächen und -Linien */
--color-chrome: var(--chrome);
--color-panel: var(--panel);
--color-hover: var(--hover);
--color-field: var(--field);
--color-raised: var(--raised);
--color-selected: var(--selected);
--color-focused: var(--focused);
--color-line-subtle: var(--line-subtle);
--color-line-strong: var(--line-strong);
--color-checkbox-line: var(--checkbox-line);
--color-foreground-soft: var(--foreground-soft);
--color-subtle-foreground: var(--subtle-foreground);
--color-primary-hover: var(--primary-hover);
--color-primary-soft: var(--primary-soft);
--color-primary-tint: var(--primary-tint);
--color-primary-text: var(--primary-text);
--color-primary-line: var(--primary-line);
--color-primary-edge: var(--primary-edge);
--color-selection-bar: var(--selection-bar);
--color-success: var(--success);
--color-destructive-text: var(--destructive-text);
--color-info: var(--info);
--color-info-soft: var(--info-soft);
--color-info-line: var(--info-line);

/* Dichte Desktop-Typografie */
--text-2xs: 10.5px;
--text-2xs--line-height: 1.2;
--text-meta: 11px;
--text-meta--line-height: 1.3;
--text-sm: 13px;
--text-sm--line-height: 1.45;
--text-row: 13.5px;
--text-row--line-height: 1.35;

/* Feste Desktop-Maße (h-titlebar, h-control, w-label …) */
--spacing-titlebar: 32px;
--spacing-toolbar: 52px;
--spacing-statusbar: 28px;
--spacing-control: 34px;
--spacing-control-sm: 28px;
--spacing-label: 220px;
```

Den Block `@layer base { … }` vollständig ersetzen durch:

```css
@utility label-caps {
	font-family: var(--font-mono);
	font-size: 10.5px;
	font-weight: 500;
	letter-spacing: 0.08em;
	text-transform: uppercase;
	color: var(--subtle-foreground);
}

@layer base {
	* {
		@apply border-border outline-ring/50;
		scrollbar-width: thin;
		scrollbar-color: var(--line-strong) transparent;
	}

	::selection {
		@apply bg-selection text-selection-foreground;
	}

	/* Desktop: keine Seiten-Scrolls, kein Gummiband, Pfeil-Cursor, Text nur gezielt markierbar */
	html,
	body {
		@apply h-full overflow-hidden overscroll-none;
	}

	body {
		@apply bg-background text-foreground cursor-default font-sans text-sm antialiased select-none;
	}

	input,
	textarea,
	[contenteditable="true"],
	.selectable {
		@apply select-text;
	}

	img {
		-webkit-user-drag: none;
	}

	a,
	button,
	[role="button"] {
		cursor: default;
	}
}
```

- [ ] **Step 6: Gate**

Run: `npm run check` und danach `npm run build`
Expected: Beides ohne Fehler. Meldet `build` „Cannot apply unknown utility class“, fehlt eine Utility in `@theme inline`: Name abgleichen und nachtragen.

- [ ] **Step 7: Sichtprüfung**

Run: `npm run tauri dev`
Expected:

- Der Hintergrund ist dunkel und warm, Buttons und Links sind bernsteinfarben.
- Die Schrift ist Archivo (das „g“ hat einen offenen Bogen).
- Text lässt sich nicht markieren, außer in Eingabefeldern.
- Das Layout ist noch das alte. Das ist hier richtig.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json src/app.html src/app.css src/lib/theme.css src/lib/style-desktop.css
git commit -m "feat(ui): Werkbank design tokens, bundled fonts and desktop base styles

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Fenster: eigene Titelleiste und gespeicherter Fensterzustand

**Files:**

- Modify: `src-tauri/tauri.conf.json`
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/lib.rs:25-28`
- Modify: `src-tauri/capabilities/default.json`
- Create: `src/lib/components/shell/title-bar.svelte`
- Modify: `src/routes/+layout.svelte` (nur die Titelleiste einbinden)

**Interfaces:**

- Produces: `<TitleBar />` ohne Props, 32px hoch, mit Drag-Region.

- [ ] **Step 1: Fensterkonfiguration**

In `src-tauri/tauri.conf.json` das Objekt in `app.windows[0]` ersetzen durch:

```json
{
	"label": "main",
	"title": "Valheim Mod Manager",
	"width": 1440,
	"height": 900,
	"minWidth": 1100,
	"minHeight": 680,
	"center": true,
	"decorations": false,
	"shadow": true
}
```

- [ ] **Step 2: Window-State-Plugin**

In `src-tauri/Cargo.toml` unter `[dependencies]` nach `tauri-plugin-clipboard-manager = "2"` ergänzen:

```toml
tauri-plugin-window-state = "2"
```

In `src-tauri/src/lib.rs` nach `.plugin(tauri_plugin_clipboard_manager::init())` ergänzen:

```rust
        // Fenstergröße, -position und Maximiert-Zustand über Neustarts hinweg merken.
        .plugin(tauri_plugin_window_state::Builder::default().build())
```

- [ ] **Step 3: Rechte**

`src-tauri/capabilities/default.json` → `permissions` ersetzen durch:

```json
[
	"core:default",
	"core:window:allow-start-dragging",
	"core:window:allow-minimize",
	"core:window:allow-toggle-maximize",
	"core:window:allow-close",
	"opener:default",
	"dialog:default",
	"clipboard-manager:allow-write-text",
	"window-state:default"
]
```

- [ ] **Step 4: Rust-Gate**

Run: `cd src-tauri && cargo clippy --all-targets -- -D warnings`
Expected: Keine Warnungen.

- [ ] **Step 5: `src/lib/components/shell/title-bar.svelte`**

```svelte
<script lang="ts">
	import { onMount } from "svelte";
	import { getCurrentWindow } from "@tauri-apps/api/window";
	import Minus from "@lucide/svelte/icons/minus";
	import Square from "@lucide/svelte/icons/square";
	import Copy from "@lucide/svelte/icons/copy";
	import X from "@lucide/svelte/icons/x";

	const win = getCurrentWindow();
	let maximized = $state(false);

	onMount(() => {
		let unlisten: (() => void) | undefined;
		let disposed = false;
		const sync = () => win.isMaximized().then((m) => (maximized = m));
		sync();
		win.onResized(sync).then((u) => {
			if (disposed) u();
			else unlisten = u;
		});
		return () => {
			disposed = true;
			unlisten?.();
		};
	});
</script>

<!-- data-tauri-drag-region wirkt nur auf das Element selbst, daher auch auf den Kindern. Doppelklick maximiert. -->
<header data-tauri-drag-region class="bg-chrome text-muted-foreground h-titlebar flex shrink-0 items-center text-xs">
	<div data-tauri-drag-region class="flex items-center gap-2 pl-3.5">
		<span data-tauri-drag-region class="bg-primary size-3.5 rounded-[3px]"></span>
		<span data-tauri-drag-region>Valheim Mod Manager</span>
	</div>
	<div data-tauri-drag-region class="flex-1 self-stretch"></div>
	<div class="flex self-stretch">
		<button class="win-btn" aria-label="Minimieren" onclick={() => win.minimize()}><Minus class="size-3.5" /></button>
		<button class="win-btn" aria-label={maximized ? "Wiederherstellen" : "Maximieren"} onclick={() => win.toggleMaximize()}>
			{#if maximized}<Copy class="size-3 -scale-x-100" />{:else}<Square class="size-3" />{/if}
		</button>
		<button class="win-btn win-close" aria-label="Schließen" onclick={() => win.close()}><X class="size-4" /></button>
	</div>
</header>

<style>
	.win-btn {
		display: flex;
		width: 46px;
		align-items: center;
		justify-content: center;
		color: var(--muted-foreground);
	}
	.win-btn:hover {
		background: var(--muted);
		color: var(--foreground);
	}
	/* Windows-Systemfarbe für „Schließen“ */
	.win-close:hover {
		background: #c42b1c;
		color: white;
	}
</style>
```

- [ ] **Step 6: In `+layout.svelte` einbinden**

Import ergänzen: `import TitleBar from "$lib/components/shell/title-bar.svelte";`. Dann `<TitleBar />` als erstes Kind von `<div class="flex h-screen flex-col">` einsetzen. Den Rest des Layouts ersetzt Task 6.

- [ ] **Step 7: autofixer und Gate**

`svelte-autofixer` auf `title-bar.svelte` anwenden. Danach `npm run check` und `npm run build`.

- [ ] **Step 8: Manuelle Prüfung**

Run: `npm run tauri dev`
Expected:

- Es gibt keinen nativen Rahmen mehr. Die Titelleiste lässt sich ziehen, Doppelklick maximiert und stellt wieder her.
- Die drei Knöpfe funktionieren, „Schließen“ wird beim Hover rot.
- Windows-Snap per Win+Pfeil und das Ziehen an den Bildschirmrand funktionieren.
- Nach Größenänderung und Neustart öffnet das Fenster in derselben Größe und Position.

- [ ] **Step 9: Commit**

```bash
git add src-tauri/tauri.conf.json src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/lib.rs src-tauri/capabilities/default.json src/lib/components/shell/title-bar.svelte src/routes/+layout.svelte
git commit -m "feat(desktop): custom title bar and persisted window state

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Desktop-Logik als reine Module, Tests, shadcn-Primitives, Importregel

**Files:**

- Modify: `package.json` (vitest, Skript `test`), `vite.config.ts`
- Create: `src/lib/desktop/shortcuts.ts`, `shortcuts.test.ts`
- Create: `src/lib/desktop/guards.ts`, `guards.test.ts`
- Create: `src/lib/desktop/selection.ts`, `selection.test.ts`
- Create: `src/lib/desktop/virtual.ts`, `virtual.test.ts`
- Create: `src/lib/desktop/debounce.ts`, `debounce.test.ts`
- Create: `src/lib/api/status.ts`, `status.test.ts`
- Modify: `src/lib/format.ts`; Create: `src/lib/format.test.ts`
- Generate: `src/lib/components/ui/{context-menu,dropdown-menu,toggle-group,tooltip,resizable,select}`
- Create: `src/lib/components/kit/boundaries.test.ts`

**Interfaces:**

- Produces:
  - `shortcuts.ts`:
    - `interface KeyLike { key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }`
    - `parseCombo(combo: string): Combo`, wobei `Combo = { key: string; mod: boolean; shift: boolean; alt: boolean }`.
    - `matches(e: KeyLike, combo: string, mac?: boolean): boolean`
    - `bindShortcuts(map: Record<string, (e: KeyboardEvent) => void>, target?: Window): () => void`
    - `isEditable(t: EventTarget | null): boolean`
  - `guards.ts`: `shouldBlockKey(e: KeyLike, dev: boolean): boolean`, `installDesktopGuards(dev?: boolean): () => void`.
  - `selection.ts`:
    - `interface Selection { ids: ReadonlySet<string>; anchor: string | null; focus: string | null }`
    - `emptySelection`
    - `click(sel, order, id, { shift, toggle })`
    - `selectAll(sel, order)`
    - `clear(sel)`
    - `forContext(sel, id)`
    - `move(sel, order, delta, extend)`
    - `prune(sel, order)`
  - `virtual.ts`: `visibleRange(scrollTop, viewport, rowHeight, count, overscan?): { start: number; end: number }`, `scrollToReveal(index, rowHeight, scrollTop, viewport): number`.
  - `debounce.ts`: `debounce<A extends unknown[]>(fn: (...a: A) => void, ms: number): ((...a: A) => void) & { cancel(): void; flush(): void }`.
  - `status.ts`: `type ModStatus = "update" | "inProfile" | "disabled" | "dependency" | "none"`, `modStatus(id: string, s: StatusInput): ModStatus`.
  - `format.ts`: neu `initials(name: string): string`.

- [ ] **Step 1: Vitest einrichten**

Run: `npm i -D vitest`

In `package.json` unter `scripts` ergänzen: `"test": "vitest run"`.

In `vite.config.ts` die Import-Zeile `import { defineConfig } from "vite";` ersetzen durch `import { defineConfig } from "vitest/config";`. Im Konfigurationsobjekt nach `envPrefix` ergänzen:

```ts
	test: {
		include: ["src/**/*.test.ts"],
		environment: "node",
	},
```

- [ ] **Step 2: Fehlschlagende Tests schreiben**

`src/lib/desktop/shortcuts.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { matches, parseCombo } from "./shortcuts";

const key = (k: string, m: Partial<{ ctrl: boolean; meta: boolean; shift: boolean; alt: boolean }> = {}) => ({
	key: k,
	ctrlKey: !!m.ctrl,
	metaKey: !!m.meta,
	shiftKey: !!m.shift,
	altKey: !!m.alt,
});

describe("parseCombo", () => {
	it("parses modifiers and key", () => {
		expect(parseCombo("Mod+Shift+R")).toEqual({ key: "R", mod: true, shift: true, alt: false });
		expect(parseCombo("F5")).toEqual({ key: "F5", mod: false, shift: false, alt: false });
	});
});

describe("matches", () => {
	it("maps Mod to Ctrl on Windows and Meta on Mac", () => {
		expect(matches(key("k", { ctrl: true }), "Mod+K", false)).toBe(true);
		expect(matches(key("k", { meta: true }), "Mod+K", true)).toBe(true);
		expect(matches(key("k", { meta: true }), "Mod+K", false)).toBe(false);
	});
	it("requires exact modifiers", () => {
		expect(matches(key("r", { ctrl: true, shift: true }), "Mod+R", false)).toBe(false);
		expect(matches(key("R", { ctrl: true, shift: true }), "Mod+Shift+R", false)).toBe(true);
	});
	it("supports named keys", () => {
		expect(matches(key("+", { ctrl: true }), "Mod+Plus", false)).toBe(true);
		expect(matches(key(",", { ctrl: true }), "Mod+,", false)).toBe(true);
		expect(matches(key("Enter", { ctrl: true }), "Mod+Enter", false)).toBe(true);
	});
});
```

`src/lib/desktop/guards.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { shouldBlockKey } from "./guards";

const k = (key: string, ctrl = false, shift = false) => ({ key, ctrlKey: ctrl, metaKey: false, shiftKey: shift, altKey: false });

describe("shouldBlockKey", () => {
	it("blocks reload, print, find and zoom in release", () => {
		for (const e of [k("F5"), k("r", true), k("R", true, true), k("p", true), k("f", true), k("+", true), k("-", true), k("0", true)]) {
			expect(shouldBlockKey(e, false)).toBe(true);
		}
	});
	it("allows reload and devtools in dev", () => {
		expect(shouldBlockKey(k("F5"), true)).toBe(false);
		expect(shouldBlockKey(k("r", true), true)).toBe(false);
		expect(shouldBlockKey(k("I", true, true), true)).toBe(false);
	});
	it("does not block editing shortcuts", () => {
		for (const c of ["a", "c", "v", "x", "z", "y"]) expect(shouldBlockKey(k(c, true), false)).toBe(false);
	});
});
```

`src/lib/desktop/selection.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { clear, click, emptySelection, forContext, move, prune, selectAll } from "./selection";

const order = ["a", "b", "c", "d", "e"];
const ids = (s: { ids: ReadonlySet<string> }) => [...s.ids].sort();
const plain = { shift: false, toggle: false };

describe("click", () => {
	it("plain click selects only the row and sets anchor and focus", () => {
		const s = click({ ids: new Set(["a", "b"]), anchor: "a", focus: "b" }, order, "c", plain);
		expect(ids(s)).toEqual(["c"]);
		expect(s.anchor).toBe("c");
		expect(s.focus).toBe("c");
	});
	it("toggle click adds and removes", () => {
		let s = click(emptySelection, order, "a", plain);
		s = click(s, order, "c", { shift: false, toggle: true });
		expect(ids(s)).toEqual(["a", "c"]);
		s = click(s, order, "a", { shift: false, toggle: true });
		expect(ids(s)).toEqual(["c"]);
	});
	it("shift click selects the range from the anchor, in both directions", () => {
		let s = click(emptySelection, order, "b", plain);
		s = click(s, order, "d", { shift: true, toggle: false });
		expect(ids(s)).toEqual(["b", "c", "d"]);
		expect(s.anchor).toBe("b");
		s = click(s, order, "a", { shift: true, toggle: false });
		expect(ids(s)).toEqual(["a", "b"]);
	});
	it("ctrl+shift click adds the range to the existing selection", () => {
		let s = click(emptySelection, order, "a", plain);
		s = click(s, order, "c", { shift: false, toggle: true });
		s = click(s, order, "e", { shift: true, toggle: true });
		expect(ids(s)).toEqual(["a", "c", "d", "e"]);
	});
	it("shift-click falls back to single when anchor is gone", () => {
		const s = click({ ids: new Set(["x"]), anchor: "x", focus: "x" }, order, "c", { shift: true, toggle: false });
		expect(ids(s)).toEqual(["c"]);
		expect(s.anchor).toBe("c");
	});
});

describe("forContext", () => {
	it("keeps the selection when right-clicking inside it", () => {
		const sel = { ids: new Set(["a", "b"]), anchor: "a", focus: "a" };
		const s = forContext(sel, "b");
		expect(ids(s)).toEqual(["a", "b"]);
		expect(s.focus).toBe("b");
	});
	it("replaces the selection when right-clicking outside it", () => {
		const s = forContext({ ids: new Set(["a", "b"]), anchor: "a", focus: "a" }, "d");
		expect(ids(s)).toEqual(["d"]);
	});
});

describe("move", () => {
	it("moves focus and selection, clamped to the list", () => {
		let s = click(emptySelection, order, "d", plain);
		s = move(s, order, 1, false);
		expect(s.focus).toBe("e");
		s = move(s, order, 1, false);
		expect(s.focus).toBe("e");
		s = move(s, order, -10, false);
		expect(ids(s)).toEqual(["a"]);
	});
	it("starts at the first row without focus", () => {
		expect(move(emptySelection, order, 1, false).focus).toBe("a");
		expect(move(emptySelection, order, -1, false).focus).toBe("e");
	});
	it("extends from the anchor with shift", () => {
		let s = click(emptySelection, order, "b", plain);
		s = move(s, order, 2, true);
		expect(ids(s)).toEqual(["b", "c", "d"]);
		expect(s.anchor).toBe("b");
	});
	it("returns the same object for an empty list", () => {
		expect(move(emptySelection, [], 1, false)).toBe(emptySelection);
	});
});

describe("selectAll / clear / prune", () => {
	it("selects all and keeps focus", () => {
		const s = selectAll({ ids: new Set(), anchor: null, focus: "c" }, order);
		expect(ids(s)).toEqual(order);
		expect(s.focus).toBe("c");
	});
	it("clear keeps focus so the detail panel stays", () => {
		const s = clear({ ids: new Set(["a"]), anchor: "a", focus: "a" });
		expect(s.ids.size).toBe(0);
		expect(s.focus).toBe("a");
	});
	it("prune drops vanished rows and returns the same object when nothing changed", () => {
		const sel = { ids: new Set(["a", "x"]), anchor: "x", focus: "x" };
		const s = prune(sel, order);
		expect(ids(s)).toEqual(["a"]);
		expect(s.anchor).toBeNull();
		expect(s.focus).toBeNull();
		expect(prune(s, order)).toBe(s);
	});
});
```

`src/lib/desktop/virtual.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { scrollToReveal, visibleRange } from "./virtual";

describe("visibleRange", () => {
	it("returns the rows in view plus overscan", () => {
		expect(visibleRange(500, 300, 50, 1000, 2)).toEqual({ start: 8, end: 18 });
	});
	it("is empty for no rows", () => {
		expect(visibleRange(0, 300, 50, 0)).toEqual({ start: 0, end: 0 });
	});
	it("visibleRange clamps scrollTop beyond content", () => {
		// Filter hat 6844 → 12 Zeilen reduziert, scrollTop steht noch weit unten
		expect(visibleRange(300_000, 400, 50, 12, 2)).toEqual({ start: 2, end: 12 });
	});
});

describe("scrollToReveal", () => {
	it("scrolls up, down or not at all", () => {
		expect(scrollToReveal(2, 50, 200, 300)).toBe(100);
		expect(scrollToReveal(10, 50, 0, 300)).toBe(250);
		expect(scrollToReveal(5, 50, 200, 300)).toBe(200);
	});
});
```

`src/lib/desktop/debounce.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { debounce } from "./debounce";

describe("debounce", () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it("debounce runs only the last call", () => {
		const fn = vi.fn();
		const d = debounce(fn, 500);
		d("C:");
		d("C:\\Ste");
		d("C:\\Steam");
		vi.advanceTimersByTime(499);
		expect(fn).not.toHaveBeenCalled();
		vi.advanceTimersByTime(1);
		expect(fn).toHaveBeenCalledTimes(1);
		expect(fn).toHaveBeenCalledWith("C:\\Steam");
	});
	it("flush runs pending immediately, cancel drops it", () => {
		const fn = vi.fn();
		const d = debounce(fn, 500);
		d(1);
		d.flush();
		expect(fn).toHaveBeenCalledWith(1);
		d(2);
		d.cancel();
		vi.advanceTimersByTime(1000);
		expect(fn).toHaveBeenCalledTimes(1);
	});
});
```

`src/lib/api/status.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { modStatus } from "./status";

const base = {
	mods: new Map([
		["A-Mod", { enabled: true }],
		["B-Off", { enabled: false }],
	]),
	updates: { "A-Mod": "2.0.0" },
	resolved: { "C-Dep": {} },
};

describe("modStatus", () => {
	it("prefers update over in-profile", () => expect(modStatus("A-Mod", base)).toBe("update"));
	it("reports disabled mods", () => expect(modStatus("B-Off", base)).toBe("disabled"));
	it("reports automatic dependencies", () => expect(modStatus("C-Dep", base)).toBe("dependency"));
	it("reports none otherwise", () => expect(modStatus("D-X", { ...base, resolved: undefined })).toBe("none"));
	it("reports in-profile", () => expect(modStatus("A-Mod", { ...base, updates: {} })).toBe("inProfile"));
});
```

`src/lib/format.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { initials } from "./format";

describe("initials", () => {
	it("uses capitals", () => {
		expect(initials("EpicLoot")).toBe("EL");
		expect(initials("Hardcore-Server")).toBe("HS");
		expect(initials("BepInExPack_Valheim")).toBe("BI");
	});
	it("falls back to the first two letters", () => {
		expect(initials("default")).toBe("DE");
		expect(initials("x")).toBe("X");
	});
});
```

- [ ] **Step 3: Tests laufen lassen, Fehlschlag prüfen**

Run: `npm test`
Expected: FAIL, weil die Module fehlen (`Failed to resolve import "./shortcuts"` usw.).

- [ ] **Step 4: Module implementieren**

`src/lib/desktop/shortcuts.ts`:

```ts
// Tastenkürzel im Desktop-Stil. „Mod“ = Strg (Windows/Linux) bzw. Cmd (macOS).

export interface KeyLike {
	key: string;
	ctrlKey: boolean;
	metaKey: boolean;
	shiftKey: boolean;
	altKey: boolean;
}

export interface Combo {
	key: string;
	mod: boolean;
	shift: boolean;
	alt: boolean;
}

const IS_MAC = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform);
const NAMED: Record<string, string> = { Plus: "+", Space: " " };

export function parseCombo(combo: string): Combo {
	const parts = combo.split("+");
	const key = parts.pop() ?? "";
	return { key, mod: parts.includes("Mod"), shift: parts.includes("Shift"), alt: parts.includes("Alt") };
}

export function matches(e: KeyLike, combo: string, mac = IS_MAC): boolean {
	const c = parseCombo(combo);
	const mod = mac ? e.metaKey : e.ctrlKey;
	if (mod !== c.mod || e.shiftKey !== c.shift || e.altKey !== c.alt) return false;
	return e.key.toLowerCase() === (NAMED[c.key] ?? c.key).toLowerCase();
}

export function isEditable(t: EventTarget | null): boolean {
	return t instanceof HTMLElement && (t.isContentEditable || t.closest("input, textarea, select") !== null);
}

/**
 * Registriert app-weite Kürzel. In Eingabefeldern greifen nur Kürzel mit Mod oder F-Tasten,
 * damit normales Tippen und Esc im Feld unberührt bleiben.
 */
export function bindShortcuts(map: Record<string, (e: KeyboardEvent) => void>, target: Window = window): () => void {
	const onKey = (e: KeyboardEvent) => {
		if (e.isComposing) return;
		for (const [combo, fn] of Object.entries(map)) {
			if (!matches(e, combo)) continue;
			const c = parseCombo(combo);
			if (isEditable(e.target) && !c.mod && !/^F\d+$/.test(c.key)) continue;
			e.preventDefault();
			fn(e);
			return;
		}
	};
	target.addEventListener("keydown", onKey);
	return () => target.removeEventListener("keydown", onKey);
}
```

`src/lib/desktop/guards.ts`:

```ts
// Unterdrückt Browser-Verhalten, das in einer Desktop-App fehl am Platz ist.
import { isEditable, matches, type KeyLike } from "./shortcuts";

const ALWAYS = ["Mod+P", "Mod+F", "Mod+G", "Mod+U", "Mod+J", "Mod+Plus", "Mod+=", "Mod+-", "Mod+0"];
const RELEASE_ONLY = ["F5", "Mod+R", "Mod+Shift+R", "Mod+Shift+I", "F12"];

export function shouldBlockKey(e: KeyLike, dev: boolean): boolean {
	const list = dev ? ALWAYS : [...ALWAYS, ...RELEASE_ONLY];
	return list.some((c) => matches(e, c));
}

export function installDesktopGuards(dev = import.meta.env.DEV): () => void {
	// Kontextmenü nur in Eingabefeldern (Kopieren/Einfügen); eigene Menüs (bits-ui) setzen preventDefault selbst.
	const onContext = (e: MouseEvent) => {
		if (!isEditable(e.target)) e.preventDefault();
	};
	const onKey = (e: KeyboardEvent) => {
		if (shouldBlockKey(e, dev)) e.preventDefault();
	};
	const onWheel = (e: WheelEvent) => {
		if (e.ctrlKey) e.preventDefault(); // Zoom per Strg+Mausrad
	};
	window.addEventListener("contextmenu", onContext);
	window.addEventListener("keydown", onKey);
	window.addEventListener("wheel", onWheel, { passive: false });
	return () => {
		window.removeEventListener("contextmenu", onContext);
		window.removeEventListener("keydown", onKey);
		window.removeEventListener("wheel", onWheel);
	};
}
```

Hinweis: App-Kürzel auf gesperrten Tasten, zum Beispiel F5 (Index aktualisieren) und Strg+F (Suche), funktionieren trotzdem. `bindShortcuts` prüft `defaultPrevented` nicht.

`src/lib/desktop/selection.ts`:

```ts
// Auswahl-Modell wie im Datei-Explorer. Rein funktional: jede Operation liefert einen neuen Zustand.

export interface Selection {
	readonly ids: ReadonlySet<string>;
	/** Startpunkt für Shift-Bereiche */
	readonly anchor: string | null;
	/** Zuletzt geklickte bzw. per Tastatur erreichte Zeile; das Detail-Panel zeigt sie. */
	readonly focus: string | null;
}

export interface ClickMods {
	shift: boolean;
	/** Strg bzw. Cmd, oder Klick auf die Checkbox */
	toggle: boolean;
}

export const emptySelection: Selection = { ids: new Set(), anchor: null, focus: null };

function range(order: readonly string[], a: string, b: string): string[] {
	const i = order.indexOf(a);
	const j = order.indexOf(b);
	if (i < 0 || j < 0) return [b];
	return order.slice(Math.min(i, j), Math.max(i, j) + 1);
}

export function click(sel: Selection, order: readonly string[], id: string, mods: ClickMods): Selection {
	if (mods.shift && sel.anchor !== null && order.includes(sel.anchor)) {
		const r = range(order, sel.anchor, id);
		return { ids: new Set(mods.toggle ? [...sel.ids, ...r] : r), anchor: sel.anchor, focus: id };
	}
	if (mods.toggle) {
		const ids = new Set(sel.ids);
		if (ids.has(id)) ids.delete(id);
		else ids.add(id);
		return { ids, anchor: id, focus: id };
	}
	return { ids: new Set([id]), anchor: id, focus: id };
}

export function selectAll(sel: Selection, order: readonly string[]): Selection {
	return { ids: new Set(order), anchor: order[0] ?? null, focus: sel.focus };
}

export function clear(sel: Selection): Selection {
	return { ids: new Set(), anchor: null, focus: sel.focus };
}

/** Rechtsklick: innerhalb der Auswahl bleibt sie bestehen, sonst wird nur diese Zeile gewählt. */
export function forContext(sel: Selection, id: string): Selection {
	if (sel.ids.has(id)) return { ...sel, focus: id };
	return { ids: new Set([id]), anchor: id, focus: id };
}

export function move(sel: Selection, order: readonly string[], delta: number, extend: boolean): Selection {
	if (!order.length) return sel;
	const cur = sel.focus !== null ? order.indexOf(sel.focus) : -1;
	const target = cur < 0 ? (delta > 0 ? 0 : order.length - 1) : cur + delta;
	const next = order[Math.max(0, Math.min(order.length - 1, target))];
	if (extend && sel.anchor !== null && order.includes(sel.anchor)) {
		return { ids: new Set(range(order, sel.anchor, next)), anchor: sel.anchor, focus: next };
	}
	return { ids: new Set([next]), anchor: next, focus: next };
}

/** Entfernt Zeilen, die nicht mehr sichtbar sind. Gibt bei unverändertem Stand dasselbe Objekt zurück. */
export function prune(sel: Selection, order: readonly string[]): Selection {
	const visible = new Set(order);
	const ids = [...sel.ids].filter((id) => visible.has(id));
	const anchor = sel.anchor !== null && visible.has(sel.anchor) ? sel.anchor : null;
	const focus = sel.focus !== null && visible.has(sel.focus) ? sel.focus : null;
	if (ids.length === sel.ids.size && anchor === sel.anchor && focus === sel.focus) return sel;
	return { ids: new Set(ids), anchor, focus };
}
```

`src/lib/desktop/virtual.ts`:

```ts
// Fenster-Berechnung für virtualisierte Listen mit fester Zeilenhöhe.

export interface Range {
	start: number;
	end: number;
}

export function visibleRange(scrollTop: number, viewport: number, rowHeight: number, count: number, overscan = 6): Range {
	if (count === 0 || rowHeight <= 0) return { start: 0, end: 0 };
	const maxTop = Math.max(0, count * rowHeight - viewport);
	const top = Math.min(Math.max(0, scrollTop), maxTop);
	const first = Math.floor(top / rowHeight);
	const last = Math.ceil((top + viewport) / rowHeight);
	return { start: Math.max(0, first - overscan), end: Math.min(count, last + overscan) };
}

export function scrollToReveal(index: number, rowHeight: number, scrollTop: number, viewport: number): number {
	const top = index * rowHeight;
	const bottom = top + rowHeight;
	if (top < scrollTop) return top;
	if (bottom > scrollTop + viewport) return bottom - viewport;
	return scrollTop;
}
```

`src/lib/desktop/debounce.ts`:

```ts
export function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number) {
	let timer: ReturnType<typeof setTimeout> | null = null;
	let pending: A | null = null;
	const run = () => {
		timer = null;
		const args = pending;
		pending = null;
		if (args) fn(...args);
	};
	const d = (...args: A) => {
		pending = args;
		if (timer) clearTimeout(timer);
		timer = setTimeout(run, ms);
	};
	d.cancel = () => {
		if (timer) clearTimeout(timer);
		timer = null;
		pending = null;
	};
	d.flush = () => {
		if (timer) clearTimeout(timer);
		run();
	};
	return d;
}
```

`src/lib/api/status.ts`:

```ts
// Ein Status pro Paket aus Sicht des aktiven Profils, für Listen und Detail-Panel.

export type ModStatus = "update" | "inProfile" | "disabled" | "dependency" | "none";

export interface StatusInput {
	mods: ReadonlyMap<string, { enabled: boolean }>;
	updates: Readonly<Record<string, string>>;
	resolved: Readonly<Record<string, unknown>> | undefined;
}

export function modStatus(id: string, s: StatusInput): ModStatus {
	const m = s.mods.get(id);
	if (m) {
		if (id in s.updates) return "update";
		return m.enabled ? "inProfile" : "disabled";
	}
	if (s.resolved && id in s.resolved) return "dependency";
	return "none";
}
```

An `src/lib/format.ts` anhängen:

```ts
/** Zwei Buchstaben für Avatare: Großbuchstaben des Namens, sonst die ersten zwei Zeichen. */
export function initials(name: string): string {
	const caps = name.replace(/[^A-Z]/g, "").slice(0, 2);
	return caps.length === 2 ? caps : name.slice(0, 2).toUpperCase();
}
```

- [ ] **Step 5: Tests grün**

Run: `npm test`
Expected: PASS, alle Dateien.

Hinweis zu `initials("BepInExPack_Valheim")`: Die Großbuchstaben sind B, I, E, P, V, also ergibt das „BI“. Bei „x“ gibt es keine Großbuchstaben, und `"x".slice(0, 2)` ergibt „X“.

- [ ] **Step 6: shadcn-Primitives hinzufügen**

Run: `npx shadcn-svelte@latest add context-menu dropdown-menu toggle-group tooltip resizable select --yes`
Expected:

- Die neuen Ordner liegen unter `src/lib/components/ui/`, eventuell kommt `paneforge` in `package.json` dazu.
- Fragt das CLI nach dem Überschreiben bestehender Dateien: **nein** wählen. Bestehende Komponenten bleiben unverändert.

- [ ] **Step 7: Importregel als Test**

`src/lib/components/kit/boundaries.test.ts`:

```ts
// Architektur-Regeln: App-Seiten nutzen nur Kit/Shell, Farben nur über Tokens.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..", "..", "..");
const files = (dir: string) =>
	(readdirSync(join(ROOT, dir), { recursive: true }) as string[]).filter((f) => f.endsWith(".svelte") || f.endsWith(".ts")).map((f) => join(dir, f));

describe("UI-Grenzen", () => {
	it("App-Seiten importieren keine ui-Primitives direkt", () => {
		const offenders = [...files("src/routes"), ...files("src/lib/components/app")].filter((f) =>
			/from\s+["']\$lib\/components\/ui\//.test(readFileSync(join(ROOT, f), "utf8")),
		);
		expect(offenders).toEqual([]);
	});

	it("keine festen Farbwerte in Svelte-Komponenten", () => {
		const svelte = [...files("src/routes"), ...files("src/lib/components/app"), ...files("src/lib/components/kit"), ...files("src/lib/components/shell")]
			.filter((f) => f.endsWith(".svelte"))
			.filter((f) => !f.endsWith("title-bar.svelte"));
		const offenders = svelte.filter((f) => /oklch\(|(?<![{\w])#[0-9a-fA-F]{3,8}\b|rgba?\(/.test(readFileSync(join(ROOT, f), "utf8")));
		expect(offenders).toEqual([]);
	});
});
```

Run: `npm test`
Expected: Der erste Test schlägt fehl und listet die bisherigen App-Dateien, die `$lib/components/ui` importieren. Das ist richtig. Den Test bis Task 11 überspringen, damit das Gate grün bleibt: Zeile `it("App-Seiten importieren …"` in `it.skip(` ändern und darüber diesen Kommentar setzen:

```ts
// Wird in Task 11 scharf geschaltet, sobald alle Seiten umgestellt sind.
```

Der zweite Test muss jetzt schon grün sein. Falls nicht: Treffer prüfen. Die alten Views nutzen `text-amber-600`, aber keine festen Werte, also sollte es passen.

- [ ] **Step 8: Gate**

Run: `npm test && npm run check && npm run build`
Expected: Alles grün; ein Test ist übersprungen.

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json vite.config.ts src/lib/desktop src/lib/api/status.ts src/lib/api/status.test.ts src/lib/format.ts src/lib/format.test.ts src/lib/components/ui src/lib/components/kit/boundaries.test.ts
git commit -m "feat(desktop): selection, virtualization, shortcuts and guards as tested modules; add shadcn primitives

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Kit-Grundbausteine und Schaukasten

**Files:**

- Create: `src/lib/components/kit/types.ts`
- Create: `src/lib/components/kit/section-label.svelte`, `kbd.svelte`, `tri-checkbox.svelte`, `segmented.svelte`, `chip.svelte`, `status-pill.svelte`, `mod-avatar.svelte`, `stat.svelte`, `setting-row.svelte`, `stepper.svelte`, `path-field.svelte`, `empty-state.svelte`, `panel-section.svelte`, `split-button.svelte`, `confirm-dialog.svelte`, `choice.svelte`
- Create: `src/lib/components/kit/index.ts`
- Create: `src/routes/dev/kit/+page.svelte`

**Interfaces:**

- Consumes: Tokens aus Task 1, `initials` und `ModStatus` aus Task 3, shadcn-Primitives aus Task 3.
- Produces (über `import { … } from "$lib/components/kit"`):
  - `SectionLabel { children; aside?: Snippet; class? }`
  - `Kbd { children }`
  - `TriCheckbox { state: TriState; label: string; onclick?: (e: MouseEvent) => void; class? }` mit `TriState = 1 | -1 | 0 | "mixed"`; ohne `onclick` wird ein `<span>` gerendert.
  - `Segmented { options: SegmentOption[]; value: string (bindable); columns?: number; class? }` mit `SegmentOption = { value: string; label: string; badge?: string | number; tone?: "default" | "primary" }`.
  - `Chip { active?: boolean; onclick?; children; title? }`
  - `StatusPill { status: ModStatus; version?: string; onclick?: (e: MouseEvent) => void }`
  - `ModAvatar { name: string; icon?: string; size?: "sm" | "md" | "lg" }` (30, 32, 56 px)
  - `Stat { label: string; value: string }`
  - `SettingRow { label: string; hint?: string; children; aside?: Snippet; align?: "start" | "center" }`
  - `Stepper { value: number (bindable); min: number; max: number; label: string }`
  - `PathField { value: string | null (bindable); placeholder?: string; onpick: () => void; onopen?: () => void; check?: { ok: boolean; text: string } | null; id?: string }`
  - `EmptyState { title: string; children?; action?: Snippet }`
  - `PanelSection { title: string; count?: number | string; children; class? }`
  - `SplitButton { children; onclick; disabled?: boolean; menu: Snippet; menuLabel: string }`
  - `ConfirmDialog { open: boolean (bindable); title: string; description: string; confirmLabel: string; destructive?: boolean; onconfirm: () => void | Promise<void> }`
  - `Choice { value: string (bindable); options: string[]; onchange?: (v: string) => void; class? }`
  - Re-Exports: `Button`, `Input`, `Label`, `Switch`, `Checkbox`, `Separator`, `ScrollArea`, `Toaster`, sowie die Namespaces `Dialog`, `DropdownMenu`, `ContextMenu`, `Tooltip`, `Resizable`.

- [ ] **Step 1: `types.ts`**

```ts
import type { ModStatus } from "$lib/api/status";

export type TriState = 1 | -1 | 0 | "mixed";
export type { ModStatus };

export interface SegmentOption {
	value: string;
	label: string;
	badge?: string | number;
	tone?: "default" | "primary";
}

export interface Column {
	key: string;
	label: string;
	/** CSS-Grid-Spur, z. B. "116px" oder "minmax(0,1fr)" */
	width: string;
	align?: "left" | "right";
	sortable?: boolean;
}

export interface SortState {
	key: string;
	dir: "asc" | "desc";
}
```

- [ ] **Step 2: Kleine Bausteine**

`section-label.svelte`:

```svelte
<script lang="ts">
	import type { Snippet } from "svelte";
	import { cn } from "$lib/utils";

	let { children, aside, class: className }: { children: Snippet; aside?: Snippet; class?: string } = $props();
</script>

<div class={cn("flex items-center gap-2", className)}>
	<span class="label-caps flex-1 truncate">{@render children()}</span>
	{@render aside?.()}
</div>
```

`kbd.svelte`:

```svelte
<script lang="ts">
	import type { Snippet } from "svelte";

	let { children }: { children: Snippet } = $props();
</script>

<kbd class="border-line-strong text-muted-foreground text-2xs rounded-[3px] border px-1.5 py-0.5 font-mono">{@render children()}</kbd>
```

`tri-checkbox.svelte`:

```svelte
<script lang="ts">
	import { cn } from "$lib/utils";
	import type { TriState } from "./types";

	let { state, label, onclick, class: className }: { state: TriState; label: string; onclick?: (e: MouseEvent) => void; class?: string } = $props();

	const mark = $derived(state === 1 ? "✓" : state === 0 ? "" : "−");
	const classes = $derived(
		cn(
			"flex size-3.5 shrink-0 items-center justify-center rounded-[3px] border font-mono text-[10px] leading-none font-bold",
			state === 1 && "bg-primary border-primary text-primary-foreground",
			state === -1 && "bg-destructive border-destructive text-white",
			state === "mixed" && "border-primary text-primary",
			state === 0 && "border-checkbox-line",
			className,
		),
	);
</script>

{#if onclick}
	<button type="button" role="checkbox" aria-checked={state === "mixed" ? "mixed" : state === 1} aria-label={label} tabindex="-1" class={classes} {onclick}
		>{mark}</button
	>
{:else}
	<span aria-hidden="true" class={classes}>{mark}</span>
{/if}
```

`segmented.svelte` (auf shadcn `toggle-group`, damit Pfeiltasten-Navigation und ARIA stimmen):

```svelte
<script lang="ts">
	import * as ToggleGroup from "$lib/components/ui/toggle-group";
	import { cn } from "$lib/utils";
	import type { SegmentOption } from "./types";

	let { options, value = $bindable(), columns, class: className }: { options: SegmentOption[]; value: string; columns?: number; class?: string } = $props();
</script>

<ToggleGroup.Root
	type="single"
	{value}
	onValueChange={(v) => v && (value = v)}
	class={cn("bg-field gap-0.5 rounded-[5px] p-0.5", columns ? "grid w-full" : "inline-flex w-max", className)}
	style={columns ? `grid-template-columns: repeat(${columns}, minmax(0, 1fr))` : undefined}
>
	{#each options as o (o.value)}
		<ToggleGroup.Item
			value={o.value}
			class={cn(
				"text-foreground-soft hover:text-foreground h-7 min-w-0 rounded-[4px] border-0 px-3 text-xs shadow-none hover:bg-transparent",
				"data-[state=on]:bg-muted data-[state=on]:text-foreground",
				o.tone === "primary" && "text-primary",
			)}
		>
			{o.label}
			{#if o.badge != null && o.badge !== 0}<span class="ml-1 font-mono">{o.badge}</span>{/if}
		</ToggleGroup.Item>
	{/each}
</ToggleGroup.Root>
```

`chip.svelte`:

```svelte
<script lang="ts">
	import type { Snippet } from "svelte";
	import { cn } from "$lib/utils";

	let { active = false, onclick, title, children }: { active?: boolean; onclick?: () => void; title?: string; children: Snippet } = $props();
</script>

<button
	type="button"
	{title}
	{onclick}
	aria-pressed={active}
	class={cn(
		"flex h-6 items-center rounded-[4px] border px-2.5 text-xs",
		active ? "bg-primary-tint text-primary-text border-primary-line" : "border-input text-foreground-soft hover:bg-hover",
	)}
>
	{@render children()}
</button>
```

`status-pill.svelte`:

```svelte
<script lang="ts">
	import type { ModStatus } from "./types";

	let { status, version, onclick }: { status: ModStatus; version?: string; onclick?: (e: MouseEvent) => void } = $props();
</script>

{#if status === "update"}
	<button
		type="button"
		{onclick}
		disabled={!onclick}
		title={onclick ? `Auf ${version} aktualisieren` : undefined}
		class="bg-primary text-primary-foreground hover:bg-primary-hover rounded-[4px] px-2 py-1 font-mono text-[11.5px] font-medium"
	>
		↑ {version}
	</button>
{:else if status === "inProfile"}
	<span class="text-success flex items-center gap-1.5 text-xs"><span class="bg-success size-1.5 rounded-full"></span>Im Profil</span>
{:else if status === "disabled"}
	<span class="text-muted-foreground flex items-center gap-1.5 text-xs"
		><span class="border-muted-foreground size-1.5 rounded-full border"></span>Deaktiviert</span
	>
{:else if status === "dependency"}
	<span class="text-foreground-soft text-xs">Abhängigkeit</span>
{:else}
	<span class="text-subtle-foreground text-xs">—</span>
{/if}
```

`mod-avatar.svelte`:

```svelte
<script lang="ts">
	import { initials } from "$lib/format";
	import { cn } from "$lib/utils";

	let { name, icon, size = "sm" }: { name: string; icon?: string; size?: "sm" | "md" | "lg" } = $props();
	let failed = $state(false);
	const box = $derived(
		size === "lg" ? "size-14 rounded-lg text-[13px]" : size === "md" ? "size-8 rounded-[5px] text-[10px]" : "size-[30px] rounded-[5px] text-[10px]",
	);
</script>

{#if icon && !failed}
	<img src={icon} alt="" loading="lazy" draggable="false" class={cn("shrink-0 object-cover", box)} onerror={() => (failed = true)} />
{:else}
	<span class={cn("avatar-stripes text-muted-foreground flex shrink-0 items-center justify-center font-mono font-medium", box)}>
		{initials(name)}
	</span>
{/if}

<style>
	.avatar-stripes {
		background: repeating-linear-gradient(135deg, var(--muted) 0 4px, var(--line-subtle) 4px 8px);
	}
</style>
```

`stat.svelte`:

```svelte
<script lang="ts">
	let { label, value }: { label: string; value: string } = $props();
</script>

<div class="flex flex-col gap-[3px]">
	<span class="label-caps text-[10px] tracking-[0.06em]">{label}</span>
	<span class="font-mono text-sm font-medium">{value}</span>
</div>
```

`setting-row.svelte`:

```svelte
<script lang="ts">
	import type { Snippet } from "svelte";
	import { cn } from "$lib/utils";

	let {
		label,
		hint,
		children,
		aside,
		align = "start",
		for: forId,
	}: { label: string; hint?: string; children: Snippet; aside?: Snippet; align?: "start" | "center"; for?: string } = $props();
</script>

<div
	class={cn(
		"border-line-subtle grid gap-6 border-b py-4 last:border-b-0",
		aside ? "grid-cols-[var(--spacing-label)_minmax(0,1fr)_auto]" : "grid-cols-[var(--spacing-label)_minmax(0,1fr)]",
		align === "center" && "items-center",
	)}
>
	<div class="flex flex-col gap-1">
		<label for={forId} class="text-row font-semibold">{label}</label>
		{#if hint}<p class="text-muted-foreground text-xs leading-snug">{hint}</p>{/if}
	</div>
	<div class="min-w-0">{@render children()}</div>
	{#if aside}<div>{@render aside()}</div>{/if}
</div>
```

`stepper.svelte`:

```svelte
<script lang="ts">
	let { value = $bindable(), min, max, label }: { value: number; min: number; max: number; label: string } = $props();

	function set(v: number) {
		value = Math.max(min, Math.min(max, v));
	}
</script>

<div
	role="spinbutton"
	tabindex="0"
	aria-label={label}
	aria-valuenow={value}
	aria-valuemin={min}
	aria-valuemax={max}
	class="border-line-strong flex w-max overflow-hidden rounded-[5px] border font-mono text-[13px] focus-visible:outline-2"
	onkeydown={(e) => {
		if (e.key === "ArrowUp" || e.key === "ArrowRight") set(value + 1);
		else if (e.key === "ArrowDown" || e.key === "ArrowLeft") set(value - 1);
		else return;
		e.preventDefault();
	}}
>
	<button
		type="button"
		tabindex="-1"
		class="text-foreground-soft hover:bg-muted size-8 disabled:opacity-40"
		disabled={value <= min}
		onclick={() => set(value - 1)}>−</button
	>
	<span class="border-input bg-field flex h-8 w-11 items-center justify-center border-x">{value}</span>
	<button
		type="button"
		tabindex="-1"
		class="text-foreground-soft hover:bg-muted size-8 disabled:opacity-40"
		disabled={value >= max}
		onclick={() => set(value + 1)}>+</button
	>
</div>
```

`path-field.svelte`:

```svelte
<script lang="ts">
	import { Button } from "$lib/components/ui/button";
	import { Input } from "$lib/components/ui/input";
	import { cn } from "$lib/utils";

	let {
		value = $bindable(),
		placeholder,
		onpick,
		onopen,
		check = null,
		id,
	}: {
		value: string | null;
		placeholder?: string;
		onpick: () => void;
		onopen?: () => void;
		check?: { ok: boolean; text: string } | null;
		id?: string;
	} = $props();
</script>

<div class="flex flex-col gap-2">
	<div class="flex gap-1.5">
		<Input {id} class="flex-1 font-mono text-[12.5px]" spellcheck={false} {placeholder} bind:value={() => value ?? "", (v) => (value = v || null)} />
		<Button variant="outline" onclick={onpick}>Wählen…</Button>
		{#if onopen}<Button variant="ghost" onclick={onopen}>Öffnen ↗</Button>{/if}
	</div>
	{#if check}
		<p class={cn("font-mono text-[11.5px]", check.ok ? "text-success" : "text-destructive-text")}>{check.ok ? "✓" : "✗"} {check.text}</p>
	{/if}
</div>
```

`empty-state.svelte`:

```svelte
<script lang="ts">
	import type { Snippet } from "svelte";

	let { title, children, action }: { title: string; children?: Snippet; action?: Snippet } = $props();
</script>

<div class="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
	<p class="text-row font-semibold">{title}</p>
	{#if children}<div class="text-muted-foreground max-w-sm text-sm">{@render children()}</div>{/if}
	{@render action?.()}
</div>
```

`panel-section.svelte`:

```svelte
<script lang="ts">
	import type { Snippet } from "svelte";
	import { cn } from "$lib/utils";

	let { title, count, children, class: className }: { title: string; count?: number | string; children: Snippet; class?: string } = $props();
</script>

<section class={cn("flex flex-col gap-2 border-b px-5 py-4 last:border-b-0", className)}>
	<h3 class="label-caps">
		{title}{#if count != null}
			· {count}{/if}
	</h3>
	{@render children()}
</section>
```

`split-button.svelte`:

```svelte
<script lang="ts">
	import type { Snippet } from "svelte";
	import ChevronDown from "@lucide/svelte/icons/chevron-down";
	import { Button } from "$lib/components/ui/button";
	import * as DropdownMenu from "$lib/components/ui/dropdown-menu";

	let {
		children,
		onclick,
		disabled = false,
		menu,
		menuLabel,
	}: { children: Snippet; onclick: () => void; disabled?: boolean; menu: Snippet; menuLabel: string } = $props();
</script>

<div class="flex overflow-hidden rounded-md">
	<Button size="lg" class="rounded-none" {disabled} {onclick}>{@render children()}</Button>
	<DropdownMenu.Root>
		<DropdownMenu.Trigger>
			{#snippet child({ props })}
				<Button {...props} size="lg" aria-label={menuLabel} class="bg-primary-hover border-primary-edge rounded-none border-0 border-l px-2.5">
					<ChevronDown class="size-3.5" />
				</Button>
			{/snippet}
		</DropdownMenu.Trigger>
		<DropdownMenu.Content align="end" class="w-60">{@render menu()}</DropdownMenu.Content>
	</DropdownMenu.Root>
</div>
```

`confirm-dialog.svelte`:

```svelte
<script lang="ts">
	import { Button } from "$lib/components/ui/button";
	import * as Dialog from "$lib/components/ui/dialog";

	let {
		open = $bindable(false),
		title,
		description,
		confirmLabel,
		destructive = false,
		onconfirm,
	}: {
		open: boolean;
		title: string;
		description: string;
		confirmLabel: string;
		destructive?: boolean;
		onconfirm: () => void | Promise<void>;
	} = $props();

	let busy = $state(false);

	async function confirm() {
		busy = true;
		try {
			await onconfirm();
			open = false;
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
		<Dialog.Footer>
			<Button variant="outline" onclick={() => (open = false)}>Abbrechen</Button>
			<Button variant={destructive ? "destructive" : "default"} disabled={busy} onclick={confirm}>{confirmLabel}</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
```

`choice.svelte` (Auswahlliste auf shadcn `select`; ersetzt `native-select`):

```svelte
<script lang="ts">
	import * as Select from "$lib/components/ui/select";
	import { cn } from "$lib/utils";

	let {
		value = $bindable(),
		options,
		onchange,
		class: className,
	}: { value: string; options: string[]; onchange?: (v: string) => void; class?: string } = $props();
</script>

<Select.Root
	type="single"
	{value}
	onValueChange={(v) => {
		value = v;
		onchange?.(v);
	}}
>
	<Select.Trigger class={cn("w-full font-mono text-[12.5px]", className)}>{value}</Select.Trigger>
	<Select.Content>
		{#each options as o (o)}
			<Select.Item value={o} label={o} class="font-mono text-[12.5px]">{o}</Select.Item>
		{/each}
	</Select.Content>
</Select.Root>
```

- [ ] **Step 3: `index.ts`**

Vorher die Exporte der vorhandenen ui-Komponenten prüfen: `ls src/lib/components/ui` und den `index.ts` jedes Ordners. Nur Komponenten re-exportieren, die es gibt.

```ts
// Einziger UI-Einstieg für App-Seiten (siehe boundaries.test.ts).
export type { Column, ModStatus, SegmentOption, SortState, TriState } from "./types";

export { default as SectionLabel } from "./section-label.svelte";
export { default as Kbd } from "./kbd.svelte";
export { default as TriCheckbox } from "./tri-checkbox.svelte";
export { default as Segmented } from "./segmented.svelte";
export { default as Chip } from "./chip.svelte";
export { default as StatusPill } from "./status-pill.svelte";
export { default as ModAvatar } from "./mod-avatar.svelte";
export { default as Stat } from "./stat.svelte";
export { default as SettingRow } from "./setting-row.svelte";
export { default as Stepper } from "./stepper.svelte";
export { default as PathField } from "./path-field.svelte";
export { default as EmptyState } from "./empty-state.svelte";
export { default as PanelSection } from "./panel-section.svelte";
export { default as SplitButton } from "./split-button.svelte";
export { default as ConfirmDialog } from "./confirm-dialog.svelte";
export { default as Choice } from "./choice.svelte";

// Re-Exporte der shadcn-Primitives, damit App-Code nur einen Importpfad kennt.
export { Button } from "$lib/components/ui/button";
export { Input } from "$lib/components/ui/input";
export { Label } from "$lib/components/ui/label";
export { Switch } from "$lib/components/ui/switch";
export { Checkbox } from "$lib/components/ui/checkbox";
export { Separator } from "$lib/components/ui/separator";
export { ScrollArea } from "$lib/components/ui/scroll-area";
export { Toaster } from "$lib/components/ui/sonner";
export * as Dialog from "$lib/components/ui/dialog";
export * as DropdownMenu from "$lib/components/ui/dropdown-menu";
export * as ContextMenu from "$lib/components/ui/context-menu";
export * as Tooltip from "$lib/components/ui/tooltip";
export * as Resizable from "$lib/components/ui/resizable";
```

- [ ] **Step 4: Schaukasten `src/routes/dev/kit/+page.svelte`**

Nur im Dev-Modus erreichbar. Er dient zur Sichtprüfung gegen das Design.

```svelte
<script lang="ts">
	import { dev } from "$app/environment";
	import {
		Button,
		Chip,
		Choice,
		DropdownMenu,
		EmptyState,
		Kbd,
		ModAvatar,
		PanelSection,
		PathField,
		SectionLabel,
		Segmented,
		SettingRow,
		SplitButton,
		Stat,
		StatusPill,
		Stepper,
		Switch,
		TriCheckbox,
	} from "$lib/components/kit";

	let seg = $state("all");
	let n = $state(4);
	let path = $state<string | null>("C:\\Program Files (x86)\\Steam\\steamapps\\common\\Valheim");
	let choice = $state("true");
	let on = $state(false);
</script>

{#if dev}
	<div class="h-full overflow-y-auto p-8">
		<div class="flex max-w-4xl flex-col gap-8">
			<SectionLabel>Buttons</SectionLabel>
			<div class="flex flex-wrap items-center gap-2">
				<Button>Zum Profil hinzufügen</Button>
				<Button variant="outline">Wählen…</Button>
				<Button variant="ghost">Öffnen ↗</Button>
				<Button variant="destructive">Löschen</Button>
				<Button size="sm" variant="outline">+ Hinzufügen</Button>
				<SplitButton onclick={() => {}} menuLabel="Weitere Startoptionen">
					▶ Spielen
					{#snippet menu()}<DropdownMenu.Item>Ohne Mods starten</DropdownMenu.Item>{/snippet}
				</SplitButton>
			</div>

			<SectionLabel>Auswahl</SectionLabel>
			<div class="flex items-center gap-4">
				<TriCheckbox state={0} label="aus" />
				<TriCheckbox state={1} label="ein" />
				<TriCheckbox state={-1} label="aus­geschlossen" />
				<TriCheckbox state="mixed" label="teilweise" />
				<Segmented
					bind:value={seg}
					options={[
						{ value: "all", label: "Alle" },
						{ value: "p", label: "Im Profil" },
						{ value: "u", label: "Updates", badge: 3, tone: "primary" },
					]}
				/>
				<Chip active>Bewährt &amp; aktuell</Chip>
				<Chip>Neu diesen Monat</Chip>
				<Kbd>Strg K</Kbd>
				<Switch bind:checked={on} />
			</div>

			<SectionLabel>Status &amp; Avatare</SectionLabel>
			<div class="flex items-center gap-6">
				<StatusPill status="update" version="0.14.13" onclick={() => {}} />
				<StatusPill status="inProfile" />
				<StatusPill status="disabled" />
				<StatusPill status="dependency" />
				<StatusPill status="none" />
				<ModAvatar name="EpicLoot" />
				<ModAvatar name="EpicLoot" size="lg" />
				<Stat label="Downloads" value="2,3 Mio" />
			</div>

			<SectionLabel>Einstellungen</SectionLabel>
			<div>
				<SettingRow label="Valheim-Ordner" hint="Leer lassen = automatisch über Steam erkennen">
					<PathField bind:value={path} onpick={() => {}} onopen={() => {}} check={{ ok: true, text: "valheim.exe gefunden" }} />
				</SettingRow>
				<SettingRow label="Parallele Downloads" align="center">
					<div class="flex items-center gap-3.5">
						<Stepper bind:value={n} min={1} max={16} label="Parallele Downloads" /><span class="text-muted-foreground text-xs">1–16 · empfohlen 4</span>
					</div>
				</SettingRow>
				<SettingRow label="Enum" align="center"><Choice bind:value={choice} options={["true", "false"]} class="w-56" /></SettingRow>
			</div>

			<PanelSection title="Abhängigkeiten" count={2}><p>Jotunn</p></PanelSection>
			<div class="h-48 rounded-md border"><EmptyState title="Noch keine Mods">Unter „Durchsuchen“ hinzufügen.</EmptyState></div>
		</div>
	</div>
{/if}
```

- [ ] **Step 5: autofixer und Gate**

`svelte-autofixer` auf jede neue `.svelte`-Datei anwenden, bis keine Meldungen mehr kommen. Danach `npm test && npm run check && npm run build`.
Expected: Alles grün, inklusive „keine festen Farbwerte“.

- [ ] **Step 6: Sichtprüfung**

In `npm run tauri dev` per DevTools-Konsole `location.href = "/dev/kit"` aufrufen.
Expected:

- Buttons, Segmente, Pillen und Felder entsprechen optisch dem Design 1a (Höhen 34/28, Bernstein, Mono-Labels).
- Das Dropdown des Split-Buttons öffnet unterhalb, rechtsbündig, und hat den dunklen Menü-Stil.

- [ ] **Step 7: Commit**

```bash
git add src/lib/components/kit src/routes/dev
git commit -m "feat(kit): Werkbank component kit derived from shadcn-svelte with dev showcase

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: DataTable (virtualisiert, Mehrfachauswahl, Tastatur, Kontextmenü) und SelectionBar

**Files:**

- Create: `src/lib/components/kit/data-table.svelte`
- Create: `src/lib/components/kit/selection-bar.svelte`
- Modify: `src/lib/components/kit/index.ts`
- Modify: `src/routes/dev/kit/+page.svelte` (Tabellen-Demo)

**Interfaces:**

- Consumes: `Selection`-Funktionen (Task 3), `visibleRange` und `scrollToReveal` (Task 3), `matches` (Task 3), `TriCheckbox`, `Column` und `SortState` (Task 4), `ContextMenu` (Task 3).
- Produces:
  - `DataTable<T>` mit diesen Props:
    - `rows: T[]`, `getId: (row: T) => string`, `columns: Column[]`
    - `cell: Snippet<[T, string]>`, rendert die Zelle für Zeile × Spalten-Key
    - `selection?: Selection` (bindable), `sort?: SortState | null` (bindable)
    - `rowHeight?: number` (Standard 50), `selectable?: boolean` (Standard true)
    - `menu?: Snippet<[string[]]>`, Kontextmenü-Inhalt für die gewählten IDs
    - `onactivate?: (row: T) => void` (Enter oder Doppelklick), `ondelete?: (ids: string[]) => void` (Entf)
    - `rowClass?: (row: T) => string | undefined`, `empty?: Snippet`, `class?: string`
  - `SelectionBar { count: number; onclear: () => void; hint?: string; children: Snippet }`, absolut positioniert. Das Elternelement muss `relative` sein.

- [ ] **Step 1: `data-table.svelte`**

```svelte
<script lang="ts" generics="T">
	import type { Snippet } from "svelte";
	import * as ContextMenu from "$lib/components/ui/context-menu";
	import * as sel from "$lib/desktop/selection";
	import { matches } from "$lib/desktop/shortcuts";
	import { scrollToReveal, visibleRange } from "$lib/desktop/virtual";
	import { cn } from "$lib/utils";
	import TriCheckbox from "./tri-checkbox.svelte";
	import type { Column, SortState, TriState } from "./types";

	interface Props {
		rows: T[];
		getId: (row: T) => string;
		columns: Column[];
		cell: Snippet<[T, string]>;
		selection?: sel.Selection;
		sort?: SortState | null;
		rowHeight?: number;
		selectable?: boolean;
		menu?: Snippet<[string[]]>;
		onactivate?: (row: T) => void;
		ondelete?: (ids: string[]) => void;
		rowClass?: (row: T) => string | undefined;
		empty?: Snippet;
		class?: string;
	}

	let {
		rows,
		getId,
		columns,
		cell,
		selection = $bindable(sel.emptySelection),
		sort = $bindable(null),
		rowHeight = 50,
		selectable = true,
		menu,
		onactivate,
		ondelete,
		rowClass,
		empty,
		class: className,
	}: Props = $props();

	let viewport = $state<HTMLDivElement>();
	let scrollTop = $state(0);
	let height = $state(0);

	const order = $derived(rows.map(getId));
	const range = $derived(visibleRange(scrollTop, height, rowHeight, rows.length));
	const template = $derived([selectable ? "14px" : null, ...columns.map((c) => c.width)].filter(Boolean).join(" "));
	const headerState: TriState = $derived(!selection.ids.size ? 0 : order.length && order.every((id) => selection.ids.has(id)) ? 1 : "mixed");

	// Auswahl an die aktuell sichtbaren Zeilen anpassen (Filterwechsel); prune liefert bei Gleichstand dasselbe Objekt.
	$effect(() => {
		const next = sel.prune(selection, order);
		if (next !== selection) selection = next;
	});

	function reveal() {
		const i = selection.focus ? order.indexOf(selection.focus) : -1;
		if (viewport && i >= 0) viewport.scrollTop = scrollToReveal(i, rowHeight, viewport.scrollTop, height);
	}

	function onRowClick(e: MouseEvent, id: string) {
		selection = sel.click(selection, order, id, { shift: e.shiftKey, toggle: e.ctrlKey || e.metaKey });
		viewport?.focus({ preventScroll: true });
	}

	function onCheck(e: MouseEvent, id: string) {
		e.stopPropagation();
		selection = sel.click(selection, order, id, { shift: e.shiftKey, toggle: true });
	}

	function onKey(e: KeyboardEvent) {
		const page = Math.max(1, Math.floor(height / rowHeight) - 1);
		const step: Record<string, number> = { ArrowDown: 1, ArrowUp: -1, PageDown: page, PageUp: -page, Home: -order.length, End: order.length };
		if (e.key in step) {
			selection = sel.move(selection, order, step[e.key], e.shiftKey);
			reveal();
		} else if (matches(e, "Mod+A")) {
			selection = sel.selectAll(selection, order);
		} else if (e.key === "Escape" && selection.ids.size) {
			selection = sel.clear(selection);
		} else if (e.key === "Enter" && selection.focus) {
			const row = rows[order.indexOf(selection.focus)];
			if (row) onactivate?.(row);
		} else if (e.key === "Delete" && ondelete && selection.ids.size) {
			ondelete([...selection.ids]);
		} else {
			return;
		}
		e.preventDefault();
	}

	function toggleSort(c: Column) {
		if (!c.sortable) return;
		if (sort?.key !== c.key) sort = { key: c.key, dir: "desc" };
		else if (sort.dir === "desc") sort = { key: c.key, dir: "asc" };
		else sort = null; // dritter Klick: zurück zur Standard-Sortierung
	}
</script>

<div class={cn("flex min-h-0 flex-col", className)}>
	<div class="label-caps grid h-8 shrink-0 items-center gap-3 border-b px-4 tracking-[0.06em]" style:grid-template-columns={template}>
		{#if selectable}
			<TriCheckbox
				state={headerState}
				label="Alle auswählen"
				onclick={() => (selection = headerState === 1 ? sel.clear(selection) : sel.selectAll(selection, order))}
			/>
		{/if}
		{#each columns as c (c.key)}
			<button
				type="button"
				disabled={!c.sortable}
				onclick={() => toggleSort(c)}
				class={cn("truncate text-left uppercase disabled:opacity-100", c.align === "right" && "text-right", sort?.key === c.key && "text-foreground-soft")}
			>
				{c.label}{#if sort?.key === c.key}{sort.dir === "desc" ? " ↓" : " ↑"}{/if}
			</button>
		{/each}
	</div>

	<ContextMenu.Root>
		<ContextMenu.Trigger class="relative min-h-0 flex-1" disabled={!menu}>
			<div
				bind:this={viewport}
				bind:clientHeight={height}
				onscroll={(e) => (scrollTop = e.currentTarget.scrollTop)}
				onkeydown={onKey}
				tabindex="0"
				role="grid"
				aria-multiselectable={selectable}
				aria-rowcount={rows.length}
				class="h-full overflow-y-auto outline-none"
			>
				{#if !rows.length}
					{@render empty?.()}
				{:else}
					<div class="relative" style:height="{rows.length * rowHeight}px">
						{#each rows.slice(range.start, range.end) as row, i (getId(row))}
							{@const id = getId(row)}
							<div
								role="row"
								aria-selected={selection.ids.has(id)}
								aria-rowindex={range.start + i + 1}
								data-selected={selection.ids.has(id) || undefined}
								data-focused={selection.focus === id || undefined}
								class={cn(
									"border-line-subtle absolute inset-x-0 grid items-center gap-3 border-b px-4 hover:brightness-110",
									"data-selected:bg-selected data-focused:bg-focused data-selected:data-focused:bg-selected",
									"data-focused:shadow-[inset_2px_0_0_var(--color-primary)] data-selected:shadow-[inset_2px_0_0_var(--color-primary)]",
									rowClass?.(row),
								)}
								style:top="{(range.start + i) * rowHeight}px"
								style:height="{rowHeight}px"
								style:grid-template-columns={template}
								onclick={(e) => onRowClick(e, id)}
								ondblclick={() => onactivate?.(row)}
								oncontextmenu={() => (selection = sel.forContext(selection, id))}
							>
								{#if selectable}
									<TriCheckbox state={selection.ids.has(id) ? 1 : 0} label="Auswählen" onclick={(e) => onCheck(e, id)} />
								{/if}
								{#each columns as c (c.key)}
									<div class={cn("min-w-0", c.align === "right" && "flex justify-end text-right")}>{@render cell(row, c.key)}</div>
								{/each}
							</div>
						{/each}
					</div>
				{/if}
			</div>
		</ContextMenu.Trigger>
		{#if menu}
			<ContextMenu.Content class="w-72">{@render menu([...selection.ids])}</ContextMenu.Content>
		{/if}
	</ContextMenu.Root>
</div>
```

Prüfpunkt: Hat `ContextMenu.Trigger` in der generierten Komponente kein `disabled`-Prop (`src/lib/components/ui/context-menu/context-menu-trigger.svelte` lesen), wird der Trigger nur bei gesetztem `menu` gerendert. Sonst wird das Viewport-`div` direkt gerendert; den Inhalt dafür in ein lokales `{#snippet body()}` legen und an beiden Stellen per `{@render body()}` einsetzen.

- [ ] **Step 2: `selection-bar.svelte`**

```svelte
<script lang="ts">
	import type { Snippet } from "svelte";
	import X from "@lucide/svelte/icons/x";
	import { Button } from "$lib/components/ui/button";

	let { count, onclear, hint, children }: { count: number; onclear: () => void; hint?: string; children: Snippet } = $props();
</script>

{#if count > 0}
	<div
		role="toolbar"
		aria-label="Aktionen für Auswahl"
		class="bg-selection-bar border-primary-line absolute inset-x-4 bottom-3.5 z-10 flex h-[46px] items-center gap-1 rounded-lg border pr-1.5 pl-3.5 shadow-(--shadow-float)"
	>
		<span class="text-primary-text pr-2.5 text-[13px] font-bold">{count} ausgewählt</span>
		{@render children()}
		<span class="flex-1"></span>
		{#if hint}<span class="text-muted-foreground text-meta pr-2.5 font-mono">{hint}</span>{/if}
		<Button variant="ghost" size="icon-sm" aria-label="Auswahl aufheben" onclick={onclear}><X class="size-4" /></Button>
	</div>
{/if}
```

- [ ] **Step 3: Exporte ergänzen**

In `kit/index.ts` nach `Choice`:

```ts
export { default as DataTable } from "./data-table.svelte";
export { default as SelectionBar } from "./selection-bar.svelte";
```

Und am Ende:

```ts
export { emptySelection, type Selection } from "$lib/desktop/selection";
```

- [ ] **Step 4: Demo im Schaukasten**

In `src/routes/dev/kit/+page.svelte` Importe ergänzen: `DataTable`, `SelectionBar`, `ContextMenu`, `emptySelection`, `type Selection`, `type SortState`. Im Script ergänzen:

```ts
const demoRows = Array.from({ length: 5000 }, (_, i) => ({ id: `Mod-${i}`, name: `Mod ${i}`, dl: (i * 7919) % 100000 }));
let demoSel = $state<Selection>(emptySelection);
let demoSort = $state<SortState | null>(null);
const demoSorted = $derived(demoSort ? [...demoRows].sort((a, b) => (demoSort!.dir === "desc" ? b.dl - a.dl : a.dl - b.dl)) : demoRows);
```

Am Ende des Inhalts ergänzen:

```svelte
<SectionLabel>DataTable (5.000 Zeilen)</SectionLabel>
<div class="relative h-96 rounded-md border">
	<DataTable
		rows={demoSorted}
		getId={(r) => r.id}
		columns={[
			{ key: "name", label: "Mod", width: "minmax(0,1fr)" },
			{ key: "dl", label: "Downl.", width: "90px", align: "right", sortable: true },
		]}
		bind:selection={demoSel}
		bind:sort={demoSort}
		class="h-full"
	>
		{#snippet cell(r, key)}
			{#if key === "name"}<span class="text-row font-semibold">{r.name}</span>{:else}<span class="font-mono text-xs">{r.dl}</span>{/if}
		{/snippet}
		{#snippet menu(ids)}
			<ContextMenu.Label>{ids.length} ausgewählt</ContextMenu.Label>
			<ContextMenu.Item>Zum Profil hinzufügen <ContextMenu.Shortcut>Enter</ContextMenu.Shortcut></ContextMenu.Item>
		{/snippet}
	</DataTable>
	<SelectionBar count={demoSel.ids.size} onclear={() => (demoSel = { ...demoSel, ids: new Set(), anchor: null })} hint="Shift+Klick Bereich · Strg+A alle">
		<Button size="sm">Zum Profil hinzufügen</Button>
	</SelectionBar>
</div>
```

- [ ] **Step 5: autofixer und Gate**

`svelte-autofixer` auf beide neuen Dateien und den Schaukasten anwenden. Danach `npm test && npm run check && npm run build`.

- [ ] **Step 6: Manuelle Prüfung im Schaukasten**

Expected:

- Das Scrollen durch 5.000 Zeilen ist flüssig; im DOM liegen nur rund 20–30 Zeilen.
- Klick, Strg+Klick und Shift+Klick verhalten sich wie im Explorer.
- Strg+A wählt alle, Esc hebt die Auswahl auf, Pfeiltasten und Bild↑/↓ scrollen mit.
- Ein Rechtsklick außerhalb der Auswahl wählt die Zeile und öffnet das Menü. Ein Rechtsklick in die Auswahl behält sie.
- Die Sortierung schaltet bei Klicks durch ↓, ↑ und aus.
- Strg+A im Suchfeld einer Seite markiert dort nur den Text.

- [ ] **Step 7: Commit**

```bash
git add src/lib/components/kit src/routes/dev
git commit -m "feat(kit): virtualized DataTable with explorer-style selection, keyboard and context menu

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: App-Shell: Werkzeugleiste, Profilwahl, Spielen, Statusleiste, Routen, globale Kürzel

**Files:**

- Create: `src/lib/components/shell/nav-tabs.svelte`, `profile-switcher.svelte`, `play-button.svelte`, `status-bar.svelte`, `top-bar.svelte`
- Modify: `src/lib/components/app/NameDialog.svelte`, `ImportProfileDialog.svelte`, `ExportCodeDialog.svelte` (Importe auf Kit)
- Rewrite: `src/routes/+layout.svelte`
- Create: `src/routes/installed/+page.svelte`; Delete: `src/routes/profile/`
- Modify: `src/lib/api/store.svelte.ts` (`modStatus`)

**Interfaces:**

- Consumes: Kit (Task 4/5), `installDesktopGuards` und `bindShortcuts` (Task 3), `modStatus` (Task 3).
- Produces:
  - `store.modStatus(id: string): ModStatus`
  - Suchfelder auf Seiten tragen `data-search`; Strg+K und Strg+F fokussieren das erste davon.
  - Routen: `/`, `/installed`, `/config`, `/logs`, `/settings`.

- [ ] **Step 1: Store**

In `src/lib/api/store.svelte.ts` den Import `import { modStatus, type ModStatus } from "./status";` ergänzen. Nach der Methode `status(id)` einfügen:

```ts
	/** Ein Status je Paket für Listen und Detail-Panel (siehe status.ts). */
	modStatus(id: string): ModStatus {
		return modStatus(id, { mods: this.modsMap, updates: this.state.updates, resolved: this.state.plan?.resolved });
	}
```

- [ ] **Step 2: Dialog-Importe umstellen**

In `NameDialog.svelte`, `ImportProfileDialog.svelte` und `ExportCodeDialog.svelte` jede Zeile `import … from "$lib/components/ui/…"` durch den passenden Import aus `"$lib/components/kit"` ersetzen. Beispiel: `import { Button, Input, Label, Checkbox, Dialog } from "$lib/components/kit";`. Dafür vorher in jeder Datei prüfen, welche Namen sie benutzt. `Dialog` ist im Kit ein Namespace, genau wie zuvor `* as Dialog`.

- [ ] **Step 3: `nav-tabs.svelte`**

```svelte
<script lang="ts">
	import { page } from "$app/state";
	import { resolve } from "$app/paths";
	import { store } from "$lib/api/store.svelte";
	import { cn } from "$lib/utils";

	const tabs = $derived([
		{ href: resolve("/"), label: "Durchsuchen", count: null },
		{ href: resolve("/installed"), label: "Installiert", count: store.state.mods.length || null },
		{ href: resolve("/config"), label: "Config", count: null },
		{ href: resolve("/logs"), label: "Log", count: null },
	]);
</script>

<nav class="flex gap-0.5" aria-label="Hauptnavigation">
	{#each tabs as t, i (t.href)}
		<a
			href={t.href}
			title="{t.label} (Strg+{i + 1})"
			aria-current={page.url.pathname === t.href ? "page" : undefined}
			class={cn(
				"text-foreground-soft hover:text-foreground text-row flex items-center gap-1.5 rounded-[5px] px-3 py-[7px] font-medium",
				"aria-[current=page]:bg-muted aria-[current=page]:text-foreground",
			)}
		>
			{t.label}
			{#if t.count}<span class="text-subtle-foreground text-meta font-mono">{t.count}</span>{/if}
		</a>
	{/each}
</nav>
```

- [ ] **Step 4: `profile-switcher.svelte`** (übernimmt die Profilaktionen aus `ProfileView`)

```svelte
<script lang="ts">
	import { save as saveDialog } from "@tauri-apps/plugin-dialog";
	import ChevronDown from "@lucide/svelte/icons/chevron-down";
	import { ConfirmDialog, DropdownMenu } from "$lib/components/kit";
	import NameDialog from "$lib/components/app/NameDialog.svelte";
	import ImportProfileDialog from "$lib/components/app/ImportProfileDialog.svelte";
	import ExportCodeDialog from "$lib/components/app/ExportCodeDialog.svelte";
	import { store } from "$lib/api/store.svelte";
	import { initials } from "$lib/format";

	let newOpen = $state(false);
	let renameOpen = $state(false);
	let cloneOpen = $state(false);
	let importOpen = $state(false);
	let deleteOpen = $state(false);
	let exportCode = $state<string | null>(null);

	const active = $derived(store.state.active);
	const updates = $derived(Object.keys(store.state.updates).length);

	export function openNew() {
		newOpen = true;
	}

	async function share() {
		exportCode = await store.exportCode();
	}

	async function exportFile() {
		if (!active) return;
		const path = await saveDialog({ defaultPath: `${active}.r2z`, filters: [{ name: "r2modman-Profil", extensions: ["r2z"] }] });
		if (path) await store.exportFile(path);
	}
</script>

<DropdownMenu.Root>
	<DropdownMenu.Trigger>
		{#snippet child({ props })}
			<button {...props} class="border-input bg-raised hover:bg-muted flex min-w-[250px] items-center gap-2.5 rounded-md border py-1.5 pr-2.5 pl-2 text-left">
				<span class="bg-primary-soft text-primary-text text-meta flex size-[26px] items-center justify-center rounded-[4px] font-mono font-semibold">
					{active ? initials(active) : "–"}
				</span>
				<span class="flex min-w-0 flex-1 flex-col gap-px">
					<span class="truncate text-[13px] font-semibold">{active ?? "Kein Profil"}</span>
					<span class="text-muted-foreground text-meta font-mono">
						{store.state.mods.length} Mods{#if updates}
							· <span class="text-primary">{updates} Updates</span>{/if}
					</span>
				</span>
				<ChevronDown class="text-muted-foreground size-3.5" />
			</button>
		{/snippet}
	</DropdownMenu.Trigger>
	<DropdownMenu.Content align="start" class="w-72">
		<DropdownMenu.Label>Profile</DropdownMenu.Label>
		<DropdownMenu.RadioGroup value={active ?? ""} onValueChange={(v) => v && v !== active && store.activateProfile(v)}>
			{#each store.state.profiles as p (p)}
				<DropdownMenu.RadioItem value={p}>{p}</DropdownMenu.RadioItem>
			{/each}
		</DropdownMenu.RadioGroup>
		<DropdownMenu.Separator />
		<DropdownMenu.Item onSelect={() => (newOpen = true)}>Neues Profil…<DropdownMenu.Shortcut>Strg N</DropdownMenu.Shortcut></DropdownMenu.Item>
		<DropdownMenu.Item onSelect={() => (importOpen = true)}>Importieren…</DropdownMenu.Item>
		{#if active}
			<DropdownMenu.Item disabled={!store.state.mods.length} onSelect={share}>Teilen (Code)…</DropdownMenu.Item>
			<DropdownMenu.Item onSelect={exportFile}>Exportieren (.r2z)…</DropdownMenu.Item>
			<DropdownMenu.Separator />
			<DropdownMenu.Item onSelect={() => (renameOpen = true)}>Umbenennen…</DropdownMenu.Item>
			<DropdownMenu.Item onSelect={() => (cloneOpen = true)}>Klonen…</DropdownMenu.Item>
			<DropdownMenu.Item onSelect={() => store.openFolder("profile")}>Ordner öffnen</DropdownMenu.Item>
			<DropdownMenu.Item onSelect={() => store.repair()}>Reparieren</DropdownMenu.Item>
			<DropdownMenu.Separator />
			<DropdownMenu.Item variant="destructive" onSelect={() => (deleteOpen = true)}>Profil löschen…</DropdownMenu.Item>
		{/if}
	</DropdownMenu.Content>
</DropdownMenu.Root>

<NameDialog bind:open={newOpen} title="Neues Profil" description="Name für das neue Mod-Profil." submitLabel="Anlegen" onSubmit={(n) => store.newProfile(n)} />
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
<ConfirmDialog
	bind:open={deleteOpen}
	title={`Profil „${active}“ löschen?`}
	description="Mods, Configs und Log dieses Profils werden gelöscht."
	confirmLabel="Löschen"
	destructive
	onconfirm={() => store.deleteActiveProfile()}
/>
```

Prüfpunkt: Heißt das Prop für destruktive Einträge in der generierten `dropdown-menu-item.svelte` nicht `variant`, den Namen dort nachsehen und übernehmen. Gleiches gilt für `onSelect`.

- [ ] **Step 5: `play-button.svelte`**

```svelte
<script lang="ts">
	import { goto } from "$app/navigation";
	import { resolve } from "$app/paths";
	import { DropdownMenu, SplitButton } from "$lib/components/kit";
	import { store } from "$lib/api/store.svelte";
</script>

<SplitButton onclick={() => store.launch(true)} disabled={store.launching || !store.state.active} menuLabel="Weitere Startoptionen">
	{store.launching ? "Startet…" : "▶ Spielen"}
	{#snippet menu()}
		<DropdownMenu.Item disabled={store.launching} onSelect={() => store.launch(false)}>Ohne Mods starten (Vanilla)</DropdownMenu.Item>
		<DropdownMenu.Item onSelect={() => store.openFolder("game")}>Spielordner öffnen</DropdownMenu.Item>
		<DropdownMenu.Item onSelect={() => goto(resolve("/logs"))}>Log anzeigen</DropdownMenu.Item>
	{/snippet}
</SplitButton>
```

- [ ] **Step 6: `status-bar.svelte`** (ersetzt `SyncIndicator`)

```svelte
<script lang="ts">
	import { resolve } from "$app/paths";
	import { writeText } from "@tauri-apps/plugin-clipboard-manager";
	import { store } from "$lib/api/store.svelte";
	import { relativeTime } from "$lib/format";

	const VERBS = { download: "Lade", remove: "Entferne", extract: "Installiere" } as const;
	const progress = $derived(store.syncProgress);

	async function copyCode() {
		const code = await store.exportCode();
		if (!code) return;
		await writeText(code);
		store.toast("Profil-Code kopiert.", "ok");
	}
</script>

<footer class="bg-chrome text-muted-foreground h-statusbar text-meta flex shrink-0 items-center gap-5 border-t px-3.5 font-mono">
	{#if store.state.game.found}
		<span class="flex items-center gap-1.5"><span class="bg-success size-1.5 rounded-full"></span>Valheim gefunden</span>
	{:else}
		<a href={resolve("/settings")} class="text-destructive-text flex items-center gap-1.5 hover:underline">
			<span class="bg-destructive size-1.5 rounded-full"></span>Valheim nicht gefunden – Einstellungen
		</a>
	{/if}

	<span>
		{#if store.indexLoading && !store.packages.length}Index lädt…
		{:else if store.indexError}<span class="text-destructive-text">{store.indexError}</span>
		{:else if store.indexFetchedAt}Index {relativeTime(store.indexFetchedAt)}{/if}
	</span>

	{#if progress}
		<span class="flex min-w-0 items-center gap-2" title={progress.id}>
			<span class="truncate">{VERBS[progress.phase]} {progress.id}</span>
			<span class="bg-muted h-1 w-[120px] shrink-0 overflow-hidden rounded-full">
				<span class="bg-primary block h-full" style:width="{progress.total ? (progress.done / progress.total) * 100 : 0}%"></span>
			</span>
			{progress.done}/{progress.total}
		</span>
	{:else if store.state.sync.running}
		<span class="flex items-center gap-1.5"><span class="bg-primary size-1.5 animate-pulse rounded-full"></span>Synchronisiere…</span>
	{/if}

	<span class="flex-1"></span>
	{#if store.state.active && store.state.mods.length}
		<button class="hover:text-foreground" onclick={copyCode}>Profil-Code kopieren</button>
	{/if}
</footer>
```

- [ ] **Step 7: `top-bar.svelte`**

```svelte
<script lang="ts">
	import { page } from "$app/state";
	import { resolve } from "$app/paths";
	import { cn } from "$lib/utils";
	import NavTabs from "./nav-tabs.svelte";
	import PlayButton from "./play-button.svelte";
	import ProfileSwitcher from "./profile-switcher.svelte";

	let switcher = $state<ReturnType<typeof ProfileSwitcher>>();

	export function newProfile() {
		switcher?.openNew();
	}
</script>

<div class="bg-panel h-toolbar flex shrink-0 items-center gap-5 border-b px-3.5">
	<ProfileSwitcher bind:this={switcher} />
	<NavTabs />
	<div class="flex-1"></div>
	<a
		href={resolve("/settings")}
		title="Einstellungen (Strg+,)"
		aria-current={page.url.pathname === resolve("/settings") ? "page" : undefined}
		class={cn(
			"text-foreground-soft hover:text-foreground rounded-[5px] px-2.5 py-[7px] text-[13px]",
			"aria-[current=page]:bg-muted aria-[current=page]:text-foreground",
		)}
	>
		Einstellungen
	</a>
	<PlayButton />
</div>
```

- [ ] **Step 8: `src/routes/+layout.svelte` neu schreiben**

```svelte
<script lang="ts">
	import "../app.css";
	import { onMount } from "svelte";
	import { goto } from "$app/navigation";
	import { resolve } from "$app/paths";
	import { Toaster } from "$lib/components/kit";
	import TitleBar from "$lib/components/shell/title-bar.svelte";
	import TopBar from "$lib/components/shell/top-bar.svelte";
	import StatusBar from "$lib/components/shell/status-bar.svelte";
	import { store } from "$lib/api/store.svelte";
	import { installDesktopGuards } from "$lib/desktop/guards";
	import { bindShortcuts } from "$lib/desktop/shortcuts";

	let { children } = $props();
	let topBar = $state<ReturnType<typeof TopBar>>();

	function focusSearch() {
		const el = document.querySelector<HTMLInputElement>("[data-search]");
		el?.focus();
		el?.select();
	}

	onMount(() => {
		const offGuards = installDesktopGuards();
		const offKeys = bindShortcuts({
			"Mod+K": focusSearch,
			"Mod+F": focusSearch,
			"Mod+1": () => goto(resolve("/")),
			"Mod+2": () => goto(resolve("/installed")),
			"Mod+3": () => goto(resolve("/config")),
			"Mod+4": () => goto(resolve("/logs")),
			"Mod+,": () => goto(resolve("/settings")),
			"Mod+N": () => topBar?.newProfile(),
			"Mod+Enter": () => store.state.active && !store.launching && store.launch(true),
			F5: () => store.refreshIndex(),
		});

		let cleanup: (() => void) | undefined;
		let disposed = false;
		store.init().then((c) => {
			if (disposed) c();
			else cleanup = c;
		});
		return () => {
			disposed = true;
			cleanup?.();
			offKeys();
			offGuards();
		};
	});
</script>

<div class="flex h-screen flex-col">
	<TitleBar />
	<TopBar bind:this={topBar} />
	<main class="min-h-0 flex-1">{@render children()}</main>
	<StatusBar />
</div>

<Toaster theme="dark" position="bottom-right" offset={{ bottom: 40, right: 16 }} />
```

Prüfpunkt: Akzeptiert die eingesetzte svelte-sonner-Version für `offset` kein Objekt (Typfehler in `npm run check`), stattdessen `offset="40px"` verwenden.

- [ ] **Step 9: Route `/installed`**

`src/routes/installed/+page.svelte` vorübergehend, bis Task 8:

```svelte
<script lang="ts">
	import ProfileView from "$lib/components/app/ProfileView.svelte";
</script>

<div class="h-full overflow-hidden p-4"><ProfileView /></div>
```

Run: `git rm -r src/routes/profile`

Die übrigen `+page.svelte` (`/`, `/config`, `/logs`, `/settings`) bekommen vorübergehend den Wrapper `<div class="h-full overflow-hidden p-4">…</div>`, weil das Layout kein Padding mehr setzt. Task 7 bis 10 ersetzt sie. Den `PackageSheet`-Import und die Komponente in `src/routes/+page.svelte` ergänzen: `<PackageSheet />` nach `<ModsTab />`. Das Layout bindet ihn nicht mehr ein; bis Task 7 bleibt das Detail-Sheet so erreichbar. Gleiches gilt für `src/routes/installed/+page.svelte`.

- [ ] **Step 10: autofixer und Gate**

`svelte-autofixer` auf alle neuen und geänderten `.svelte`-Dateien anwenden. Danach `npm test && npm run check && npm run build`.

- [ ] **Step 11: Manuelle Prüfung**

Run: `npm run tauri dev`
Expected:

- Die Werkzeugleiste entspricht 1a: Profilkarte, Tabs, Einstellungen, ▶ Spielen ▾.
- Die Profilwahl wechselt Profile. Alle Profilaktionen funktionieren, Löschen fragt per Dialog nach.
- Strg+1 bis Strg+4 und Strg+, wechseln die Seite, Strg+K fokussiert die Suche, F5 aktualisiert den Index.
- F5 lädt die Seite in einem Release-Build nicht neu; prüfen mit `npm run tauri build -- --debug` oder `--no-bundle`.
- Die Statusleiste zeigt Spielstatus, Indexalter und den Sync-Fortschritt.
- Ein Rechtsklick außerhalb von Eingabefeldern zeigt kein Browser-Menü. Im Suchfeld gibt es Kopieren und Einfügen.

- [ ] **Step 12: Commit**

```bash
git add -A src/routes src/lib/components/shell src/lib/components/app src/lib/api/store.svelte.ts
git commit -m "feat(shell): Werkbank top bar with profile switcher, play split button, status bar and global shortcuts

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Durchsuchen nach 1a: Filterleiste, Tabelle, Detail-Panel, Mehrfachauswahl

**Files:**

- Create: `src/lib/browse/filter.ts`, `src/lib/browse/filter.test.ts`
- Modify: `src/lib/api/store.svelte.ts` (`BrowseFilters`, `addMods`, `removeMods`, `updateMods`; `drawerId` und `openPackage` entfallen)
- Create: `src/lib/components/app/BrowseView.svelte`, `src/lib/components/app/PackageDetail.svelte`
- Modify: `src/routes/+page.svelte`

**Interfaces:**

- Consumes: `DataTable`, `SelectionBar`, `Segmented`, `TriCheckbox`, `StatusPill`, `ModAvatar`, `Stat`, `PanelSection`, `ContextMenu`, `Resizable` und `Switch` aus dem Kit.
- Produces:
  - `filter.ts`:
    - `type StatusFilter = "all" | "inProfile" | "installed" | "updates"`
    - `interface BrowseCriteria { query: string; status: StatusFilter; categories: ReadonlySet<string>; owners: ReadonlySet<string>; ageDays: number; showDeprecated: boolean; showNsfw: boolean }`
    - `interface ProfileFacts { inProfile(id: string): boolean; installed(id: string): boolean; hasUpdate(id: string): boolean }`
    - `normalize(s: string): string`
    - `matchesCriteria(p: SlimPkg, c: BrowseCriteria, f: ProfileFacts, now: number, skip?: { cat?: boolean; owner?: boolean }): boolean`
    - `sortPackages(list: SlimPkg[], sort: SortState | null, query: string): SlimPkg[]`
    - `countBy(list: SlimPkg[], keys: (p: SlimPkg) => Iterable<string>): Map<string, number>`
  - Store:
    - `browse.status: StatusFilter`, `browse.sort: SortState | null`, `browse.selection: Selection`
    - `addMods(ids: string[])`, `removeMods(ids: string[])`, `updateMods(ids: string[])`
  - `PackageDetail { id: string; onclose?: () => void }`

- [ ] **Step 1: Fehlschlagender Test `src/lib/browse/filter.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import type { SlimPkg } from "$lib/api/types";
import { countBy, matchesCriteria, sortPackages, type BrowseCriteria, type ProfileFacts } from "./filter";

const NOW = Date.UTC(2026, 9, 2);
const DAY = 86_400_000;
const pkg = (o: Partial<SlimPkg>): SlimPkg => ({
	id: "A-Mod",
	ns: "A",
	name: "Mod",
	desc: "",
	icon: "",
	ver: "1.0.0",
	cats: [],
	rating: 0,
	dl: 0,
	upd: NOW,
	dep: false,
	nsfw: false,
	pinned: false,
	ndeps: 0,
	size: 0,
	...o,
});
const crit = (o: Partial<BrowseCriteria> = {}): BrowseCriteria => ({
	query: "",
	status: "all",
	categories: new Set(),
	owners: new Set(),
	ageDays: 0,
	showDeprecated: false,
	showNsfw: false,
	...o,
});
const none: ProfileFacts = { inProfile: () => false, installed: () => false, hasUpdate: () => false };

describe("matchesCriteria", () => {
	it("hides deprecated and nsfw unless enabled", () => {
		expect(matchesCriteria(pkg({ dep: true }), crit(), none, NOW)).toBe(false);
		expect(matchesCriteria(pkg({ dep: true }), crit({ showDeprecated: true }), none, NOW)).toBe(true);
		expect(matchesCriteria(pkg({ nsfw: true }), crit(), none, NOW)).toBe(false);
	});
	it("matches query across name, author and description, ignoring spaces, dashes and case", () => {
		const p = pkg({ name: "EpicLoot", ns: "RandyKnapp", desc: "Magic items" });
		expect(matchesCriteria(p, crit({ query: "epic loot" }), none, NOW)).toBe(true);
		expect(matchesCriteria(p, crit({ query: "randy-knapp" }), none, NOW)).toBe(true);
		expect(matchesCriteria(p, crit({ query: "seasons" }), none, NOW)).toBe(false);
	});
	it("requires all selected categories and any selected owner", () => {
		const p = pkg({ cats: ["Items", "Client-side"], ns: "Therzie" });
		expect(matchesCriteria(p, crit({ categories: new Set(["Items", "Client-side"]) }), none, NOW)).toBe(true);
		expect(matchesCriteria(p, crit({ categories: new Set(["Items", "Tweaks"]) }), none, NOW)).toBe(false);
		expect(matchesCriteria(p, crit({ categories: new Set(["Tweaks"]) }), none, NOW, { cat: true })).toBe(true);
		expect(matchesCriteria(p, crit({ owners: new Set(["Azumatt", "Therzie"]) }), none, NOW)).toBe(true);
	});
	it("filters by update age", () => {
		expect(matchesCriteria(pkg({ upd: NOW - 40 * DAY }), crit({ ageDays: 30 }), none, NOW)).toBe(false);
		expect(matchesCriteria(pkg({ upd: NOW - 20 * DAY }), crit({ ageDays: 30 }), none, NOW)).toBe(true);
	});
	it("filters by profile status", () => {
		const facts: ProfileFacts = { inProfile: (id) => id === "A-Mod", installed: () => false, hasUpdate: () => false };
		expect(matchesCriteria(pkg({}), crit({ status: "inProfile" }), facts, NOW)).toBe(true);
		expect(matchesCriteria(pkg({}), crit({ status: "updates" }), facts, NOW)).toBe(false);
	});
});

describe("sortPackages", () => {
	const list = [
		pkg({ id: "a", name: "Beta", dl: 5, rating: 9 }),
		pkg({ id: "b", name: "alpha", dl: 50, rating: 1 }),
		pkg({ id: "c", name: "Gamma", dl: 1, rating: 5 }),
	];
	it("sorts by column and direction without mutating the input", () => {
		expect(sortPackages(list, { key: "dl", dir: "desc" }, "").map((p) => p.id)).toEqual(["b", "a", "c"]);
		expect(sortPackages(list, { key: "mod", dir: "asc" }, "").map((p) => p.id)).toEqual(["b", "a", "c"]);
		expect(list.map((p) => p.id)).toEqual(["a", "b", "c"]);
	});
	it("defaults to rating, and puts exact name matches first when searching", () => {
		expect(sortPackages(list, null, "").map((p) => p.id)).toEqual(["a", "c", "b"]);
		expect(sortPackages(list, null, "gamma")[0].id).toBe("c");
	});
});

describe("countBy", () => {
	it("counts keys over packages", () => {
		const m = countBy([pkg({ cats: ["X", "Y"] }), pkg({ cats: ["X"] })], (p) => p.cats);
		expect(m.get("X")).toBe(2);
		expect(m.get("Y")).toBe(1);
	});
});
```

Run: `npm test -- src/lib/browse`
Expected: FAIL, Modul fehlt.

- [ ] **Step 2: `src/lib/browse/filter.ts`**

```ts
// Filter- und Sortierlogik der Durchsuchen-Seite, ohne Svelte-Abhängigkeit.
import type { SlimPkg } from "$lib/api/types";
import type { SortState } from "$lib/components/kit/types";

export type StatusFilter = "all" | "inProfile" | "installed" | "updates";

export interface BrowseCriteria {
	query: string;
	status: StatusFilter;
	categories: ReadonlySet<string>;
	owners: ReadonlySet<string>;
	ageDays: number;
	showDeprecated: boolean;
	showNsfw: boolean;
}

export interface ProfileFacts {
	inProfile(id: string): boolean;
	installed(id: string): boolean;
	hasUpdate(id: string): boolean;
}

export function normalize(s: string): string {
	return s.toLowerCase().replace(/[\s_-]/g, "");
}

export function matchesCriteria(p: SlimPkg, c: BrowseCriteria, f: ProfileFacts, now: number, skip: { cat?: boolean; owner?: boolean } = {}): boolean {
	if (!c.showDeprecated && p.dep) return false;
	if (!c.showNsfw && p.nsfw) return false;
	if (c.ageDays && now - p.upd > c.ageDays * 86_400_000) return false;
	if (!skip.cat && c.categories.size && ![...c.categories].every((x) => p.cats.includes(x))) return false;
	if (!skip.owner && c.owners.size && !c.owners.has(p.ns)) return false;
	if (c.status === "inProfile" && !f.inProfile(p.id)) return false;
	if (c.status === "installed" && !f.installed(p.id)) return false;
	if (c.status === "updates" && !f.hasUpdate(p.id)) return false;
	if (c.query && !normalize(`${p.name} ${p.ns} ${p.desc}`).includes(normalize(c.query))) return false;
	return true;
}

const COMPARE: Record<string, (a: SlimPkg, b: SlimPkg) => number> = {
	mod: (a, b) => a.name.localeCompare(b.name, "de", { sensitivity: "base" }),
	author: (a, b) => a.ns.localeCompare(b.ns, "de", { sensitivity: "base" }),
	dl: (a, b) => a.dl - b.dl,
	upd: (a, b) => a.upd - b.upd,
	rating: (a, b) => a.rating - b.rating,
};

/** Liefert eine neue, sortierte Liste. Ohne Spaltensortierung: exakte Namenstreffer zuerst, dann Bewertung. */
export function sortPackages(list: SlimPkg[], sort: SortState | null, query: string): SlimPkg[] {
	const out = [...list];
	const cmp = sort ? COMPARE[sort.key] : undefined;
	if (cmp) {
		const dir = sort!.dir === "asc" ? 1 : -1;
		return out.sort((a, b) => dir * cmp(a, b));
	}
	const q = normalize(query);
	return out.sort((a, b) => {
		if (q) {
			const d = Number(normalize(b.name) === q) - Number(normalize(a.name) === q);
			if (d) return d;
		}
		return b.rating - a.rating;
	});
}

export function countBy(list: SlimPkg[], keys: (p: SlimPkg) => Iterable<string>): Map<string, number> {
	const m = new Map<string, number>();
	for (const p of list) for (const k of keys(p)) m.set(k, (m.get(k) ?? 0) + 1);
	return m;
}
```

Run: `npm test -- src/lib/browse`
Expected: PASS.

Hinweis zu `sortPackages(list, { key: "mod", dir: "asc" })`: Erwartet ist [alpha, Beta, Gamma], also `["b","a","c"]`. `localeCompare` mit `sensitivity: "base"` ignoriert dabei die Großschreibung.

- [ ] **Step 3: Store anpassen**

In `src/lib/api/store.svelte.ts`:

1. Importe: `import type { SortState } from "$lib/components/kit/types";`, `import { emptySelection, type Selection } from "$lib/desktop/selection";`, `import type { StatusFilter } from "$lib/browse/filter";`.
2. `export type StatusFlag …` und `export type SortKey …` löschen.
3. Die Klasse `BrowseFilters` ersetzen:

```ts
/** Filter, Sortierung und Auswahl der Durchsuchen-Seite; bleiben beim Seitenwechsel erhalten. */
class BrowseFilters {
	query = $state("");
	status = $state<StatusFilter>("all");
	sort = $state<SortState | null>(null);
	categories = $state<Set<string>>(new Set());
	owners = $state<Set<string>>(new Set());
	ageDays = $state(0);
	showDeprecated = $state(false);
	showNsfw = $state(false);
	selection = $state.raw<Selection>(emptySelection);

	reset() {
		this.query = "";
		this.status = "all";
		this.categories = new Set();
		this.owners = new Set();
		this.ageDays = 0;
		this.showDeprecated = false;
	}
}
```

4. `drawerId`, `openPackage()` und die Leerung `this.drawerId = null` entfernen. `filterCategory` und `filterOwner` bleiben.
5. Nach `updateAll()` einfügen:

```ts
	/** Mehrfachauswahl: fehlende Pakete in neuester Version hinzufügen. */
	async addMods(ids: string[]) {
		const add = ids
			.filter((id) => !this.modsMap.has(id))
			.map((id) => this.byId.get(id))
			.filter((p): p is SlimPkg => !!p)
			.map((p) => ({ namespace: p.ns, name: p.name, version: p.ver, enabled: true, source: "thunderstore" as const }));
		if (!add.length) return;
		await this.setMods([...this.state.mods, ...add]);
		this.toast(add.length === 1 ? `${add[0].name} hinzugefügt.` : `${add.length} Mods hinzugefügt.`, "ok");
	}

	async removeMods(ids: string[]) {
		const drop = new Set(ids);
		const next = this.state.mods.filter((m) => !drop.has(modId(m)));
		if (next.length === this.state.mods.length) return;
		await this.setMods(next);
	}

	async updateMods(ids: string[]) {
		const pick = new Set(ids);
		await this.setMods(
			this.state.mods.map((m) => (pick.has(modId(m)) ? { ...m, version: this.state.updates[modId(m)] ?? m.version } : m))
		);
	}
```

6. `loadSettings` setzt weiterhin `this.browse.showNsfw`, das bleibt so.

- [ ] **Step 4: `src/lib/components/app/PackageDetail.svelte`** (ersetzt das Sheet; Layout 1a rechts)

```svelte
<script lang="ts">
	import { goto } from "$app/navigation";
	import { resolve } from "$app/paths";
	import { openUrl } from "@tauri-apps/plugin-opener";
	import { Button, Chip, ModAvatar, PanelSection, Stat } from "$lib/components/kit";
	import { store } from "$lib/api/store.svelte";
	import type { Pkg } from "$lib/api/types";
	import { formatBytes, formatNumber, relativeTime } from "$lib/format";

	let { id }: { id: string } = $props();

	let pkg = $state<Pkg | null>(null);
	let error = $state<string | null>(null);

	$effect(() => {
		const current = id;
		pkg = null;
		error = null;
		store
			.getPackage(current)
			.then((p) => {
				if (id === current) pkg = p;
			})
			.catch((e: unknown) => {
				if (id === current) error = e instanceof Error ? e.message : "Paket konnte nicht geladen werden.";
			});
	});

	const status = $derived(store.modStatus(id));
	const mod = $derived(store.modsMap.get(id));
	const update = $derived(store.state.updates[id]);
	const latest = $derived(pkg?.versions[0]);

	function depId(dep: string) {
		const parts = dep.split("-");
		return { id: `${parts[0]}-${parts.slice(1, -1).join("-")}`, version: parts[parts.length - 1] };
	}

	function primary() {
		if (status === "update") return store.toggleMod(id, update);
		if (mod) return store.removeMod(id);
		return store.toggleMod(id);
	}

	function filterBy(fn: () => void) {
		fn();
		goto(resolve("/"));
	}
</script>

<aside class="bg-panel flex h-full flex-col overflow-y-auto border-l">
	{#if error}
		<p class="text-destructive-text p-5 text-sm">{error}</p>
	{:else if !pkg}
		<p class="text-muted-foreground p-5 text-sm">Lädt…</p>
	{:else}
		<div class="flex flex-col gap-3.5 border-b p-5">
			<div class="flex items-center gap-3.5">
				<ModAvatar name={pkg.name} icon={pkg.icon} size="lg" />
				<div class="flex min-w-0 flex-col gap-[3px]">
					<h2 class="truncate text-lg font-bold">{pkg.name}</h2>
					<p class="text-muted-foreground text-[12.5px]">
						von <button class="text-foreground-soft hover:underline" onclick={() => filterBy(() => store.filterOwner(pkg!.ns))}>{pkg.ns}</button>
					</p>
				</div>
			</div>
			<p class="text-foreground-soft selectable text-[13px] leading-normal">{pkg.desc}</p>
			<div class="flex gap-2">
				<Button class="flex-1" variant={mod && status !== "update" ? "outline" : "default"} onclick={primary}>
					{status === "update" ? `Aktualisieren auf ${update}` : mod ? "Aus Profil entfernen" : "Zum Profil hinzufügen"}
				</Button>
				<Button variant="outline" onclick={() => openUrl(pkg!.url)}>Thunderstore ↗</Button>
			</div>
		</div>

		<div class="grid grid-cols-3 border-b px-5 py-3">
			<Stat label="Downloads" value={formatNumber(pkg.dl)} />
			<Stat label="Bewertung" value={`★ ${pkg.rating}`} />
			<Stat label="Größe" value={latest ? formatBytes(latest.size) : "—"} />
		</div>

		{#if pkg.cats.length}
			<PanelSection title="Kategorien">
				<div class="flex flex-wrap gap-1">
					{#each pkg.cats as cat (cat)}
						<Chip onclick={() => filterBy(() => store.filterCategory(cat))}>{cat}</Chip>
					{/each}
				</div>
			</PanelSection>
		{/if}

		<PanelSection title="Abhängigkeiten" count={latest?.deps.length ?? 0}>
			{#each latest?.deps ?? [] as dep (dep)}
				{@const d = depId(dep)}
				{@const there = store.modsMap.has(d.id) || !!store.state.plan?.resolved[d.id]}
				<div class="flex items-center justify-between text-[13px]">
					<span class="flex items-baseline gap-2 truncate">{d.id}<span class="text-subtle-foreground text-meta font-mono">{d.version}</span></span>
					<span class={there ? "text-success text-xs" : "text-primary text-xs"}>{there ? "✓ im Profil" : "wird mitinstalliert"}</span>
				</div>
			{:else}
				<p class="text-muted-foreground text-[13px]">Keine</p>
			{/each}
		</PanelSection>

		<PanelSection title="Versionen" count={pkg.versions.length}>
			{#each pkg.versions.slice(0, 12) as v, i (v.v)}
				<div class="group flex h-7 items-center gap-2.5 text-[12.5px]">
					<span class="text-foreground-soft w-[70px] font-mono text-xs">{v.v}</span>
					<span class="text-muted-foreground flex-1">{relativeTime(v.date)}</span>
					{#if mod?.version === v.v}<span class="text-success text-meta">installiert</span>
					{:else if i === 0}<span class="text-primary text-meta">neueste</span>{/if}
					{#if mod?.version !== v.v}
						<Button size="sm" variant="ghost" class="invisible h-6 group-hover:visible" onclick={() => store.toggleMod(id, v.v)}>Wählen</Button>
					{/if}
				</div>
			{/each}
		</PanelSection>

		{#if pkg.web}
			<div class="px-5 py-4"><Button variant="ghost" onclick={() => openUrl(pkg!.web)}>Website ↗</Button></div>
		{/if}
	{/if}
</aside>
```

- [ ] **Step 5: `src/lib/components/app/BrowseView.svelte`**

```svelte
<script lang="ts">
	import { openUrl } from "@tauri-apps/plugin-opener";
	import { writeText } from "@tauri-apps/plugin-clipboard-manager";
	import {
		Button,
		ContextMenu,
		DataTable,
		EmptyState,
		Input,
		Kbd,
		ModAvatar,
		Resizable,
		SectionLabel,
		Segmented,
		SelectionBar,
		StatusPill,
		Switch,
		TriCheckbox,
		type Column,
	} from "$lib/components/kit";
	import { store, toggled } from "$lib/api/store.svelte";
	import type { SlimPkg } from "$lib/api/types";
	import { countBy, matchesCriteria, sortPackages, type ProfileFacts, type StatusFilter } from "$lib/browse/filter";
	import { formatNumber, relativeTime } from "$lib/format";
	import PackageDetail from "./PackageDetail.svelte";

	const f = store.browse;
	let catsExpanded = $state(false);
	let ownerQuery = $state("");

	const facts: ProfileFacts = {
		inProfile: (id) => store.modsMap.has(id),
		installed: (id) => id in store.state.installed,
		hasUpdate: (id) => id in store.state.updates,
	};

	const now = $derived(store.indexFetchedAt ?? Date.now());
	const filtered = $derived(
		sortPackages(
			store.packages.filter((p) => matchesCriteria(p, f, facts, now)),
			f.sort,
			f.query,
		),
	);
	const catCounts = $derived(
		countBy(
			store.packages.filter((p) => matchesCriteria(p, f, facts, now, { cat: true })),
			(p) => p.cats,
		),
	);
	const ownerCounts = $derived(
		countBy(
			store.packages.filter((p) => matchesCriteria(p, f, facts, now, { owner: true })),
			(p) => [p.ns],
		),
	);
	const cats = $derived([...new Set([...catCounts.keys(), ...f.categories])].sort((a, b) => (catCounts.get(b) ?? 0) - (catCounts.get(a) ?? 0)));
	const owners = $derived(
		[...new Set([...ownerCounts.keys(), ...f.owners])]
			.filter((o) => f.owners.has(o) || o.toLowerCase().includes(ownerQuery.toLowerCase()))
			.sort((a, b) => (ownerCounts.get(b) ?? 0) - (ownerCounts.get(a) ?? 0))
			.slice(0, 8),
	);
	const updateCount = $derived(Object.keys(store.state.updates).length);
	const focus = $derived(f.selection.focus);
	const selected = $derived([...f.selection.ids]);

	const columns: Column[] = [
		{ key: "mod", label: "Mod", width: "minmax(0,1fr)", sortable: true },
		{ key: "author", label: "Autor", width: "116px", sortable: true },
		{ key: "version", label: "Version", width: "92px" },
		{ key: "dl", label: "Downloads", width: "84px", align: "right", sortable: true },
		{ key: "upd", label: "Update", width: "84px", align: "right", sortable: true },
		{ key: "status", label: "Profil", width: "132px", align: "right" },
	];

	function stop(e: MouseEvent, fn: () => unknown) {
		e.stopPropagation();
		fn();
	}
</script>

<Resizable.PaneGroup direction="horizontal" autoSaveId="browse" class="h-full">
	<!-- Filter -->
	<Resizable.Pane defaultSize={17} minSize={13} maxSize={26} order={1} id="browse-filter">
		<div class="flex h-full flex-col gap-5 overflow-y-auto px-3 py-4">
			<div class="flex flex-col gap-2">
				<SectionLabel>Status</SectionLabel>
				<Segmented
					bind:value={() => f.status, (v) => (f.status = v as StatusFilter)}
					columns={2}
					options={[
						{ value: "all", label: "Alle" },
						{ value: "inProfile", label: "Im Profil" },
						{ value: "installed", label: "Installiert" },
						{ value: "updates", label: "Updates", badge: updateCount, tone: "primary" },
					]}
				/>
			</div>

			<div class="flex flex-col gap-0.5">
				<SectionLabel class="mb-1.5">Kategorie</SectionLabel>
				{#each catsExpanded ? cats : cats.slice(0, 9) as cat (cat)}
					{@const on = f.categories.has(cat)}
					<button
						class="hover:bg-hover flex h-[27px] items-center gap-2 rounded-[4px] px-1.5 text-[13px] {on
							? 'bg-focused text-foreground'
							: 'text-foreground-soft'}"
						onclick={() => store.filterCategory(cat)}
					>
						<TriCheckbox state={on ? 1 : 0} label={cat} />
						<span class="flex-1 truncate text-left">{cat}</span>
						<span class="text-subtle-foreground text-meta font-mono">{formatNumber(catCounts.get(cat) ?? 0)}</span>
					</button>
				{/each}
				{#if cats.length > 9}
					<button class="text-muted-foreground hover:text-foreground px-1.5 py-1 text-left text-xs" onclick={() => (catsExpanded = !catsExpanded)}>
						{catsExpanded ? "Weniger" : `+ ${cats.length - 9} weitere`}
					</button>
				{/if}
			</div>

			<div class="flex flex-col gap-1.5">
				<SectionLabel>Autor</SectionLabel>
				<Input class="h-[30px] text-[12.5px]" placeholder="Autor filtern…" bind:value={ownerQuery} />
				{#each owners as o (o)}
					{@const on = f.owners.has(o)}
					<button
						class="hover:bg-hover flex h-[27px] items-center gap-2 rounded-[4px] px-1.5 text-[13px] {on ? 'bg-focused' : 'text-foreground-soft'}"
						onclick={() => store.filterOwner(o)}
					>
						<TriCheckbox state={on ? 1 : 0} label={o} />
						<span class="flex-1 truncate text-left">{o}</span>
						<span class="text-subtle-foreground text-meta font-mono">{ownerCounts.get(o) ?? 0}</span>
					</button>
				{/each}
			</div>

			<div class="flex flex-col gap-2">
				<SectionLabel>Aktualisiert</SectionLabel>
				<Segmented
					columns={4}
					options={[
						{ value: "7", label: "7 T" },
						{ value: "30", label: "30 T" },
						{ value: "365", label: "1 J" },
						{ value: "0", label: "Alle" },
					]}
					bind:value={() => String(f.ageDays), (v) => (f.ageDays = Number(v))}
				/>
			</div>

			<div class="flex-1"></div>
			<div class="text-foreground-soft flex flex-col gap-2 text-[12.5px]">
				<label class="flex items-center justify-between">Veraltete zeigen <Switch size="sm" bind:checked={f.showDeprecated} /></label>
				<label class="flex items-center justify-between">NSFW zeigen <Switch size="sm" bind:checked={f.showNsfw} /></label>
				<Button variant="ghost" size="sm" class="justify-start px-0" onclick={() => f.reset()}>Filter zurücksetzen</Button>
			</div>
		</div>
	</Resizable.Pane>
	<Resizable.Handle />

	<!-- Ergebnisse -->
	<Resizable.Pane minSize={35} order={2} id="browse-table">
		<div class="relative flex h-full flex-col">
			<div class="flex items-center gap-2.5 border-b px-4 py-3">
				<div class="relative flex-1">
					<Input data-search class="pr-16" placeholder="Mods durchsuchen – Name, Autor, Beschreibung" bind:value={f.query} />
					<span class="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2"><Kbd>Strg K</Kbd></span>
				</div>
				<span class="text-muted-foreground font-mono text-[11.5px] whitespace-nowrap">
					{filtered.length.toLocaleString("de")} Treffer
					{#if store.indexFetchedAt}· Index {relativeTime(store.indexFetchedAt)}{/if}
				</span>
				<Button variant="ghost" size="icon-sm" title="Index aktualisieren (F5)" onclick={() => store.refreshIndex()}>↻</Button>
			</div>

			<DataTable
				class="flex-1"
				rows={filtered}
				getId={(p: SlimPkg) => p.id}
				{columns}
				rowHeight={54}
				bind:selection={f.selection}
				bind:sort={f.sort}
				onactivate={(p) => store.toggleMod(p.id)}
			>
				{#snippet cell(p, key)}
					{#if key === "mod"}
						<div class="flex min-w-0 items-center gap-[11px]">
							<ModAvatar name={p.name} icon={p.icon} size="md" />
							<div class="flex min-w-0 flex-col gap-0.5">
								<span class="text-row truncate font-semibold"
									>{p.name}{#if p.dep}<span class="text-destructive-text text-meta ml-2">veraltet</span>{/if}</span
								>
								<span class="text-muted-foreground truncate text-xs">{p.desc}</span>
							</div>
						</div>
					{:else if key === "author"}
						<span class="text-foreground-soft block truncate text-[12.5px]">{p.ns}</span>
					{:else if key === "version"}
						<span class="text-foreground-soft font-mono text-xs">{p.ver}</span>
					{:else if key === "dl"}
						<span class="text-foreground-soft font-mono text-xs">{formatNumber(p.dl)}</span>
					{:else if key === "upd"}
						<span class="text-muted-foreground text-xs">{relativeTime(p.upd)}</span>
					{:else if key === "status"}
						{@const s = store.modStatus(p.id)}
						{#if s === "none"}
							<Button size="sm" variant="outline" class="h-7" onclick={(e) => stop(e, () => store.toggleMod(p.id))}>+ Hinzufügen</Button>
						{:else}
							<StatusPill status={s} version={store.state.updates[p.id]} onclick={(e) => stop(e, () => store.toggleMod(p.id))} />
						{/if}
					{/if}
				{/snippet}
				{#snippet menu(ids)}
					{@const first = store.byId.get(ids[0])}
					<ContextMenu.Label>{ids.length > 1 ? `${ids.length} Mods ausgewählt` : first?.name}</ContextMenu.Label>
					<ContextMenu.Item onSelect={() => store.addMods(ids)}>
						{ids.length > 1 ? `${ids.length} zum Profil hinzufügen` : "Zum Profil hinzufügen"}<ContextMenu.Shortcut>Enter</ContextMenu.Shortcut>
					</ContextMenu.Item>
					<ContextMenu.Item disabled={!ids.some((id) => id in store.state.updates)} onSelect={() => store.updateMods(ids)}>Aktualisieren</ContextMenu.Item>
					<ContextMenu.Item disabled={!ids.some((id) => store.modsMap.has(id))} onSelect={() => store.removeMods(ids)}>Aus Profil entfernen</ContextMenu.Item>
					{#if first}
						<ContextMenu.Separator />
						<ContextMenu.Item onSelect={() => (f.owners = new Set([first.ns]))}>Nur {first.ns} anzeigen</ContextMenu.Item>
						<ContextMenu.Item onSelect={() => (f.owners = toggled(f.owners, first.ns))}
							>Autor-Filter {f.owners.has(first.ns) ? "entfernen" : "hinzufügen"}</ContextMenu.Item
						>
						<ContextMenu.Separator />
						<ContextMenu.Item disabled={ids.length > 1} onSelect={() => store.getPackage(first.id).then((p) => openUrl(p.url))}
							>Auf Thunderstore öffnen<ContextMenu.Shortcut>↗</ContextMenu.Shortcut></ContextMenu.Item
						>
						<ContextMenu.Item disabled={ids.length > 1} onSelect={() => writeText(first.id)}>ID kopieren</ContextMenu.Item>
					{/if}
				{/snippet}
				{#snippet empty()}
					{#if store.indexLoading && !store.packages.length}
						<EmptyState title="Index wird geladen…" />
					{:else if store.indexError}
						<EmptyState title="Index nicht verfügbar">{store.indexError}</EmptyState>
					{:else}
						<EmptyState title="Keine Treffer">
							Filter lockern oder zurücksetzen.
							{#snippet action()}<Button variant="outline" size="sm" onclick={() => f.reset()}>Filter zurücksetzen</Button>{/snippet}
						</EmptyState>
					{/if}
				{/snippet}
			</DataTable>

			<SelectionBar
				count={selected.length}
				onclear={() => (f.selection = { ...f.selection, ids: new Set(), anchor: null })}
				hint="Shift+Klick Bereich · Strg+A alle · Rechtsklick Menü"
			>
				<Button size="sm" onclick={() => store.addMods(selected)}>Zum Profil hinzufügen</Button>
				<Button size="sm" variant="ghost" disabled={!selected.some((id) => id in store.state.updates)} onclick={() => store.updateMods(selected)}
					>Aktualisieren</Button
				>
				<Button size="sm" variant="ghost" disabled={!selected.some((id) => store.modsMap.has(id))} onclick={() => store.removeMods(selected)}>Entfernen</Button>
			</SelectionBar>
		</div>
	</Resizable.Pane>

	{#if focus}
		<Resizable.Handle />
		<Resizable.Pane defaultSize={25} minSize={18} maxSize={40} order={3} id="browse-detail">
			<PackageDetail id={focus} />
		</Resizable.Pane>
	{/if}
</Resizable.PaneGroup>
```

Prüfpunkte:

- **`Switch size="sm"`:** Fehlt dieses Prop in der generierten `switch.svelte`, `size` weglassen.
- **paneforge-Props:** Die Namen `direction`, `autoSaveId`, `defaultSize`, `minSize`, `maxSize`, `order` und `id` in `src/lib/components/ui/resizable/*.svelte` gegenprüfen. Weichen sie in der installierten Version ab, die dortigen Namen verwenden.
- **`data-search` am Input:** Die shadcn-Komponente `Input` reicht übrige Attribute per `...restProps` durch.

- [ ] **Step 6: Route**

`src/routes/+page.svelte`:

```svelte
<script lang="ts">
	import BrowseView from "$lib/components/app/BrowseView.svelte";
</script>

<BrowseView />
```

Run: `git rm src/lib/components/app/ModsTab.svelte src/lib/components/app/PackageSheet.svelte`. Beide nutzen entfernte Store-Felder und werden nicht mehr gebraucht.

In `src/routes/installed/+page.svelte` den `PackageSheet`-Import und die Komponente aus Task 6 wieder entfernen. `ProfileView` ruft `store.openPackage` auf, die Methode gibt es nicht mehr. Deshalb in `ProfileView.svelte` vorübergehend beide `onclick={() => store.openPackage(id)}` durch `onclick={() => openUrl(\`https://thunderstore.io/c/valheim/p/${id.replace("-", "/")}/\`)}`ersetzen und`import { openUrl } from "@tauri-apps/plugin-opener";`ergänzen. Task 8 ersetzt`ProfileView` vollständig.

- [ ] **Step 7: autofixer und Gate**

`svelte-autofixer` auf `BrowseView.svelte` und `PackageDetail.svelte` anwenden. Danach `npm test && npm run check && npm run build`.
Expected: Grün.

- [ ] **Step 8: Manuelle Prüfung gegen das Design 1a**

Expected:

- Drei Spalten: Filter, Tabelle, Detail. Die Größen lassen sich ziehen und bleiben nach einem Neustart erhalten.
- Klick auf eine Zeile öffnet rechts das Detail; Strg/Shift wählen mehrere.
- Die Auswahlleiste fügt alle gewählten Mods auf einmal hinzu.
- Rechtsklick → „Nur {Autor} anzeigen“ filtert.
- Einen Filter ändern, während weit unten gescrollt ist, zeigt sofort die Treffer.
- Enter auf der fokussierten Zeile schaltet sie im Profil um.

- [ ] **Step 9: Commit**

```bash
git add -A src/lib/browse src/lib/components/app src/lib/api/store.svelte.ts src/routes
git commit -m "feat(browse): Werkbank browse view with filter pane, virtualized table, multi-select and detail panel

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Installiert-Ansicht

**Files:**

- Create: `src/lib/components/app/InstalledView.svelte`
- Modify: `src/lib/api/store.svelte.ts` (`setEnabledMany`)
- Modify: `src/routes/installed/+page.svelte`
- Delete: `src/lib/components/app/ProfileView.svelte`

**Interfaces:**

- Consumes: Kit, `store.addMods`, `removeMods`, `updateMods` (Task 7), `PackageDetail` (Task 7).
- Produces: `store.setEnabledMany(ids: string[], enabled: boolean): Promise<void>`.

- [ ] **Step 1: Store**

Nach `setEnabled` einfügen:

```ts
	/** Mehrfachauswahl: Mods in einem Schritt aktivieren oder deaktivieren. */
	async setEnabledMany(ids: string[], enabled: boolean) {
		const pick = new Set(ids);
		await this.setMods(this.state.mods.map((m) => (pick.has(modId(m)) ? { ...m, enabled } : m)));
	}
```

- [ ] **Step 2: `InstalledView.svelte`**

```svelte
<script lang="ts">
	import { onMount } from "svelte";
	import { getCurrentWebview } from "@tauri-apps/api/webview";
	import { open as openDialog } from "@tauri-apps/plugin-dialog";
	import { openUrl } from "@tauri-apps/plugin-opener";
	import {
		Button,
		ContextMenu,
		DataTable,
		EmptyState,
		Input,
		ModAvatar,
		Resizable,
		Segmented,
		SelectionBar,
		StatusPill,
		Switch,
		emptySelection,
		type Column,
		type Selection,
	} from "$lib/components/kit";
	import { modId, store } from "$lib/api/store.svelte";
	import type { ProfileMod } from "$lib/api/types";
	import { normalize } from "$lib/browse/filter";
	import PackageDetail from "./PackageDetail.svelte";

	type Row = { kind: "mod"; id: string; m: ProfileMod } | { kind: "dep"; id: string; version: string; requiredBy: string[] };

	let query = $state("");
	let show = $state("all");
	let selection = $state.raw<Selection>(emptySelection);
	let dragging = $state(false);

	const plan = $derived(store.state.plan);
	const pending = $derived(new Set(plan?.toInstall.map((t) => t.id) ?? []));
	const updateCount = $derived(Object.keys(store.state.updates).length);

	const rows = $derived.by((): Row[] => {
		const q = normalize(query);
		const hit = (s: string) => !q || normalize(s).includes(q);
		const mods: Row[] = store.state.mods
			.map((m) => ({ kind: "mod" as const, id: modId(m), m }))
			.filter((r) => hit(r.id))
			.filter((r) => show === "all" || (show === "on" ? r.m.enabled : show === "off" ? !r.m.enabled : r.id in store.state.updates));
		if (show !== "all") return mods;
		const deps: Row[] = Object.entries(plan?.resolved ?? {})
			.filter(([id]) => !store.modsMap.has(id) && hit(id))
			.map(([id, r]) => ({ kind: "dep" as const, id, version: r.version, requiredBy: r.requiredBy }));
		return [...mods, ...deps];
	});

	const selectedMods = $derived([...selection.ids].filter((id) => store.modsMap.has(id)));
	const focus = $derived(selection.focus && store.byId.has(selection.focus) ? selection.focus : null);

	const columns: Column[] = [
		{ key: "on", label: "Aktiv", width: "44px" },
		{ key: "mod", label: "Mod", width: "minmax(0,1fr)" },
		{ key: "author", label: "Autor", width: "130px" },
		{ key: "version", label: "Version", width: "100px" },
		{ key: "status", label: "Status", width: "150px", align: "right" },
	];

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
		if (sel) await store.addLocalMods(Array.isArray(sel) ? sel : [sel]);
	}

	function thunderstore(id: string) {
		store.getPackage(id).then((p) => openUrl(p.url));
	}

	function stop(e: Event) {
		e.stopPropagation();
	}
</script>

{#if !store.state.active}
	<EmptyState title="Kein Profil aktiv">Lege oben in der Profilwahl ein Profil an oder importiere eins.</EmptyState>
{:else}
	<Resizable.PaneGroup direction="horizontal" autoSaveId="installed" class="h-full">
		<Resizable.Pane minSize={40} order={1} id="installed-table">
			<div class="relative flex h-full flex-col">
				<div class="flex items-center gap-2.5 border-b px-4 py-3">
					<Input data-search class="max-w-sm" placeholder="Installierte Mods filtern" bind:value={query} />
					<Segmented
						bind:value={show}
						options={[
							{ value: "all", label: "Alle" },
							{ value: "on", label: "Aktiv" },
							{ value: "off", label: "Deaktiviert" },
							{ value: "updates", label: "Updates", badge: updateCount, tone: "primary" },
						]}
					/>
					<div class="flex-1"></div>
					<Button size="sm" variant="outline" onclick={pickLocal}>Lokaler Mod…</Button>
					<Button size="sm" disabled={!updateCount} onclick={() => store.updateAll()}
						>Alle aktualisieren{#if updateCount}
							({updateCount}){/if}</Button
					>
				</div>

				{#if plan?.errors.length}
					<div class="text-destructive-text bg-destructive/10 border-b px-4 py-2 text-[13px]">
						{#each plan.errors as err (err)}<p>{err}</p>{/each}
					</div>
				{/if}

				<DataTable
					class="flex-1"
					{rows}
					getId={(r: Row) => r.id}
					{columns}
					rowHeight={50}
					bind:selection
					rowClass={(r) => (r.kind === "dep" || !r.m.enabled ? "opacity-60" : undefined)}
					ondelete={(ids) => store.removeMods(ids)}
				>
					{#snippet cell(r, key)}
						{#if key === "on"}
							{#if r.kind === "mod"}
								<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
								<span onclick={stop}
									><Switch size="sm" checked={r.m.enabled} onCheckedChange={(v) => store.setEnabled(r.id, v)} aria-label="{r.m.name} aktivieren" /></span
								>
							{/if}
						{:else if key === "mod"}
							{@const name = r.kind === "mod" ? r.m.name : r.id}
							<div class="flex min-w-0 items-center gap-[11px]">
								<ModAvatar {name} icon={store.byId.get(r.id)?.icon} />
								<div class="flex min-w-0 flex-col gap-0.5">
									<span class="text-row truncate font-semibold">{name}</span>
									{#if r.kind === "dep"}
										<span class="text-muted-foreground truncate text-xs"
											>{r.requiredBy.length ? `Benötigt von ${r.requiredBy.join(", ")}` : "Basis (BepInEx)"}</span
										>
									{:else if r.m.source === "local"}
										<span class="text-muted-foreground text-xs">Lokaler Mod</span>
									{/if}
								</div>
							</div>
						{:else if key === "author"}
							<span class="text-foreground-soft block truncate text-[12.5px]">{r.kind === "mod" ? r.m.namespace : r.id.split("-")[0]}</span>
						{:else if key === "version"}
							<span class="text-foreground-soft font-mono text-xs">{r.kind === "mod" ? r.m.version : r.version}</span>
						{:else if key === "status"}
							{#if pending.has(r.id)}
								<span class="text-primary text-xs">wird installiert…</span>
							{:else if r.kind === "mod" && !(r.id in store.state.installed) && r.m.enabled}
								<span class="text-destructive-text text-xs">nicht installiert</span>
							{:else}
								<StatusPill
									status={store.modStatus(r.id)}
									version={store.state.updates[r.id]}
									onclick={(e) => {
										stop(e);
										store.updateMods([r.id]);
									}}
								/>
							{/if}
						{/if}
					{/snippet}
					{#snippet menu(ids)}
						{@const mods = ids.filter((id) => store.modsMap.has(id))}
						<ContextMenu.Label>{ids.length > 1 ? `${ids.length} Einträge ausgewählt` : ids[0]}</ContextMenu.Label>
						<ContextMenu.Item disabled={!mods.length} onSelect={() => store.setEnabledMany(mods, true)}>Aktivieren</ContextMenu.Item>
						<ContextMenu.Item disabled={!mods.length} onSelect={() => store.setEnabledMany(mods, false)}>Deaktivieren</ContextMenu.Item>
						<ContextMenu.Item disabled={!mods.some((id) => id in store.state.updates)} onSelect={() => store.updateMods(mods)}>Aktualisieren</ContextMenu.Item>
						<ContextMenu.Separator />
						<ContextMenu.Item disabled={ids.length > 1 || !store.byId.has(ids[0])} onSelect={() => thunderstore(ids[0])}
							>Auf Thunderstore öffnen<ContextMenu.Shortcut>↗</ContextMenu.Shortcut></ContextMenu.Item
						>
						<ContextMenu.Separator />
						<ContextMenu.Item variant="destructive" disabled={!mods.length} onSelect={() => store.removeMods(mods)}
							>Entfernen<ContextMenu.Shortcut>Entf</ContextMenu.Shortcut></ContextMenu.Item
						>
					{/snippet}
					{#snippet empty()}
						<EmptyState title={store.state.mods.length ? "Keine Treffer" : "Noch keine Mods"}>
							{store.state.mods.length ? "Filter anpassen." : "Unter „Durchsuchen“ hinzufügen oder .zip-/.dll-Dateien hierher ziehen."}
						</EmptyState>
					{/snippet}
				</DataTable>

				<SelectionBar count={selectedMods.length} onclear={() => (selection = { ...selection, ids: new Set(), anchor: null })} hint="Entf entfernt">
					<Button size="sm" variant="ghost" onclick={() => store.setEnabledMany(selectedMods, true)}>Aktivieren</Button>
					<Button size="sm" variant="ghost" onclick={() => store.setEnabledMany(selectedMods, false)}>Deaktivieren</Button>
					<Button size="sm" variant="ghost" disabled={!selectedMods.some((id) => id in store.state.updates)} onclick={() => store.updateMods(selectedMods)}
						>Aktualisieren</Button
					>
					<Button size="sm" variant="destructive" onclick={() => store.removeMods(selectedMods)}>Entfernen</Button>
				</SelectionBar>

				{#if dragging}
					<div
						class="bg-background/80 border-primary pointer-events-none absolute inset-2 flex items-center justify-center rounded-lg border-2 border-dashed text-sm font-medium"
					>
						.zip / .dll hier ablegen
					</div>
				{/if}
			</div>
		</Resizable.Pane>
		{#if focus}
			<Resizable.Handle />
			<Resizable.Pane defaultSize={28} minSize={20} maxSize={40} order={2} id="installed-detail">
				<PackageDetail id={focus} />
			</Resizable.Pane>
		{/if}
	</Resizable.PaneGroup>
{/if}
```

Hinweis: In der Mehrfachauswahl können Abhängigkeitszeilen stehen. Die Aktionen wirken nur auf echte Mods (`selectedMods`, `mods`).

- [ ] **Step 3: Route und Aufräumen**

`src/routes/installed/+page.svelte`:

```svelte
<script lang="ts">
	import InstalledView from "$lib/components/app/InstalledView.svelte";
</script>

<InstalledView />
```

Run: `git rm src/lib/components/app/ProfileView.svelte`

- [ ] **Step 4: autofixer und Gate**

`svelte-autofixer` auf `InstalledView.svelte` anwenden. Danach `npm test && npm run check && npm run build`.

- [ ] **Step 5: Manuelle Prüfung**

Expected:

- Der Schalter in der Zeile wechselt den Aktiv-Zustand, ohne die Auswahl zu ändern.
- Mehrfachauswahl → „Deaktivieren“ wirkt auf alle gewählten Mods.
- Entf entfernt die Auswahl.
- Abhängigkeiten erscheinen gedimmt und tragen „Benötigt von …“.
- Ein Drag&Drop von `.zip` fügt einen lokalen Mod hinzu.
- Updates lassen sich per Pille oder per „Alle aktualisieren“ einspielen.

- [ ] **Step 6: Commit**

```bash
git add -A src/lib/components/app src/lib/api/store.svelte.ts src/routes/installed
git commit -m "feat(installed): table-based installed view with bulk enable, update and remove

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Config- und Log-Ansicht

**Files:**

- Create: `src/lib/components/app/ConfigView.svelte` (ersetzt `ConfigTab.svelte`)
- Rewrite: `src/lib/components/app/LogView.svelte`
- Modify: `src/routes/config/+page.svelte`, `src/routes/logs/+page.svelte`
- Delete: `src/lib/components/app/ConfigTab.svelte`

**Interfaces:**

- Consumes: Kit (`Choice`, `Switch`, `ConfirmDialog`, `Chip`, `Resizable`, `SectionLabel`, `EmptyState`).

- [ ] **Step 1: `ConfigView.svelte`**

Die Logik von `ConfigTab.svelte` bleibt (Laden, `dirty`-Map, Speichern, Filtern); geändert werden nur das Markup und die Bestätigung beim Dateiwechsel.

```svelte
<script lang="ts">
	import { Button, Choice, ConfirmDialog, EmptyState, Input, Resizable, SectionLabel, Switch } from "$lib/components/kit";
	import { api, ApiError } from "$lib/api/client";
	import { store } from "$lib/api/store.svelte";
	import type { ConfigSetting } from "$lib/api/types";
	import { cn } from "$lib/utils";

	let files = $state<string[]>([]);
	let fileFilter = $state("");
	let currentFile = $state<string | null>(null);
	let settings = $state<ConfigSetting[]>([]);
	let dirty = $state<Map<number, string>>(new Map());
	let settingFilter = $state("");
	let loading = $state(true);
	let pendingFile = $state<string | null>(null);

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

	const filteredFiles = $derived(files.filter((f) => f.toLowerCase().includes(fileFilter.toLowerCase())));

	function requestFile(f: string) {
		if (f === currentFile) return;
		if (dirty.size) pendingFile = f;
		else openFile(f);
	}

	async function openFile(f: string) {
		pendingFile = null;
		try {
			const data = await api.getConfigFile(f);
			currentFile = f;
			settings = data.settings;
			dirty = new Map();
		} catch (e) {
			store.toast(e instanceof ApiError ? e.message : "Datei konnte nicht gelesen werden.", "err");
		}
	}

	function isBool(type?: string) {
		return /^bool/i.test(type ?? "");
	}

	function enumOptions(s: ConfigSetting): string[] {
		if (!s.acceptableValues || /^From /i.test(s.acceptableValues)) return [];
		return s.acceptableValues
			.split(",")
			.map((x) => x.trim())
			.filter(Boolean);
	}

	function setValue(i: number, value: string) {
		const next = new Map(dirty);
		if (value === settings[i].value) next.delete(i);
		else next.set(i, value);
		dirty = next;
	}

	async function save() {
		if (!currentFile || !dirty.size) return;
		const changes = [...dirty].map(([i, value]) => ({ section: settings[i].section, key: settings[i].key, value }));
		try {
			await api.saveConfigFile(currentFile, changes);
			for (const [i, v] of dirty) settings[i] = { ...settings[i], value: v };
			dirty = new Map();
			store.toast(`${changes.length} Änderung(en) gespeichert.`, "ok");
		} catch (e) {
			store.toast(e instanceof ApiError ? e.message : "Speichern fehlgeschlagen.", "err");
		}
	}

	const visible = $derived.by(() => {
		const q = settingFilter.toLowerCase();
		const all = settings.map((s, i) => ({ s, i }));
		return q ? all.filter(({ s }) => `${s.section} ${s.key} ${s.description}`.toLowerCase().includes(q)) : all;
	});
</script>

<svelte:window
	onkeydown={(e) => {
		if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
			e.preventDefault();
			save();
		}
	}}
/>

<Resizable.PaneGroup direction="horizontal" autoSaveId="config" class="h-full">
	<Resizable.Pane defaultSize={22} minSize={15} maxSize={40} order={1} id="config-files">
		<div class="flex h-full flex-col">
			<div class="flex flex-col gap-2 border-b p-3">
				<Input placeholder="Dateien filtern…" bind:value={fileFilter} />
				<Button variant="outline" size="sm" onclick={() => store.openFolder("config")} disabled={!store.state.active}>Config-Ordner öffnen</Button>
			</div>
			<div class="flex-1 overflow-y-auto p-1.5">
				{#if !loading && !filteredFiles.length}
					<p class="text-muted-foreground p-2 text-[13px]">Keine .cfg-Dateien. Die meisten Mods legen ihre Config beim ersten Spielstart an.</p>
				{/if}
				{#each filteredFiles as f (f)}
					<button
						class={cn(
							"block w-full truncate rounded-[5px] px-2.5 py-[7px] text-left font-mono text-xs",
							f === currentFile ? "bg-muted text-foreground" : "text-foreground-soft hover:bg-hover",
						)}
						title={f}
						onclick={() => requestFile(f)}
					>
						{f}
					</button>
				{/each}
			</div>
		</div>
	</Resizable.Pane>
	<Resizable.Handle />
	<Resizable.Pane minSize={40} order={2} id="config-editor">
		{#if !currentFile}
			<EmptyState title="Datei wählen">Links eine .cfg-Datei auswählen.</EmptyState>
		{:else}
			<div class="flex h-full flex-col">
				<div class="flex items-center gap-2.5 border-b px-4 py-3">
					<span class="truncate font-mono text-[13px] font-medium">{currentFile}</span>
					{#if dirty.size}<span class="text-primary text-meta font-mono">{dirty.size} geändert</span>{/if}
					<div class="flex-1"></div>
					<Input data-search class="w-64" placeholder="Einstellungen filtern…" bind:value={settingFilter} />
					<Button variant="outline" size="sm" onclick={() => (dirty = new Map())} disabled={!dirty.size}>Verwerfen</Button>
					<Button size="sm" onclick={save} disabled={!dirty.size} title="Speichern (Strg+S)">Speichern</Button>
				</div>
				<div class="flex-1 overflow-y-auto px-6">
					{#each visible as { s, i }, n (i)}
						{#if n === 0 || visible[n - 1].s.section !== s.section}
							<SectionLabel class="border-b pt-5 pb-2.5">{s.section}</SectionLabel>
						{/if}
						<div class="border-line-subtle grid grid-cols-[minmax(0,1fr)_14rem] items-center gap-6 border-b py-3">
							<div class="flex min-w-0 flex-col gap-1">
								<span class="text-row flex items-center gap-2 font-semibold">
									{s.key}{#if dirty.has(i)}<span class="bg-primary size-1.5 rounded-full"></span>{/if}
								</span>
								{#if s.description}<p class="text-muted-foreground selectable text-xs leading-snug">{s.description}</p>{/if}
								<p class="text-subtle-foreground text-meta font-mono">
									{[s.type, s.defaultValue != null && `Standard: ${s.defaultValue}`, s.acceptableValues && `Erlaubt: ${s.acceptableValues}`]
										.filter(Boolean)
										.join(" · ")}
								</p>
							</div>
							<div>
								{#if isBool(s.type)}
									<Switch checked={(dirty.get(i) ?? s.value) === "true"} onCheckedChange={(v) => setValue(i, String(v))} aria-label={s.key} />
								{:else if enumOptions(s).length}
									<Choice value={dirty.get(i) ?? s.value} options={enumOptions(s)} onchange={(v) => setValue(i, v)} />
								{:else}
									<Input
										class="font-mono text-[12.5px]"
										spellcheck={false}
										value={dirty.get(i) ?? s.value}
										oninput={(e) => setValue(i, e.currentTarget.value)}
									/>
								{/if}
							</div>
						</div>
					{/each}
				</div>
			</div>
		{/if}
	</Resizable.Pane>
</Resizable.PaneGroup>

<ConfirmDialog
	bind:open={() => pendingFile !== null, (v) => !v && (pendingFile = null)}
	title="Ungespeicherte Änderungen verwerfen?"
	description={`${dirty.size} Änderung(en) in ${currentFile} gehen verloren.`}
	confirmLabel="Verwerfen"
	destructive
	onconfirm={() => pendingFile && openFile(pendingFile)}
/>
```

Hinweis: `open` des `ConfirmDialog` ist per Funktions-Binding an `pendingFile` gekoppelt. „Abbrechen“ setzt `pendingFile` zurück, „Verwerfen“ öffnet die neue Datei.

- [ ] **Step 2: `LogView.svelte` neu**

Die Logik (Tail, Level-Erkennung, Follow, `MAX_LINES`) bleibt unverändert. Ersetzt werden die Importe, `colorOf` und das Markup:

Importe:

```ts
import { onMount, tick } from "svelte";
import { listen } from "@tauri-apps/api/event";
import { Button, Chip, Input, Switch } from "$lib/components/kit";
import { api } from "$lib/api/client";
import { store } from "$lib/api/store.svelte";
import type { LogChunk } from "$lib/api/types";
```

`colorOf` ersetzen:

```ts
function colorOf(line: string): string {
	switch (levelOf(line)) {
		case "Fatal":
		case "Error":
			return "text-destructive-text";
		case "Warning":
			return "text-primary";
		case "Debug":
			return "text-subtle-foreground";
		default:
			return "text-foreground-soft";
	}
}
```

Markup ersetzen:

```svelte
<div class="flex h-full flex-col">
	<div class="flex flex-wrap items-center gap-2.5 border-b px-4 py-3">
		<Input data-search class="w-72" placeholder="Log durchsuchen…" bind:value={query} />
		<div class="flex gap-1">
			{#each LEVELS as l (l)}
				<Chip active={levels.has(l)} onclick={() => toggleLevel(l)}>{l}</Chip>
			{/each}
		</div>
		<div class="flex-1"></div>
		<label class="text-foreground-soft flex items-center gap-2 text-[12.5px]">Mitlaufen <Switch size="sm" bind:checked={follow} /></label>
		<Button size="sm" variant="outline" onclick={() => (lines = [])}>Leeren</Button>
		<Button size="sm" variant="ghost" onclick={() => store.openFolder("profile")} disabled={!store.state.active}>Ordner öffnen</Button>
	</div>
	<div bind:this={scroller} class="bg-chrome selectable min-h-0 flex-1 overflow-auto px-4 py-3 font-mono text-xs leading-5">
		{#if !lines.length}
			<p class="text-muted-foreground font-sans text-[13px]">Noch kein Log. Starte das Spiel mit diesem Profil – neue Zeilen erscheinen hier live.</p>
		{/if}
		{#each visible as line, i (i)}
			<div class="whitespace-pre-wrap {colorOf(line)}">{line}</div>
		{/each}
	</div>
</div>
```

- [ ] **Step 3: Routen**

`src/routes/config/+page.svelte`:

```svelte
<script lang="ts">
	import ConfigView from "$lib/components/app/ConfigView.svelte";
</script>

<ConfigView />
```

`src/routes/logs/+page.svelte`:

```svelte
<script lang="ts">
	import LogView from "$lib/components/app/LogView.svelte";
</script>

<LogView />
```

Run: `git rm src/lib/components/app/ConfigTab.svelte`

- [ ] **Step 4: autofixer und Gate**

`svelte-autofixer` auf `ConfigView.svelte` und `LogView.svelte` anwenden. Danach `npm test && npm run check && npm run build`.

- [ ] **Step 5: Manuelle Prüfung**

Expected:

- Config: Bool-Werte als Schalter, Enums als Auswahlliste, Abschnitte als Mono-Überschriften.
- Strg+S speichert. Ein Dateiwechsel mit Änderungen fragt per Dialog statt per Browser-`confirm`.
- Log-Text ist markierbar und kopierbar (Strg+C). Die Level-Chips filtern.

- [ ] **Step 6: Commit**

```bash
git add -A src/lib/components/app src/routes/config src/routes/logs
git commit -m "feat(ui): Werkbank config editor and log viewer

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Einstellungen nach 1a mit Autosave

**Files:**

- Modify: `src/lib/api/store.svelte.ts` (`saveSettings` mit `quiet`, `settingsError`)
- Rewrite: `src/lib/components/app/SettingsView.svelte`
- Modify: `src/routes/settings/+page.svelte`

**Interfaces:**

- Consumes: `debounce` (Task 3), `SettingRow`, `PathField`, `Stepper`, `Segmented`, `SectionLabel` und `Switch` aus dem Kit.
- Produces: `store.saveSettings(s: Settings, quiet?: boolean): Promise<boolean>` und `store.settingsError: string | null`.

- [ ] **Step 1: Store**

Feld ergänzen: `settingsError = $state<string | null>(null);`. `saveSettings` ersetzen:

```ts
	/** quiet: Autosave – kein Erfolgs-Toast, Fehler landen in settingsError statt im Toast. */
	async saveSettings(s: Settings, quiet = false): Promise<boolean> {
		try {
			this.settings = await api.saveSettings(s);
			this.settingsError = null;
			await this.loadState();
			if (!quiet) this.toast("Einstellungen gespeichert.", "ok");
			return true;
		} catch (e) {
			const msg = errorMessage(e, "Speichern fehlgeschlagen.");
			if (quiet) this.settingsError = msg;
			else this.toast(msg, "err");
			return false;
		}
	}
```

- [ ] **Step 2: `SettingsView.svelte`**

```svelte
<script lang="ts">
	import { onMount } from "svelte";
	import { getVersion } from "@tauri-apps/api/app";
	import { open as openDialog } from "@tauri-apps/plugin-dialog";
	import { Button, PathField, SectionLabel, Segmented, SettingRow, Stepper, Switch } from "$lib/components/kit";
	import { api } from "$lib/api/client";
	import { store } from "$lib/api/store.svelte";
	import type { GameInfo, Settings } from "$lib/api/types";
	import { debounce } from "$lib/desktop/debounce";
	import { formatBytes, relativeTime } from "$lib/format";
	import { cn } from "$lib/utils";

	const SECTIONS = [
		{ id: "spiel", label: "Spiel" },
		{ id: "downloads", label: "Downloads & Index" },
		{ id: "speicher", label: "Speicher" },
		{ id: "ueber", label: "Über" },
	];

	let form = $state<Settings | null>(null);
	let detected = $state<GameInfo | null>(null);
	let version = $state("");
	let saving = $state(false);
	let current = $state("spiel");
	let scroller = $state<HTMLDivElement>();

	$effect(() => {
		if (store.settings && !form) form = { ...store.settings };
	});

	onMount(() => {
		api
			.detectGame()
			.then((d) => (detected = d))
			.catch(() => {});
		getVersion()
			.then((v) => (version = v))
			.catch(() => {});
		return () => persist.flush();
	});

	const persist = debounce(async (s: Settings) => {
		saving = true;
		await store.saveSettings(s, true);
		saving = false;
	}, 600);

	// Autosave: jede Änderung am Formular speichert nach kurzer Pause; nur der letzte Stand zählt.
	$effect(() => {
		if (!form || !store.settings) return;
		const snapshot = $state.snapshot(form) as Settings;
		if (JSON.stringify(snapshot) !== JSON.stringify(store.settings)) persist(snapshot);
	});

	async function pickValheim() {
		const dir = await openDialog({ directory: true });
		if (typeof dir === "string" && form) form.valheimDir = dir;
	}

	async function pickSteam() {
		const file = await openDialog({ filters: [{ name: "steam.exe", extensions: ["exe"] }] });
		if (typeof file === "string" && form) form.steamExe = file;
	}

	async function clearCache() {
		try {
			const freed = await api.clearDownloadCache();
			store.toast(`Download-Cache geleert (${formatBytes(freed)}).`, "ok");
		} catch (e) {
			store.toast(e instanceof Error ? e.message : "Cache konnte nicht geleert werden.", "err");
		}
	}

	function jump(id: string) {
		current = id;
		document.getElementById(`settings-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
	}

	function onScroll() {
		if (!scroller) return;
		const top = scroller.getBoundingClientRect().top;
		for (const s of [...SECTIONS].reverse()) {
			const el = document.getElementById(`settings-${s.id}`);
			if (el && el.getBoundingClientRect().top - top <= 40) {
				current = s.id;
				return;
			}
		}
	}

	const gameCheck = $derived(
		store.state.game.found
			? { ok: true, text: `valheim.exe gefunden${form?.valheimDir ? "" : " · automatisch erkannt"}` }
			: { ok: false, text: "valheim.exe nicht gefunden" },
	);
</script>

{#if form}
	<div class="flex h-full">
		<nav class="flex w-[212px] shrink-0 flex-col gap-0.5 border-r px-3 py-4 text-[13px]" aria-label="Einstellungsbereiche">
			{#each SECTIONS as s (s.id)}
				<button
					class={cn("rounded-[5px] px-2.5 py-[7px] text-left", current === s.id ? "bg-muted font-medium" : "text-foreground-soft hover:text-foreground")}
					onclick={() => jump(s.id)}>{s.label}</button
				>
			{/each}
		</nav>

		<div bind:this={scroller} onscroll={onScroll} class="min-w-0 flex-1 overflow-y-auto">
			<div class="flex max-w-[860px] flex-col gap-8 px-10 py-7">
				<div class="flex items-baseline justify-between">
					<h1 class="text-[22px] font-bold">Einstellungen</h1>
					<span class={cn("font-mono text-[11.5px]", store.settingsError ? "text-destructive-text" : "text-success")}>
						{#if saving}Speichert…{:else if store.settingsError}✗ {store.settingsError}{:else}✓ automatisch gespeichert{/if}
					</span>
				</div>

				<section id="settings-spiel">
					<SectionLabel class="border-b pb-2.5">Spiel</SectionLabel>
					<SettingRow label="Valheim-Ordner" hint="Leer lassen = automatisch über Steam erkennen" for="valheim-dir">
						<PathField
							id="valheim-dir"
							bind:value={form.valheimDir}
							placeholder={detected?.valheimDir ?? "nicht gefunden"}
							onpick={pickValheim}
							onopen={() => store.openFolder("game")}
							check={gameCheck}
						/>
					</SettingRow>
					<SettingRow label="steam.exe" hint="Wird für den Start über Steam benötigt" for="steam-exe">
						<PathField
							id="steam-exe"
							bind:value={form.steamExe}
							placeholder={detected?.steamExe ?? "nicht gefunden"}
							onpick={pickSteam}
							check={form.steamExe || detected?.steamExe ? { ok: true, text: "gefunden" } : { ok: false, text: "nicht gefunden" }}
						/>
					</SettingRow>
				</section>

				<section id="settings-downloads">
					<SectionLabel class="border-b pb-2.5">Downloads &amp; Index</SectionLabel>
					<SettingRow label="Parallele Downloads" align="center">
						<div class="flex items-center gap-3.5">
							<Stepper bind:value={form.downloadConcurrency} min={1} max={16} label="Parallele Downloads" />
							<span class="text-muted-foreground text-xs">1–16 · empfohlen 4</span>
						</div>
					</SettingRow>
					<SettingRow label="Index aktualisieren" align="center">
						<Segmented
							bind:value={() => String(form!.indexTtlMinutes), (v) => (form!.indexTtlMinutes = Number(v))}
							options={[
								{ value: "15", label: "15 Min" },
								{ value: "30", label: "30 Min" },
								{ value: "60", label: "1 Std" },
								{ value: "240", label: "4 Std" },
							]}
						/>
					</SettingRow>
					<SettingRow label="NSFW-Mods anzeigen" align="center">
						<div class="flex items-center gap-2.5">
							<Switch bind:checked={form.showNsfw} aria-label="NSFW-Mods anzeigen" />
							<span class="text-muted-foreground text-xs">Standard für den Filter in Durchsuchen</span>
						</div>
					</SettingRow>
				</section>

				<section id="settings-speicher">
					<SectionLabel class="border-b pb-2.5">Speicher</SectionLabel>
					<SettingRow label="Download-Cache" hint="Heruntergeladene Pakete; wird bei Bedarf neu geladen." align="center">
						<span></span>
						{#snippet aside()}<Button size="sm" variant="outline" onclick={clearCache}>Leeren</Button>{/snippet}
					</SettingRow>
					<SettingRow label="Mod-Index" align="center">
						<span class="text-foreground-soft font-mono text-[12.5px]">
							{store.packages.length.toLocaleString("de")} Pakete{#if store.indexFetchedAt}
								· {relativeTime(store.indexFetchedAt)}{/if}
						</span>
						{#snippet aside()}<Button size="sm" variant="outline" onclick={() => store.refreshIndex()}>Jetzt aktualisieren</Button>{/snippet}
					</SettingRow>
					<SettingRow label="Datenordner" hint="Profile, Cache und Einstellungen" align="center">
						<span></span>
						{#snippet aside()}<Button size="sm" variant="ghost" onclick={() => store.openFolder("data")}>Öffnen ↗</Button>{/snippet}
					</SettingRow>
				</section>

				<section id="settings-ueber" class="pb-10">
					<SectionLabel class="border-b pb-2.5">Über</SectionLabel>
					<SettingRow label="Version" align="center">
						<span class="font-mono text-[12.5px]">Valheim Mod Manager {version}</span>
					</SettingRow>
					<SettingRow label="Tastenkürzel">
						<dl class="text-foreground-soft grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1 text-[12.5px]">
							<dt class="font-mono">Strg K / Strg F</dt>
							<dd>Suche fokussieren</dd>
							<dt class="font-mono">Strg 1–4, Strg ,</dt>
							<dd>Bereiche wechseln</dd>
							<dt class="font-mono">Strg Enter</dt>
							<dd>Spielen</dd>
							<dt class="font-mono">Strg N</dt>
							<dd>Neues Profil</dd>
							<dt class="font-mono">F5</dt>
							<dd>Mod-Index aktualisieren</dd>
							<dt class="font-mono">Strg A, Shift+Klick, Entf</dt>
							<dd>Auswahl in Listen</dd>
						</dl>
					</SettingRow>
				</section>
			</div>
		</div>
	</div>
{:else}
	<p class="text-muted-foreground p-6 text-sm">Lädt…</p>
{/if}
```

Hinweis: `indexTtlMinutes` kann einen Wert außerhalb der Optionen haben, zum Beispiel 45 aus einer alten Version. Dann ist kein Segment markiert. Das ist akzeptabel; ein Klick setzt einen gültigen Wert.

- [ ] **Step 3: Route**

`src/routes/settings/+page.svelte`:

```svelte
<script lang="ts">
	import SettingsView from "$lib/components/app/SettingsView.svelte";
</script>

<SettingsView />
```

- [ ] **Step 4: autofixer und Gate**

`svelte-autofixer` auf `SettingsView.svelte` anwenden. Danach `npm test && npm run check && npm run build`.

- [ ] **Step 5: Manuelle Prüfung**

Expected:

- Änderungen speichern ohne Button, und es erscheint „✓ automatisch gespeichert“.
- Schnelles Tippen eines Pfads erzeugt keine Toast-Flut; ein ungültiger Pfad zeigt „✗ …“ oben rechts.
- Die Navigation links springt zu den Bereichen und folgt beim Scrollen.
- Verlassen der Seite direkt nach einer Änderung speichert sie trotzdem (`flush`).

- [ ] **Step 6: Commit**

```bash
git add -A src/lib/components/app/SettingsView.svelte src/lib/api/store.svelte.ts src/routes/settings
git commit -m "feat(settings): Werkbank settings with section nav, path validation and autosave

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Aufräumen, Importregel scharf schalten, README

**Files:**

- Delete: `src/lib/components/app/SyncIndicator.svelte` und alle nicht mehr benutzten ui-Komponenten
- Modify: `src/lib/components/kit/boundaries.test.ts` (`it.skip` → `it`)
- Modify: `README.md`

- [ ] **Step 1: Nicht mehr genutzte Dateien finden**

Run: `grep -rln "SyncIndicator\|ModsTab\|ProfileView\|PackageSheet\|ConfigTab" src` und für jeden Ordner unter `src/lib/components/ui/*`: `grep -rl "components/ui/<name>" src --include=*.svelte --include=*.ts`.
Expected: `SyncIndicator` wird nirgends mehr importiert. Ungenutzt sind voraussichtlich `card`, `native-select`, `sheet`, `tabs` und `badge`.

Run: `git rm -r src/lib/components/app/SyncIndicator.svelte` sowie `git rm -r` für jeden ungenutzten ui-Ordner. Im Kit-`index.ts` die Re-Exporte entfernen, deren Ordner gelöscht wurde.

- [ ] **Step 2: Importregel scharf schalten**

In `boundaries.test.ts` `it.skip(` zurück auf `it(` ändern und den Kommentar darüber löschen.

Run: `npm test`
Expected: PASS. Schlägt der Test fehl, die gemeldeten Dateien auf Imports aus `$lib/components/kit` umstellen.

- [ ] **Step 3: Dev-Schaukasten nur im Dev-Build**

Run: `npm run build` und danach prüfen, dass `/dev/kit` in der gebauten App nichts rendert. Die Prüfung `{#if dev}` steht schon im Schaukasten, mehr ist nicht nötig.

- [ ] **Step 4: README**

In `README.md` einen Abschnitt „Oberfläche“ ergänzen:

```markdown
## Oberfläche

Die UI folgt dem Design „Werkbank“ (`docs/design/2026-10-02-mod-manager-designs.html`, Variante 1a).

- **Tokens:** `src/lib/theme.css` (Farben, Schriften, Maße), eingebunden in `src/app.css` per `@theme inline`.
  shadcn-Anpassungen zentral in `src/lib/style-desktop.css`.
- **Komponenten:** `$lib/components/kit` (eigene, von shadcn-svelte abgeleitete Bausteine) und
  `$lib/components/shell` (Titel-, Werkzeug- und Statusleiste). App-Seiten importieren nur von dort
  (geprüft durch `src/lib/components/kit/boundaries.test.ts`). Schaukasten im Dev-Modus unter `/dev/kit`.
- **Desktop:** eigene Titelleiste, Fensterzustand wird gespeichert, ziehbare Bereiche, kein Browser-Kontextmenü,
  Auswahl wie im Explorer (Klick, Strg/Shift+Klick, Strg+A, Pfeiltasten, Entf, Rechtsklick).

| Kürzel             | Aktion                                               |
| ------------------ | ---------------------------------------------------- |
| Strg+K / Strg+F    | Suche fokussieren                                    |
| Strg+1 … 4, Strg+, | Durchsuchen, Installiert, Config, Log, Einstellungen |
| Strg+Enter         | Spielen                                              |
| Strg+N             | Neues Profil                                         |
| F5                 | Mod-Index aktualisieren                              |
| Strg+S             | Config speichern                                     |

Tests: `npm test` (Vitest, reine Logik unter `src/lib/desktop`, `src/lib/browse`, `src/lib/api/status.ts`).
```

- [ ] **Step 5: Abschluss-Gate**

Run: `npm test && npm run check && npm run build && cd src-tauri && cargo clippy --all-targets -- -D warnings`
Expected: Alles grün.

- [ ] **Step 6: Abschlussprüfung in der App**

Run: `npm run tauri dev`. Die Review-Focus-Punkte 1–5 von oben einzeln durchspielen. Danach die Seiten mit dem Design 1a nebeneinander vergleichen: Durchsuchen, Einstellungen, Werkzeugleiste und Statusleiste.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore(ui): remove superseded views and primitives, enforce kit boundary, document UI

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
