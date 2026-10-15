<#
.SYNOPSIS
Starts the DEV app with its own data dir, optionally seeded with a profile linked to the test companion.

The DEV app (npm run build:dev-app, identifier ...valheim-mod-manager.dev, scheme valheim-mod-manager-dev)
keeps its data in %APPDATA%\io.github.drloloto.valheim-mod-manager.dev. Nothing here writes to the installed
app's folder; settings, the index cache and the source profile are only copied from it.

The sync code comes from the companion itself (GET /api/sync), never from a file; the admin's gist token for
publish tests is the throwaway COMPANION_GIST_TOKEN in ..\test\.env.

.PARAMETER Build      Build the dev app first (npm run build:dev-app; a few minutes).
.PARAMETER Reset      Wipe the dev data dir before seeding.
.PARAMETER Cdp        Open WebView2 remote debugging on port 9229 so dev/drive.mjs and test/e2e/app.mjs can steer the app.
.PARAMETER NoSeed     No profile: the app starts empty (the end-to-end test lets the companion's button create one).
.PARAMETER Companion  The test companion (default http://127.0.0.1:9002).
.PARAMETER Source     Profile of the installed app whose mods and configs are copied (default PetersWelte).
.PARAMETER Profile    Name of the seeded profile in the dev app (default Dev-PetersWelte).

.EXAMPLE
pwsh dev/dev-app.ps1 -Build -Reset
pwsh dev/dev-app.ps1 -Cdp; node dev/drive.mjs none out
#>
param([switch]$Build, [switch]$Reset, [switch]$Cdp, [switch]$NoSeed, [string]$Companion = "http://127.0.0.1:9002", [string]$Source = "PetersWelte", [string]$Profile = "Dev-PetersWelte")
$ErrorActionPreference = "Stop"

$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$ws = (Resolve-Path (Join-Path $root "..")).Path
$prod = Join-Path $env:APPDATA "io.github.drloloto.valheim-mod-manager"
$dev = Join-Path $env:APPDATA "io.github.drloloto.valheim-mod-manager.dev"
$exe = Join-Path $root "src-tauri\target\debug\valheim-mod-manager.exe"

# A running dev instance would just get focused (single instance) and locks the exe for a build: stop it by PID.
Get-Process -Name "valheim-mod-manager" -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $exe } | ForEach-Object {
	Write-Host "stopping running dev app (PID $($_.Id))"
	Stop-Process -Id $_.Id -Force
}
Start-Sleep -Milliseconds 500

if ($Build) {
	Push-Location $root
	try {
		npm run build:dev-app
		if ($LASTEXITCODE) { throw "npm run build:dev-app failed" }
	} finally { Pop-Location }
}
if (-not (Test-Path $exe)) { throw "no dev app at $exe; run with -Build" }

if ($Reset -and (Test-Path $dev)) { Remove-Item -Recurse -Force $dev }
New-Item -ItemType Directory -Force (Join-Path $dev "profiles") | Out-Null
New-Item -ItemType Directory -Force (Join-Path $dev "cache") | Out-Null

# Read-only copies from the installed app: settings (game dir), index cache (saves a fetch).
foreach ($f in @("settings.json", "cache\index.json")) {
	$src = Join-Path $prod $f
	$dst = Join-Path $dev $f
	if ((Test-Path $src) -and -not (Test-Path $dst)) { Copy-Item $src $dst }
}

$summary = "no profile"
if (-not $NoSeed) {
	$sync = Invoke-RestMethod "$Companion/api/sync"
	if (-not $sync.enabled -or -not $sync.code) { throw "the companion at $Companion has no gist sync on (pwsh ..\test\up.ps1 -SetupSync)" }
	$vars = @{}
	Get-Content (Join-Path $ws "test\.env") | ForEach-Object { if ($_ -match '^\s*([A-Z_]+)=(.*)$') { $vars[$Matches[1]] = $Matches[2].Trim() } }
	$token = $vars["COMPANION_GIST_TOKEN"]
	if (-not $token) { throw "test/.env: COMPANION_GIST_TOKEN is missing" }

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
	$link = [ordered]@{ url = ""; name = "PetersWelte"; syncCode = $sync.code; gistToken = $token }
	if ($p.PSObject.Properties["server"]) { $p.server = $link } else { $p | Add-Member -NotePropertyName server -NotePropertyValue $link }
	$p | ConvertTo-Json -Depth 10 | Set-Content $pf -Encoding utf8
	Set-Content (Join-Path $dev "active.txt") $Profile -NoNewline -Encoding ascii
	$summary = "$Profile, $(@($p.mods).Count) mods, linked to gist $($sync.gistId) with the token from test/.env"
	$token = $null
}

if ($Cdp) { $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=9229" }
Write-Host "dev data dir : $dev"
Write-Host "profile      : $summary"
Write-Host "starting     : $exe$(if ($Cdp) { ' (CDP on 127.0.0.1:9229)' })"
Start-Process $exe
if ($Cdp) { $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "" }
