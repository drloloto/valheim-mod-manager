<#
.SYNOPSIS
Gist-sync spike: prepares a throwaway data dir for the DEV app and starts it.

The DEV app (npm run build:dev-app, identifier ...valheim-mod-manager.dev) keeps its data in
%APPDATA%\io.github.drloloto.valheim-mod-manager.dev. Nothing here writes to the installed app's folder;
the source profile and the index cache are only copied from it.

The test profile is linked to the test companion's gist: sync code from ..\spike-sync\fixtures\sync-code-github.txt,
gist token from ..\test\compose.companion.yaml. Both are throwaway test credentials.

.PARAMETER Build   Build the dev app first (npm run build:dev-app; a few minutes).
.PARAMETER Reset   Wipe the dev data dir before seeding.
.PARAMETER Cdp     Open WebView2 remote debugging on port 9229 so dev/spike-drive.mjs can steer the app.
.PARAMETER Source  Profile of the installed app whose mods and configs are copied (default PetersWelte).
.PARAMETER Profile Name of the test profile in the dev app (default Spike-PetersWelte).

.EXAMPLE
pwsh dev/spike-gist.ps1 -Build -Reset
pwsh dev/spike-gist.ps1 -Cdp; node dev/spike-drive.mjs none out
#>
param([switch]$Build, [switch]$Reset, [switch]$Cdp, [string]$Source = "PetersWelte", [string]$Profile = "Spike-PetersWelte")
$ErrorActionPreference = "Stop"

$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$ws = (Resolve-Path (Join-Path $root "..")).Path
$code = (Get-Content (Join-Path $ws "spike-sync\fixtures\sync-code-github.txt") -Raw).Trim()
if ($code -notmatch '^vmm1\.[0-9a-f]{20,40}\.[A-Za-z0-9_-]{43}$') { throw "spike-sync/fixtures/sync-code-github.txt holds no sync code" }
$compose = Get-Content (Join-Path $ws "test\compose.companion.yaml") -Raw
if ($compose -notmatch 'COMPANION_GIST_TOKEN=([^"\s]+)') { throw "no COMPANION_GIST_TOKEN in test/compose.companion.yaml" }
$token = $Matches[1]
if ($compose -notmatch 'COMPANION_SYNC_CODE=vmm1\.([0-9a-f]+)\.' -or $Matches[1] -ne $code.Split('.')[1]) {
	throw "the companion in test/compose.companion.yaml polls another gist than the fixture sync code"
}

$prod = Join-Path $env:APPDATA "io.github.drloloto.valheim-mod-manager"
$dev = Join-Path $env:APPDATA "io.github.drloloto.valheim-mod-manager.dev"
$exe = Join-Path $root "src-tauri\target\debug\valheim-mod-manager.exe"

if ($Build) {
	Push-Location $root
	try {
		npm run build:dev-app
		if ($LASTEXITCODE) { throw "npm run build:dev-app failed" }
	} finally { Pop-Location }
}
if (-not (Test-Path $exe)) { throw "no dev app at $exe; run with -Build" }

# A running dev instance would just get focused (single instance); stop it by PID so the seeded data is read fresh.
Get-Process -Name "valheim-mod-manager" -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $exe } | ForEach-Object {
	Write-Host "stopping running dev app (PID $($_.Id))"
	Stop-Process -Id $_.Id -Force
}
Start-Sleep -Milliseconds 500

if ($Reset -and (Test-Path $dev)) { Remove-Item -Recurse -Force $dev }
New-Item -ItemType Directory -Force (Join-Path $dev "profiles") | Out-Null
New-Item -ItemType Directory -Force (Join-Path $dev "cache") | Out-Null

# Read-only copies from the installed app: settings (game dir), index cache (saves a fetch), the source profile.
foreach ($f in @("settings.json", "cache\index.json")) {
	$src = Join-Path $prod $f
	$dst = Join-Path $dev $f
	if ((Test-Path $src) -and -not (Test-Path $dst)) { Copy-Item $src $dst }
}
$dst = Join-Path $dev "profiles\$Profile"
if (-not (Test-Path $dst)) {
	$src = Join-Path $prod "profiles\$Source"
	if (Test-Path $src) {
		Write-Host "copying profile $Source -> $Profile"
		Copy-Item -Recurse $src $dst
		Remove-Item -Recurse -Force (Join-Path $dst ".snapshots") -ErrorAction SilentlyContinue
	} else {
		New-Item -ItemType Directory -Force $dst | Out-Null
		'{"name":"","mods":[]}' | Set-Content (Join-Path $dst "profile.json") -Encoding utf8
	}
}

$pf = Join-Path $dst "profile.json"
$p = Get-Content $pf -Raw | ConvertFrom-Json
$p.name = $Profile
$link = [ordered]@{ url = ""; name = "PetersWelte"; syncCode = $code; gistToken = $token }
if ($p.PSObject.Properties["server"]) { $p.server = $link } else { $p | Add-Member -NotePropertyName server -NotePropertyValue $link }
$p | ConvertTo-Json -Depth 10 | Set-Content $pf -Encoding utf8
Set-Content (Join-Path $dev "active.txt") $Profile -NoNewline -Encoding ascii

if ($Cdp) { $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=9229" }
Write-Host "dev data dir : $dev"
Write-Host "profile      : $Profile, $(@($p.mods).Count) mods, linked to gist $($code.Split('.')[1]) with the test token"
Write-Host "starting     : $exe$(if ($Cdp) { ' (CDP on 127.0.0.1:9229)' })"
Start-Process $exe
