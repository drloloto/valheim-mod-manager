<#
.SYNOPSIS
Seeds the test stack with a snapshot of a real server, so the companion built from apps/companion starts on
that server's state: the lock, installed.json, the BepInEx folder, worlds, companion backups and valheim.env.

A snapshot is a tar.gz of a compose folder streamed from the server read-only (test/snapshots/, git-ignored),
without the game binaries (data/), the compose .env and the companion's secrets (sync.json, companion-token).
Those stay the test stack's own, so the companion keeps talking to the test gist with the test token.
test/data (the game's own install) is kept; the previous config/ is moved to config.prev (one kept).

.PARAMETER Snapshot   The tar.gz (default: $env:SNAPSHOT, else the newest in test/snapshots).

.EXAMPLE
pwsh test/seed.ps1; pwsh test/up.ps1 -SetupSync; pwsh test/verify-migration.ps1   (= vp run test:migration)
#>
param([string]$Snapshot = $env:SNAPSHOT)
$ErrorActionPreference = "Stop"
$test = $PSScriptRoot
$snapshots = Join-Path $test "snapshots"
if (-not $Snapshot) {
	$Snapshot = Get-ChildItem $snapshots -Filter "*.tar.gz" -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1 -ExpandProperty FullName
}
if (-not $Snapshot -or -not (Test-Path $Snapshot)) { throw "no snapshot: pass -Snapshot <tar.gz> or put one into test/snapshots/" }
$name = [IO.Path]::GetFileName($Snapshot) -replace "\.tar\.gz$", ""

# extracted once next to the archive, reused by later seeds
$stage = Join-Path $snapshots $name
if (-not (Test-Path (Join-Path $stage "config\modmanager\manifest.json"))) {
	Write-Host "extracting $name"
	if (Test-Path $stage) { Remove-Item -Recurse -Force $stage }
	New-Item -ItemType Directory -Force $stage | Out-Null
	# Windows' own bsdtar: a Git for Windows tar on PATH would read "C:" as a host name
	& (Join-Path $env:SystemRoot "System32\tar.exe") -xzf $Snapshot -C $stage
	if ($LASTEXITCODE) { throw "tar failed" }
}
foreach ($f in @("config\modmanager\sync.json", "config\modmanager\companion-token", ".env")) {
	if (Test-Path (Join-Path $stage $f)) { throw "the snapshot carries $f; a snapshot must not contain the server's secrets" }
}

Push-Location $test
try {
	Write-Host "stopping the test stack"
	docker compose stop companion valheim 2>&1 | Where-Object { $_ -match "Stopped|Container" } | ForEach-Object { Write-Host " $_" }
	if ($LASTEXITCODE) { throw "docker compose stop failed (is Docker running?)" }
} finally { Pop-Location }

# the test stack's own identity survives the seed
$mm = Join-Path $test "config\modmanager"
$keep = @{}
foreach ($f in @("sync.json", "sync-state.json", "companion-token")) {
	$p = Join-Path $mm $f
	if (Test-Path $p) { $keep[$f] = [IO.File]::ReadAllBytes($p) }
}

$config = Join-Path $test "config"
$prev = Join-Path $test "config.prev"
if (Test-Path $prev) { Remove-Item -Recurse -Force $prev }
if (Test-Path $config) { Rename-Item $config $prev }
Copy-Item -Recurse (Join-Path $stage "config") $config
$backups = Join-Path $test "backups"
New-Item -ItemType Directory -Force $backups | Out-Null
Get-ChildItem $backups -File | Remove-Item -Force
if (Test-Path (Join-Path $stage "backups")) { Copy-Item (Join-Path $stage "backups\*") $backups }
Copy-Item (Join-Path $stage "valheim.env") (Join-Path $test "valheim.env")
New-Item -ItemType Directory -Force $mm | Out-Null
foreach ($f in $keep.Keys) { [IO.File]::WriteAllBytes((Join-Path $mm $f), $keep[$f]) }

# the reference for verify-migration.ps1: the lock and installed.json as the server had them
Copy-Item (Join-Path $stage "config\modmanager\manifest.json") (Join-Path $snapshots "$name.lock.json")
Copy-Item (Join-Path $stage "config\modmanager\installed.json") (Join-Path $snapshots "$name.installed.json") -ErrorAction SilentlyContinue

# the game on the snapshot's BepInEx folder; the companion (test/up.ps1) reads its state through docker
Push-Location $test
try {
	docker compose up -d --no-build valheim 2>&1 | Where-Object { $_ -match "Started|Running|Created|Recreate" } | ForEach-Object { Write-Host " $_" }
	if ($LASTEXITCODE) { throw "docker compose up valheim failed" }
} finally { Pop-Location }

$lock = Get-Content (Join-Path $snapshots "$name.lock.json") -Raw | ConvertFrom-Json
$plugins = @(Get-ChildItem (Join-Path $config "bepinex\plugins") -ErrorAction SilentlyContinue)
Write-Host ("seeded {0}: lock {1} mods (server {2}), {3} entries in plugins/, {4} backups, previous config in config.prev" -f $name, @($lock.mods).Count, $lock.server.name, $plugins.Count, @(Get-ChildItem $backups -File).Count)
