# Tests a packaged TownChess build on Windows. Read-only towards the system (Defender is only queried).
#  1. smoke: -tcsmoke plays N plies vs the bundled local core; smoke.json must pass; no node.exe may remain
#  2. Job Object: kill the game hard while its core runs; Windows must kill the core with it
#  3. antivirus: report Defender real-time state and any detection touching the build
param([string]$Config = 'Development', [int]$Plies = 12)
. "$PSScriptRoot\common.ps1"
$root = Join-Path $Builds "$Config\Windows"
# the real game binary: the root TownChess.exe is UE's bootstrap stub, which hung with no child in the non-interactive
# SSH session (session 0); the owner's interactive launch covers the stub
$exe = Join-Path $root 'TownChess\Binaries\Win64\TownChess.exe'
if (-not (Test-Path $exe)) { throw "no packaged build at $exe" }
$saved = Join-Path $root 'TownChess\Saved\TownChess'
$results = [ordered]@{}

function BuildProcs { Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -like "$root*" } }
function CoreOf([int]$gamePid) { Get-CimInstance Win32_Process -Filter "ParentProcessId=$gamePid AND Name='node.exe'" | Select-Object -First 1 }
$busy = @(BuildProcs)
if ($busy.Count) { throw "build processes already running (pids $($busy.ProcessId -join ',')); stop them first so results are not mixed" }

# 1. smoke
Remove-Item (Join-Path $saved 'smoke.json') -ErrorAction SilentlyContinue
$p = Start-Process $exe -ArgumentList @("-tcsmoke=$Plies", '-RenderOffscreen', '-nosound', '-unattended', '-windowed', '-ResX=1280', '-ResY=720', "-abslog=$Logs\pkg-smoke.log") -PassThru
$timedOut = -not $p.WaitForExit(900000); if ($timedOut) { $p.Kill() }
Start-Sleep 3
$smoke = Get-Content (Join-Path $saved 'smoke.json') -Raw -ErrorAction SilentlyContinue | ConvertFrom-Json
$results.smoke = if ($smoke) { "pass=$($smoke.pass) reason=$($smoke.reason) plies=$($smoke.plies) failures=$($smoke.failures) rhi=$($smoke.rhi)" } else { "no smoke.json (timedOut=$timedOut)" }
$results.smokeCorePid = if ($smoke) { $smoke.corePid } else { $null }
$results.smokeLeftover = @(BuildProcs).Count

# 2. Job Object: hard kill while the core is running
$p = Start-Process $exe -ArgumentList @('-tcauto=cpu:novice:w:untimed', '-RenderOffscreen', '-nosound', '-unattended', '-windowed', '-ResX=1280', '-ResY=720', "-abslog=$Logs\pkg-jobobject.log") -PassThru
$core = $null
for ($i = 0; $i -lt 120 -and -not $core; $i++) { Start-Sleep 1; $core = CoreOf $p.Id }
if ($core) {
  $results.coreStarted = "pid $($core.ProcessId): $($core.ExecutablePath)"
  Stop-Process -Id $p.Id -Force   # TerminateProcess: no shutdown code runs, only the Job Object can take the core down
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
