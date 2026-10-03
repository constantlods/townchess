# Tests a packaged TownChess build on Windows. Read-only towards the system (Defender is only queried).
#  1. smoke: -tcsmoke plays N plies vs the bundled local core; smoke.json must pass; no node.exe may remain
#  2. Job Object: kill the game hard while its core runs; Windows must kill the core with it
#  3. antivirus: report Defender real-time state and any detection touching the build
param([string]$Config = 'Development', [int]$Plies = 12)
. "$PSScriptRoot\common.ps1"
$root = Join-Path $Builds "$Config\Windows"
$exe = Join-Path $root 'TownChess.exe'
if (-not (Test-Path $exe)) { throw "no packaged build at $exe" }
$saved = Join-Path $root 'TownChess\Saved\TownChess'
$results = [ordered]@{}

function CoreChildren([int]$parentPid) {
  # the launcher stub starts the real game process; the core is node.exe under either
  $ids = @($parentPid) + @(Get-CimInstance Win32_Process -Filter "ParentProcessId=$parentPid" | ForEach-Object ProcessId)
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $ids -contains $_.ParentProcessId }
}

# 1. smoke
Remove-Item (Join-Path $saved 'smoke.json') -ErrorAction SilentlyContinue
$p = Start-Process $exe -ArgumentList @("-tcsmoke=$Plies", '-RenderOffscreen', '-nosound', '-unattended', '-windowed', '-ResX=1280', '-ResY=720') -PassThru
if (-not $p.WaitForExit(900000)) { $p.Kill(); $results.smoke = 'TIMEOUT' }
Start-Sleep 3
$smoke = Get-Content (Join-Path $saved 'smoke.json') -Raw -ErrorAction SilentlyContinue | ConvertFrom-Json
$results.smoke = if ($smoke) { "pass=$($smoke.pass) reason=$($smoke.reason) plies=$($smoke.plies) failures=$($smoke.failures) rhi=$($smoke.rhi)" } else { 'no smoke.json' }
$left = Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.ExecutablePath -like "$root*" }
$results.smokeOrphans = @($left).Count

# 2. Job Object: hard kill while the core is running
$p = Start-Process $exe -ArgumentList @('-tcauto=cpu:novice:w:untimed', '-RenderOffscreen', '-nosound', '-unattended', '-windowed', '-ResX=1280', '-ResY=720') -PassThru
$core = $null
for ($i = 0; $i -lt 120 -and -not $core; $i++) { Start-Sleep 1; $core = Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.ExecutablePath -like "$root*" } | Select-Object -First 1 }
if ($core) {
  $results.coreStarted = "pid $($core.ProcessId): $($core.ExecutablePath)"
  Get-CimInstance Win32_Process -Filter "ParentProcessId=$($p.Id)" | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Stop-Process -Id $p.Id -Force
  Start-Sleep 3
  $still = Get-Process -Id $core.ProcessId -ErrorAction SilentlyContinue
  $results.jobObject = if ($still) { 'FAIL core survived the game' } else { 'PASS core terminated with the game' }
  if ($still) { Stop-Process -Id $core.ProcessId -Force }
} else { $results.coreStarted = 'FAIL no bundled core process seen'; Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue }

# 3. antivirus (read-only)
try {
  $st = Get-MpComputerStatus
  $results.defender = "realtime=$($st.RealTimeProtectionEnabled) antivirus=$($st.AntivirusEnabled)"
  $hits = Get-MpThreatDetection -ErrorAction SilentlyContinue | Where-Object { ($_.Resources -join ' ') -match 'TownChess|townchess-core|node\.exe' }
  $results.defenderDetections = @($hits).Count
} catch { $results.defender = "query failed: $_" }

$results | ConvertTo-Json | Tee-Object -FilePath (Join-Path $Logs "test-package-$Config.json")
