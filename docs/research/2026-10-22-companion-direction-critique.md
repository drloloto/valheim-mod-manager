# Companion direction: the owner's proposal, the facts, and what 0.5 should do instead

Date: 2026-10-22. Status: decided the same day (owner's answers in section 5); the architecture is in
`docs/specs/2026-10-22-companion-0.5-identity-and-public-endpoint.md`, the phases in
`docs/plans/2026-10-22-companion-0.5-plan.md`. **0.4.x stays in its current setup and architecture; the new
architecture starts with 0.5** (owner, 2026-10-22).

## 1. The proposal

The owner's words (2026-10-22, shortened; the goal statement is kept verbatim):

> grundsätzlich ist die idee des ganzen projektes, eine unified experience für spieler und admins zu
> schaffen. viele leute struggeln mit dem technischen part, für ihre gruppe einen server aufzusetzen etc.
> und sind meistens damit überfordert und dann auch abhängig von Hostern oder Anbietern. [...] Am ende muss
> das initialisieren und starten extrem einfach funktionieren.

The concrete wishes, numbered for the critique below:

1. Control players through a Discord bot or server. Problem seen: Discord does not give the Steam ID the
   server's `permittedlist.txt` needs. Authentik as a Discord ↔ Steam link came to mind, suspected overkill.
2. A clean, secure login with username and password instead of the local token that holds full server rights.
3. The gist sync was a transitional solution (rate limit, dependency, restrictions); wanted instead: an own
   server endpoint with authorisation and an own database for releases, configs and the rest.
4. Deep links could be replaced by endpoints.
5. Rethink the feature set for the potential the new architecture opens.
6. The companion stays almost exclusively a connector between players, the Valheim server and the clients.
7. For admins the most important tools; for players a unified entry point / dashboard with server and
   community information. The ServerConnect idea ("join the server from a button") should be implemented;
   DiscordConnector is worth a look.

And: "sei meiner idee kritisch gegenüber".

## 2. Facts

Each item names its source. "Decompiled" means the current game build in the owner's Steam library and the
dedicated server next to it, read with ilspycmd on 2026-10-22 (assemblies dated 2026-10-15/16).

### 2.1 Identity: Discord already knows the Steam ID

- Discord OAuth2 scope `connections` lets `GET /users/@me/connections` return the user's linked accounts as
  Connection objects with `id`, `name`, `type` (`"steam"` among them), `verified`, `revoked`, `visibility`
  (https://docs.discord.com/developers/resources/user). The endpoint returns the authorising user's own
  connections, so the `visibility` flag should not matter; that a Steam connection's `id` is the SteamID64 is
  what every implementation relies on, but the docs do not spell it out. **Both points are to be verified in
  the first 0.5 spike.** It only works when the player has linked Steam in Discord.
- Steam OpenID 2.0: provider `https://steamcommunity.com/openid/`, claimed id
  `https://steamcommunity.com/openid/id/<steamid64>`, no API key needed for the login itself
  (https://partner.steamgames.com/doc/features/auth). This is the fallback for players without a Steam
  connection in Discord.
- Consequence: an identity provider such as Authentik adds nothing here. Discord is the identity, Steam is
  one attribute of it.

### 2.2 The server reloads its lists; it has no remote console

- The manual that ships with the dedicated server (`Valheim Dedicated Server Manual.pdf`): `adminlist.txt`,
  `bannedlist.txt`, `permittedlist.txt` in the save dir hold one platform user id per line in the form
  `[Platform]_[User ID]`; the id can be read from the server log or the F2 panel; "adding a person on the
  permitted list will ban everyone else"; `-crossplay` switches to the PlayFab backend.
- Decompiled `assembly_valheim.dll` / `assembly_utils.dll`:
  - `ZNet.ListContainsId` accepts `Steam_7656…` and the bare `7656…` for Steam users; other platforms need
    the prefix. With crossplay, a Steam player's host name is still `Steam_<SteamID64>`
    (`ZPlayFabSocket.GetHostName()` returns the platform player id), not a PlayFab id.
  - `SyncedList.CheckLoad()` re-reads a list file at most every 10 s when its mtime changed. `ZNet` runs
    `CheckWhiteList()` every 5 s: it kicks connected peers who are not on a non-empty permitted list and
    everyone on the banned list. **No restart is needed**, whatever hosting guides say.
  - Log lines (string literals): `Got connection SteamID <id>` (Steam backend);
    `PlayFab socket with remote ID <playfabId> received local Platform ID Steam_<id>` (crossplay);
    `Got character ZDOID from <CharacterName> : <zdoid>` (the only line that ties a name to a session);
    `Player <name> : <hostId> is blacklisted or not in whitelist.`; `Peer <name> has wrong password`;
    `Closing socket <id>`. Whether the id line always precedes the name line in a real log is to be checked.
  - No `Console.ReadLine`, stdin handling or RCON exists in the server assembly. Admin commands are the
    in-game F5 console (`kick`, `ban`, `unban`, `banned`). Tools therefore tail the log, edit files and send
    process signals; lloesche/valheim-server-docker does exactly that with `VALHEIM_LOG_FILTER_*` hooks and
    `ADMINLIST_IDS` / `PERMITTEDLIST_IDS` env vars (https://github.com/lloesche/valheim-server-docker).

### 2.3 ServerConnect is a button; the game already has the join

- ServerConnect (Zenox, 1.0.14 of 2026-10-07, client-side, categories "AI Generated, Client-side, Utility",
  no source repository, no licence; https://thunderstore.io/c/valheim/p/Zenox/ServerConnect/): adds a main
  menu button that joins a configured `Address` and submits `Password`, with a green/red/grey status dot
  from a Steam query on port + 1 and, since 1.0.13, a PlayFab fallback for `-crossplay` servers. Config
  `BepInEx/config/zenox.serverconnect.cfg`, password in plain text. No command line argument, no URI scheme.
- Decompiled client: `FejdStartup.HandleStartupJoin()` handles `+connect <ip:port>` (queues a Steam server
  join) and `+connect_lobby <lobbyId>`; `-password <pw>` sets `FejdStartup.ServerPassword`, which `ZNet`
  submits when the server asks; `-joincode <code>` joins a crossplay server by join code;
  `-joinserverwithcharacter <ip:port> <character>` joins with a named character. There is no `+password`.
- Consequence: the Mod Manager launches the game itself (`apps/client/src-tauri/src/game.rs`,
  `commands.rs::launch_game`) and can append these arguments. No mod is needed. For players without the Mod
  Manager, `steam://run/892970//+connect%20host:2456%20-password%20pw/` should work because Steam only
  passes launch arguments; **not tested end to end yet.**

### 2.4 DiscordConnector posts; it does not manage

- nwesterhausen/DiscordConnector 3.1.3 (2026-08-25, MIT, https://github.com/nwesterhausen/valheim-discordconnector,
  docs https://discord-connector.valheim.games.nwest.one/): server-side, **webhook only** (primary, secondary
  and extra webhooks), no bot, no inbound commands. Events: server start/loaded/save/stop, world events,
  join, leave, death, shout, map ping, player firsts, periodic leaderboards. Message variables
  `%PLAYER_NAME%`, `%PLAYER_STEAMID%`, `%PLAYER_ID%` carry the platform id. It keeps a LiteDB `records.db`
  (joins, leaves, deaths, shouts, pings) in `BepInEx/config/games.nwest.valheim.discordconnector/`. It does
  not touch the whitelist.
- Consequence: in-game events belong to this mod (or a webhook of our own later). The companion should not
  rebuild a death feed.

### 2.5 Gist: the limits that matter, and the one that does not

- Rate limits: 60 requests/hour per IP unauthenticated, 5,000 authenticated; secondary limits for content
  creation about 80/minute and 500/hour
  (https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api). A client checking
  every 5 minutes (`store.svelte.ts:419`) spends 12 reads an hour. The limit that bites is the `gist_update`
  write limit, 100/hour per user, shared between the companion's `server.json` writes and the admin's
  publishes because both use the same account (`apps/client/src-tauri/src/gistsync.rs:322`).
- Sizes: files over 1 MB come back truncated and must be re-fetched via `raw_url`; over 10 MB only via
  git clone; 300 files per gist (https://docs.github.com/en/rest/gists/gists). The companion caps configs at
  512 KB per file and 3 MB in total (`apps/companion/src/gistsync.ts:23-24`).
- Freshness: raw URLs sit behind a CDN with about 5 minutes of staleness
  (https://github.com/orgs/community/discussions/46691). No conditional write, so two writers overwrite each
  other.
- Security model: both files are AES-256-GCM sealed with a key derived from the sync code's secret
  (`apps/companion/src/synccrypto.ts`, `gistsync.rs:59-83`). The key is symmetric: **everyone who holds the
  code can decrypt everything, including configs**; the only thing that stops a player from forging
  `release.json` is GitHub's write ACL. There is no signature.
- Onboarding: the admin needs a GitHub account and a personal access token with gist scope, pasted into the
  landing page (`apps/companion/src/syncsetup.ts`). For the target group ("struggle with the technical part")
  this is the real cost of the gist, not the rate limit.

### 2.6 The companion and the client today (0.4)

Companion (`apps/companion`, Bun + Hono, 0.4.0):

- Auth is one static bearer token: `COMPANION_TOKEN` env, else the file `/config/modmanager/companion-token`,
  else generated, written in plain text **inside the game's bind mount** and **printed to the container
  log** (`src/config.ts:51-79`). No expiry, identity or revocation. It grants every write, and through the
  Docker socket that is root on the host.
- `COMPANION_PUBLIC_READ` (default on) opens every GET without a token (`src/auth.ts:29`). Two of them leak:
  - `GET /api/env` returns `valheim.env` **including the server password** (`src/server.ts:378`); the README
    says it needs the token. It does not.
  - `GET /api/sync` returns the sync code with its decryption secret to anyone who reaches the page
    (`src/server.ts:166`). By design, since the landing page button needs it.
- Online players are parsed from the last 2,000 log lines, Steam ids only, nothing persisted
  (`src/players.ts:71-101`). The "apply when idle" schedule depends on that count (`src/releases.ts:485-489`).
- State is JSON files under `/config/modmanager/` (`companion-token`, `sync.json`, `sync-state.json`,
  `manifest.json`, `installed.json`, `releases/`). No database.
- Tests: about 90 across 17 files, **none for routes or auth**, which is how the two open reads went unnoticed.
- The invite page `apps/invite/join.html` hardcodes the production scheme and is not deployed by any workflow.

Client (`apps/client`):

- One transport per linked server: sync code (gist) or URL + admin token (`commands.rs::merge_link`).
  `ServerLink` holds `url`, `name`, `token`, `syncCode`, `gistToken`, `lastAdopted` in plain text in
  `profile.json` (`models.rs:140-161`). No keyring.
- Role = "a token is stored" (`server.rs:265`, `store.svelte.ts:302`). The planned `/api/auth/check` and
  the Server tab (`docs/specs/2026-10-14-admin-ui-in-client-and-monorepo-design.md`) are not built.
- Deep link `valheim-mod-manager://import?code=…|url=…&link=…&name=…` (`src/lib/deeplink.ts`); a code
  always creates a new profile and adopts without asking (`store.svelte.ts:420-435`).

### 2.7 Prior art

- lloesche/valheim-server-docker: log-filter hooks, Discord webhook examples, list env vars, supervisor UI
  behind basic auth, optional `status.json`.
- Pelican / Pterodactyl: panel accounts; Discord login for Pterodactyl is a paid third-party add-on.
- AWLGaming/DiscordBot_AWL (Thunderstore): two-way bot mod with chat relay and `kick`; no whitelist handling.
- playnet-public/mc-bot: a Discord whitelist flow with an approver role, for Minecraft; Valheim support is
  restart and player count only.
- No self-hosted tool was found that manages Valheim's `permittedlist.txt` through Discord identity. The
  pieces exist (OAuth connections, hot-reloading lists); nobody has put them together.

## 3. Critique, wish by wish

**(1) Discord control and the Steam ID.** The premise is wrong in a useful way: Discord has the Steam ID
(2.1). Authentik or any identity provider is overkill, as suspected. What is also not needed, at least not for
the whitelist, is a bot: a web login with Discord gives the companion the Discord id, the guild roles and the
Steam id in one round trip, and the server picks the whitelist change up within 10 s (2.2). A bot is only
worth building for slash commands (`/status`, `/online`) and that can wait.

**(2) Username and password.** This fixes the wrong property of the token. What is insecure today is its
storage (a plain file in the game mount, printed to the log), its scope (one token, every right, root through
the socket) and its lifetime (forever). Its _form_ is not the problem; a 256-bit device token is stronger than
any password a player will choose. Passwords bring their own machinery: hashing, reset (no SMTP on a home
server), brute-force protection, account creation, and a second identity next to Discord. For players they
are strictly worse than "sign in with Discord", which also delivers the Steam id (1). For admins the one case
passwords cover, Discord being down or unwanted, is covered by the pairing code already planned in the
2026-10-15 spec. Decision: no passwords.

**(3) Own endpoint and database instead of the gist.** Agreed, but for different reasons (2.5): the gist's
problems are onboarding (GitHub account and token for a non-technical admin), the symmetric key, truncation
and CDN staleness, not the read rate limit. The real decision hiding here is **reachability**: an own
endpoint, a Discord OAuth redirect and a player page all need the companion to be reachable from the
internet over HTTPS, which is exactly what the gist avoided. The trade is "GitHub account + PAT" against
"hostname + certificate + TCP 443". For an admin who already forwards the game's UDP ports that is a fair
trade, but it is a cost and the install wizard has to carry it. On the database: yes, and narrow.
`bun:sqlite` is built into the runtime (no native dependency, unlike the client's Rust case where SQLite was
rejected on 2026-10-22). It should hold users, device tokens, player sessions, release metadata and the audit
log. The lock, the configs, `installed.json` and releases stay files, because the game and the installer read
them as files; the database holds metadata and hashes, not the configs.

**(4) Deep links replaced by endpoints.** Only their payload can be. The hop from a browser page to the
installed app is a custom-scheme link and nothing else does that. What goes away is the secret in the link:
today the invite carries the sync code, a permanent read capability that leaks with every screenshot. With
Discord as the gate, the invite is a plain `https://<host>/` and the deep link carries only that URL.

**(5) Rethinking features.** What the new architecture makes possible, in order of value: whitelist by
Discord role (join the Discord, click "sign in", you are permitted); Play joins the server with one click
(2.3); a player page that shows who is online, what runs on the server and how to get the mods; audit of who
changed what (identity exists now); player history (sessions in the database); role-driven admin without
token hand-outs. What it does _not_ make worthwhile: a second admin UI in the companion, a mod browser on the
server, a death feed (DiscordConnector, 2.4).

**(6) Companion as a connector.** Agreed, and consistent with the 2026-10-15 decision that the companion
shrinks to an agent and the admin UI moves into the Mod Manager. The tension is with (7).

**(7) Admin tools and a player dashboard.** Admin tools in the Mod Manager stays the decision. The
companion's web page becomes the **player entry point**: sign in, see the server, join, get the mods. It
must not grow back into the admin SPA that the 2026-10-15 spec shrinks. ServerConnect: implement the idea
without the mod, through launch arguments on Play and a `steam://` link on the page (2.3). DiscordConnector:
recommend it for in-game events, do not rebuild it.

## 4. Options considered

| question     | options                                                                                                                                                                                                                         | cost                                                                                                                                                                                   | decision                         |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| reachability | (A) the companion itself over HTTPS: Caddy sidecar with automatic certificates, a hostname from the admin, TCP 443 forwarded; (B) a provider tunnel (Cloudflare Tunnel, Tailscale Funnel); (C) a relay service run by the owner | A: hostname + port for the admin, no third party, LAN-only stays possible. B: no open port, but another account and provider. C: the owner becomes the hoster (uptime, cost, accounts) | **A**                            |
| login        | (A) Discord OAuth for everyone + pairing code as break-glass; (B) Discord + a local admin password; (C) username/password accounts                                                                                              | A: least code, identity delivers the Steam id, no reset flow. B: reset problem for one account. C: full account machinery, Steam id still separate                                     | **A**                            |
| gist         | keep as an optional transport next to HTTP, or remove                                                                                                                                                                           | two transports mean two security models and double tests                                                                                                                               | **remove in 0.5**                |
| versions     | migrate 0.4 step by step, or freeze 0.4 and start fresh in 0.5                                                                                                                                                                  | step by step means a mixed model for months                                                                                                                                            | **0.4.x frozen, 0.5 is the cut** |

## 5. Defects found in 0.4 (known, not fixed there)

By the owner's decision 0.4.x keeps its setup and architecture. These stay as they are and are closed by the
0.5 architecture:

- `GET /api/env` is readable without a token on the LAN and contains the server password (2.6).
- `GET /api/sync` hands the decryption secret to anyone on the LAN (by design of the gist model).
- The admin token lives in the game mount and in the container log; the client keeps tokens in plain text.
- No route or auth tests in the companion.
- Online-player parsing is Steam only and keeps no history.
- The invite page is not deployed and hardcodes the production scheme.

## 6. To verify in the first 0.5 spike

- `steam://run/892970//+connect%20host:2456%20-password%20pw/` opens the game and joins (2.3).
- Discord `GET /users/@me/connections` with scope `connections` returns the Steam connection with the
  SteamID64 as `id`, regardless of the connection's `visibility` (2.1).
- In a real server log the `Got connection SteamID` / `PlayFab … Platform ID` line precedes the
  `Got character ZDOID from` line of the same session, so the companion can pair id and name (2.2).
- `-joincode` behaviour for a crossplay server launched by the Mod Manager (2.3).
