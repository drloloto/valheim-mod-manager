<#
.SYNOPSIS
Copies the installed app's data (every profile, settings, the index cache) into the DEV app's data dir, so a
dev session starts on the owner's real profiles without ever touching them.

The installed app's folder (%APPDATA%\io.github.drloloto.valheim-mod-manager) is only read. Server links are
stripped from the copies: a copied profile must never publish to, or adopt from, the real server; link it to
the test companion in the app (dev/dev-app.ps1 does that for one profile). `bun run mock` runs this before
`tauri dev`; `bun run mock:seed` runs it with -Reset.

.PARAMETER Reset   Wipe the DEV data dir first; otherwise profiles the DEV app already has are kept.
#>
param([switch]$Reset)
$ErrorActionPreference = "Stop"
$prod = Join-Path $env:APPDATA "io.github.drloloto.valheim-mod-manager"
$dev = Join-Path $env:APPDATA "io.github.drloloto.valheim-mod-manager.dev"
if (-not (Test-Path (Join-Path $prod "profiles"))) { Write-Host "no installed app data at $prod; nothing to seed"; exit 0 }
if ($Reset -and (Test-Path $dev)) { Remove-Item -Recurse -Force $dev }
New-Item -ItemType Directory -Force (Join-Path $dev "profiles") | Out-Null
New-Item -ItemType Directory -Force (Join-Path $dev "cache") | Out-Null

foreach ($f in @("settings.json", "cache\index.json", "active.txt")) {
	$src = Join-Path $prod $f
	$dst = Join-Path $dev $f
	if ((Test-Path $src) -and -not (Test-Path $dst)) { Copy-Item $src $dst }
}

$copied = @(); $kept = @()
foreach ($dir in Get-ChildItem (Join-Path $prod "profiles") -Directory) {
	$dst = Join-Path $dev "profiles\$($dir.Name)"
	# a profile the DEV app already has stays as it is, unless a `.seeding` marker says an earlier copy broke off
	$marker = Join-Path $dst ".seeding"
	if ((Test-Path $dst) -and -not (Test-Path $marker)) { $kept += $dir.Name; continue }
	New-Item -ItemType Directory -Force $dst | Out-Null
	Set-Content $marker "" -NoNewline
	# robocopy: the installed app may be running and holds BepInEx\cache files open; snapshots and that cache are not copied
	robocopy $dir.FullName $dst /E /XD .snapshots cache /NFL /NDL /NJH /NJS /NP /R:0 /W:0 | Out-Null
	if ($LASTEXITCODE -ge 8) { throw "copying $($dir.Name) failed (robocopy $LASTEXITCODE)" }
	$pf = Join-Path $dst "profile.json"
	$p = Get-Content $pf -Raw | ConvertFrom-Json
	$linked = $null -ne $p.server
	if ($linked) { $p.PSObject.Properties.Remove("server") }
	$p | ConvertTo-Json -Depth 20 | Set-Content $pf -Encoding utf8
	Remove-Item $marker
	$copied += "{0} ({1} mods{2})" -f $dir.Name, @($p.mods).Count, $(if ($linked) { ", server link removed" } else { "" })
}
Write-Host "DEV data dir : $dev"
if ($copied.Count) { Write-Host "copied       : $($copied -join '; ')" }
if ($kept.Count) { Write-Host "kept         : $($kept -join ', ') (already in the DEV app; -Reset replaces them)" }
