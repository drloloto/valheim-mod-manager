<#
.SYNOPSIS
Checks the running test companion against the snapshot it was seeded with (test/seed.ps1): the lock it serves,
installed.json, the on-disk comparison (reparse) and the profile zip. Prints ok/FAIL lines, exit 1 on a FAIL.

.PARAMETER Lock   The reference lock (default: the newest test/snapshots/*.lock.json, written by seed.ps1).
.PARAMETER Base   The companion (default http://127.0.0.1:9002).
#>
param([string]$Lock = "", [string]$Base = "http://127.0.0.1:9002")
$ErrorActionPreference = "Stop"
$test = $PSScriptRoot
$snapshots = Join-Path $test "snapshots"
if (-not $Lock) { $Lock = Get-ChildItem $snapshots -Filter "*.lock.json" -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1 -ExpandProperty FullName }
if (-not $Lock -or -not (Test-Path $Lock)) { throw "no reference lock; run test/seed.ps1 first" }
$ref = Get-Content $Lock -Raw | ConvertFrom-Json
$refInstalledPath = $Lock -replace "\.lock\.json$", ".installed.json"
$refInstalled = if (Test-Path $refInstalledPath) { Get-Content $refInstalledPath -Raw | ConvertFrom-Json } else { $null }
$failed = @()
function Check([bool]$ok, [string]$what) { if ($ok) { Write-Host "  ok   $what" } else { Write-Host "  FAIL $what"; $script:failed += $what } }
$admin = (Get-Content (Join-Path $test "config\modmanager\companion-token") -Raw).Trim()
$auth = @{ Authorization = "Bearer $admin" }

Write-Host "== companion"
$health = Invoke-RestMethod "$Base/api/health"
Check ($health.ok) "health ok"
$status = Invoke-RestMethod "$Base/api/status" -Headers $auth
Check ($status.container.state -eq "running") "game container is running (seed.ps1 starts it): $(if ($status.container) { $status.container.state } else { "not found" })"
Check ($status.server.name -eq $ref.server.name) "server name is the snapshot's ($($status.server.name))"
Check ($null -eq $status.release) "no release is staged"

Write-Host "== the lock after migration"
$m = Invoke-RestMethod "$Base/api/manifest"
$refById = @{}; foreach ($x in $ref.mods) { $refById[$x.id] = $x }
$byId = @{}; foreach ($x in $m.mods) { $byId[$x.id] = $x }
Check ($m.schema -eq 1) "schema 1"
Check ($byId.Count -eq $refById.Count) "same number of mods ($($byId.Count) of $($refById.Count))"
foreach ($id in $refById.Keys | Sort-Object) {
	$r = $refById[$id]; $x = $byId[$id]
	if (-not $x) { Check $false "$id is in the lock"; continue }
	Check ($x.version -eq $r.version -and $x.explicit -eq $r.explicit) ("{0} {1}{2}" -f $id, $x.version, $(if ($x.explicit) { "" } else { " (dependency)" }))
	if ($x.source) { Check ($x.source -eq "hexium") "$id names its store ($($x.source))" }
}
foreach ($id in $byId.Keys) { if (-not $refById.ContainsKey($id)) { Check $false "$id appeared in the lock" } }
Check ($m.hash -eq $ref.hash) "lock hash unchanged ($($m.hash))"
Check (@($m.configs.PSObject.Properties).Count -ge @($ref.configs.PSObject.Properties).Count) "config hashes ($(@($m.configs.PSObject.Properties).Count), snapshot $(@($ref.configs.PSObject.Properties).Count))"

Write-Host "== installed.json"
$inst = Invoke-RestMethod "$Base/api/installed"
foreach ($id in $refById.Keys | Sort-Object) {
	if ($id -like "*-BepInExPack_Valheim") { continue } # shipped by the server image
	$e = $inst.$id
	Check ($null -ne $e -and $e.version -eq $refById[$id].version -and @($e.files).Count -gt 0) ("{0} installed {1}, {2} files" -f $id, $e.version, @($e.files).Count)
}
if ($refInstalled) { Check (@($inst.PSObject.Properties).Count -eq @($refInstalled.PSObject.Properties).Count) "installed.json has the snapshot's entries ($(@($inst.PSObject.Properties).Count))" }

Write-Host "== on disk (reparse inside the container)"
Push-Location $test
try { $json = docker compose exec -T companion bun run src/reparse.ts --json 2>$null | Out-String } finally { Pop-Location }
$rep = try { $json | ConvertFrom-Json } catch { $null }
Check ($null -ne $rep) "reparse answered"
if ($rep) {
	$bad = @($rep.rows | Where-Object { $_.status -ne "ok" })
	Check ($rep.inSync) "lock matches what is on disk"
	foreach ($r in $bad) { Write-Host ("       {0}: lock {1}, disk {2}, {3} {4}{5}" -f $r.id, $r.lock, $r.disk, $r.source, $r.status, $(if ($r.note) { " ($($r.note))" } else { "" })) }
	if ($rep.unidentified.Count) { Write-Host "       unidentified in plugins/: $($rep.unidentified -join ', ')" }
}

Write-Host "== profile zip and takeover view"
$r2z = Invoke-WebRequest "$Base/api/profile.r2z" -Headers $auth
Check ($r2z.StatusCode -eq 200 -and $r2z.RawContentLength -gt 1000) "profile.r2z ($($r2z.RawContentLength) bytes)"
$take = Invoke-RestMethod "$Base/api/takeover" -Headers $auth
Check ($take.lock -eq $byId.Count) "takeover view sees the lock ($($take.lock) mods, $(@($take.scan.candidates).Count) package folders, $(@($take.scan.unidentified).Count) unidentified)"

Write-Host ""
if ($failed.Count) { Write-Host "FAILED: $($failed.Count) check(s)"; exit 1 }
Write-Host "PASS: the companion serves the snapshot's state unchanged"
