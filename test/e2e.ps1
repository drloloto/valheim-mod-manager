<#
.SYNOPSIS
The player's path, end to end, against the test stack only: companion page → "Open in Mod Manager" → DEV app
links the profile by the sync code and adopts the server's mods and configs. Nothing touches the installed
app's data or the production server.

Steps: test/up.ps1 (image from apps/companion, sync on through the API) → the landing page in headless Edge
(test/e2e/page.mjs, signs in and uses the page's own setup form when the sync is still off) → the DEV app
with a fresh data dir (dev/dev-app.ps1 -Reset -Cdp -NoSeed) → the button's link opened through the OS, as
Chrome does after "Open app" → the new profile is checked on disk and in the app (test/e2e/app.mjs).

.PARAMETER Build      Rebuild the DEV app (npm run build:dev-app) before the run.
.PARAMETER NoBuild    Skip the companion image build.
.PARAMETER Out        Screenshot folder (default test/e2e/out).
#>
param([switch]$Build, [switch]$NoBuild, [string]$Out = (Join-Path $PSScriptRoot "e2e\out"))
$ErrorActionPreference = "Stop"
$test = $PSScriptRoot
$repo = (Resolve-Path (Join-Path $test "..")).Path
$client = Join-Path $repo "apps\client"
$base = "http://127.0.0.1:9002"
New-Item -ItemType Directory -Force $Out | Out-Null
$failed = @()
function Check([bool]$ok, [string]$what) { if ($ok) { Write-Host "  ok   $what" } else { Write-Host "  FAIL $what"; $script:failed += $what } }

Write-Host "== 1. companion"
& (Join-Path $test "up.ps1") -SetupSync -NoBuild:$NoBuild
$status = Invoke-RestMethod "$base/api/status"
$sync = Invoke-RestMethod "$base/api/sync"
Check ($status.companion.scheme -eq "valheim-mod-manager-dev") "button scheme is the DEV app's (COMPANION_DEEPLINK_SCHEME)"
Check ($sync.enabled -and $sync.canWrite) "sync is on with a token"
Check ($status.manifest.mods -gt 0) "lock has mods ($($status.manifest.mods))"

Write-Host "== 2. landing page (headless Edge)"
$vars = @{}
Get-Content (Join-Path $test ".env") | ForEach-Object { if ($_ -match '^\s*([A-Z_]+)=(.*)$') { $vars[$Matches[1]] = $Matches[2].Trim() } }
$env:COMPANION_URL = $base
$env:OUT_DIR = $Out
$env:ADMIN_TOKEN = (Get-Content (Join-Path $test "config\modmanager\companion-token") -Raw).Trim()
$env:GIST_TOKEN = $vars["COMPANION_GIST_TOKEN"]
try { $pageJson = node (Join-Path $test "e2e\page.mjs") } finally { $env:ADMIN_TOKEN = ""; $env:GIST_TOKEN = "" }
$page = $pageJson | ConvertFrom-Json
Check ($page.enabled) "page shows the sync code"
Check ($page.gistId -eq $sync.gistId) "button's link carries the companion's gist ($($sync.gistId))"
Check ($page.href -like "valheim-mod-manager-dev://import?code=vmm1.*") "button's link is a DEV deep link with a code"

Write-Host "== 3. DEV app"
& (Join-Path $client "dev\dev-app.ps1") -Reset -Cdp -NoSeed -Build:$Build
Start-Sleep 6
node (Join-Path $test "e2e\app.mjs") (Join-Path $Out "app-0-fresh.png") | Select-Object -First 3 | ForEach-Object { "  $_" }

Write-Host "== 4. the button's link through the OS"
Start-Process $page.href
# Adoption downloads the lock's mods and, after an app update, merges Hexium into the index first: poll instead of a fixed wait.
$dev = Join-Path $env:APPDATA "io.github.drloloto.valheim-mod-manager.dev"
foreach ($i in 1..24) { if ((Get-ChildItem (Join-Path $dev "profiles") -Directory -ErrorAction SilentlyContinue | Where-Object { Test-Path (Join-Path $_.FullName "profile.json") }).Count -ge 1) { break }; Start-Sleep 5 }
Start-Sleep 10
$text = (node (Join-Path $test "e2e\app.mjs") (Join-Path $Out "app-1-linked.png")) -join "`n"
$profiles = Get-ChildItem (Join-Path $dev "profiles") -Directory -ErrorAction SilentlyContinue
Check ($profiles.Count -eq 1) "exactly one profile was created ($($profiles.Name -join ', '))"
if ($profiles.Count -ge 1) {
	$p = Get-Content (Join-Path $profiles[0].FullName "profile.json") -Raw | ConvertFrom-Json
	$linkedGist = if ($p.server.syncCode) { $p.server.syncCode.Split('.')[1] } else { "" }
	Check ($linkedGist -eq $sync.gistId) "profile is linked to the companion's gist"
	Check ((@($p.mods).Count) -eq $status.manifest.mods) "profile has the lock's mods ($(@($p.mods).Count))"
	Check ((Get-ChildItem (Join-Path $profiles[0].FullName "BepInEx\config") -Recurse -File -ErrorAction SilentlyContinue | Measure-Object).Count -gt 0) "configs were adopted"
	Check ($text -match "in sync") "app shows the profile in sync"
}

Write-Host ""
if ($failed.Count) { Write-Host "FAILED: $($failed.Count) check(s)"; exit 1 }
Write-Host "PASS: the player's path works end to end; screenshots in $Out"
