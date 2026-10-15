<#
.SYNOPSIS
Builds the companion image from apps/companion and (re)starts the test companion. The only way the test stack
should ever be brought up: no copies, no hand-edited env files.

.PARAMETER SetupSync   Turn the gist sync on through the companion's own API (POST /api/sync) with the throwaway
                       GitHub token from test/.env. No-op when the sync is already on.
.PARAMETER Reset       Forget the companion's sync setup and poller state first (sync.json, sync-state.json), so
                       -SetupSync creates a fresh gist.
.PARAMETER NoBuild     Start the container with the image that exists.

The sync code and the gist token are never printed; the code is read from GET /api/sync by whoever needs it
(the landing page, dev/dev-app.ps1, test/e2e.ps1).

.EXAMPLE
pwsh test/up.ps1 -SetupSync
#>
param([switch]$SetupSync, [switch]$Reset, [switch]$NoBuild)
$ErrorActionPreference = "Stop"
$test = $PSScriptRoot
$repo = (Resolve-Path (Join-Path $test "..")).Path
$base = "http://127.0.0.1:9002"

if (-not $NoBuild) {
	Write-Host "building valheim-companion:local from $repo\apps\companion"
	docker build -q -t valheim-companion:local (Join-Path $repo "apps\companion") | Out-Null
	if ($LASTEXITCODE) { throw "docker build failed" }
}
if ($Reset) {
	foreach ($f in @("sync.json", "sync-state.json")) {
		$p = Join-Path $test "config\modmanager\$f"
		if (Test-Path $p) { Remove-Item $p; Write-Host "removed config/modmanager/$f" }
	}
}
Push-Location $test
try {
	docker compose up -d --no-deps --no-build companion 2>&1 | Where-Object { $_ -match "Started|Running|Created|Recreate" } | ForEach-Object { Write-Host " $_" }
} finally { Pop-Location }

$ok = $false
for ($i = 0; $i -lt 40 -and -not $ok; $i++) {
	try { $ok = (Invoke-RestMethod "$base/api/health").ok } catch { Start-Sleep -Milliseconds 500 }
}
if (-not $ok) { throw "companion did not answer on $base" }

$status = Invoke-RestMethod "$base/api/status"
if ($SetupSync -and -not $status.sync.enabled) {
	$vars = @{}
	Get-Content (Join-Path $test ".env") | ForEach-Object { if ($_ -match '^\s*([A-Z_]+)=(.*)$') { $vars[$Matches[1]] = $Matches[2].Trim() } }
	$gistToken = $vars["COMPANION_GIST_TOKEN"]
	if (-not $gistToken) { throw "test/.env: COMPANION_GIST_TOKEN is missing (a throwaway GitHub token with the gist scope)" }
	$admin = (Get-Content (Join-Path $test "config\modmanager\companion-token") -Raw).Trim()
	$body = @{ token = $gistToken } | ConvertTo-Json -Compress
	Invoke-RestMethod "$base/api/sync" -Method Post -ContentType "application/json" -Headers @{ Authorization = "Bearer $admin" } -Body $body | Out-Null
	$gistToken = $null
	$admin = $null
	$status = Invoke-RestMethod "$base/api/status"
}
$sync = Invoke-RestMethod "$base/api/sync"
Write-Host ("companion {0} at {1}  scheme {2}  lock {3} mods  game {4}" -f $status.companion.version, $base, $status.companion.scheme, $status.manifest.mods, $(if ($status.container) { $status.container.state } else { "?" }))
if ($sync.enabled) { Write-Host ("sync on: gist {0}, source {1}, writes {2}{3}" -f $sync.gistId, $sync.source, $sync.canWrite, $(if ($sync.lastError) { ", last error: " + $sync.lastError } else { "" })) }
else { Write-Host "sync off (run with -SetupSync)" }
