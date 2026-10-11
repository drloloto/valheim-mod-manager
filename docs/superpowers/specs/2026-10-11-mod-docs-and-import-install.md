# Mod docs in the detail panel, and the install question on import

Date: 2026-10-11. Two owner requests from the first day of real use.

## 1. README, changelog and wiki without leaving the app

**Problem.** Modpacks document themselves on Thunderstore: a README with images, often a wiki. The detail
panel only offers "Thunderstore ↗", which opens the system browser every time. Reading about a modpack
means switching windows for every candidate.

**Decision.** The detail panel gets a segmented switch `Details · Readme · Changelog · Wiki`. The text
tabs render Thunderstore's markdown inside the panel; an expand button opens the same content in a wide
dialog for image-heavy modpack pages. "Thunderstore ↗" stays as a small link.

**Source.** Thunderstore's experimental API, all public, no token:

| What       | URL                                                          | Shape                                              |
| ---------- | ------------------------------------------------------------ | -------------------------------------------------- |
| Readme     | `/api/experimental/package/{ns}/{name}/{version}/readme/`    | `{ "markdown": "…" }`                              |
| Changelog  | `/api/experimental/package/{ns}/{name}/{version}/changelog/` | `{ "markdown": "…" \| null }`                      |
| Wiki index | `/api/experimental/package/{ns}/{name}/wiki/`                | `{ title, pages: [{ id, title }] }`, 404 when none |
| Wiki page  | `/api/experimental/wiki/page/{id}/`                          | `{ title, markdown_content }`                      |

**Core.** `thunderstore::fetch_doc(kind, ns, name, version)` and `fetch_wiki` / `fetch_wiki_page`. Readme
and changelog are immutable per version and cached on disk under `cache/docs/<id>-<version>-<kind>.md`;
the wiki is fetched per request (small, editable on Thunderstore). Commands: `get_package_doc(id, version,
kind)`, `get_package_wiki(id)`, `get_wiki_page(page_id)`.

**UI.** `marked` renders the markdown, `DOMPurify` sanitizes the HTML before `{@html}` (no scripts,
no event handlers, images and links only over http(s)). Links are intercepted and opened through
`openExternal`, so nothing navigates the WebView. A compact `.md` stylesheet in `app.css` covers
headings, lists, tables, code and images; no typography plugin. Content is requested lazily when a tab is
opened and cached in the store per `id + version + kind`.

**Not in scope.** Editing the wiki, offline wiki, rendering relative image paths (they only work on
GitHub anyway; broken images are hidden).

## 2. "Install everything now?" on import

**Problem.** Importing a profile (code, `.r2z`, server, r2modman migration) silently enqueues a sync.
New users do not know that mods are being downloaded, and mods that were disabled in the export stay
disabled. The owner wants the question asked at import time.

**Decision.** Every import dialog gets a second checkbox, on by default: _"Download, install and enable
all mods and dependencies now"_.

- On: every imported mod is marked enabled, then the usual sync installs the closure (dependencies
  always come along, as before).
- Off: the profile is created exactly as exported, nothing is downloaded. The readiness banner on the
  Installed page ("n mods not installed · Install now") is the path to finish later.

The core takes `install_all: bool` on the four import commands. Deep links and "Add server" default to
on. Nothing else changes: imports still create a new profile with a unique name, never overwrite one.
