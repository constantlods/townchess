# Beta checks on the packaged build (docs/BETA.md S2, S3). Read-only towards the system.
#   beta_checks.ps1 [-Games 10] [-PerfRes 2560x1440]
#  S2: N consecutive packaged games against the engine, each played to its end (-tcsmoke=400 stops at the game's end
#      or 400 plies): every game must pass (no desync/silent repair), and no game or core process may be left behind.
#  S3: one packaged game at PerfRes with the default (auto) graphics preset; smoke.json reports average and 1%-low fps
#      over the game after a 10 s warm-up. Note: -RenderOffscreen in the SSH session has no vsync/present cost.
param([int]$Games = 10, [string]$PerfRes = '2560x1440', [string]$Level = 'novice')
. "$PSScriptRoot\common.ps1"
$root = Join-Path $Builds 'Development\Windows'
$exe = Join-Path $root 'TownChess\Binaries\Win64\TownChess.exe'
$saved = Join-Path $root 'TownChess\Saved\TownChess'
function BuildProcs { Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -like "$root*" } }
if (@(BuildProcs).Count) { throw 'build processes already running; stop them first' }
$res = [ordered]@{ games = @() }
function RunGame([string]$tag, [string[]]$extra) {
  Remove-Item (Join-Path $saved 'smoke.json') -ErrorAction SilentlyContinue
  $p = Start-Process $exe -ArgumentList (@('-tcsmoke=400', '-RenderOffscreen', '-nosound', '-unattended', "-abslog=$Logs\beta-$tag.log") + $extra) -PassThru
  $timedOut = -not $p.WaitForExit(1800000); if ($timedOut) { $p.Kill() }
  Start-Sleep 3
  $s = Get-Content (Join-Path $saved 'smoke.json') -Raw -ErrorAction SilentlyContinue | ConvertFrom-Json
  [ordered]@{ tag = $tag; pass = [bool]($s -and $s.pass); reason = $(if ($s) { $s.reason } else { "no smoke.json (timedOut=$timedOut)" });
              plies = $(if ($s) { $s.plies } else { -1 }); failures = $(if ($s) { $s.failures } else { -1 });
              avgFps = $(if ($s) { $s.avgFps } else { 0 }); low1Fps = $(if ($s) { $s.low1Fps } else { 0 });
              resolution = $(if ($s) { $s.resolution } else { '' }); leftover = @(BuildProcs).Count }
}
for ($i = 1; $i -le $Games; $i++) { $res.games += RunGame "game$i" @('-windowed', '-ResX=1280', '-ResY=720') }
$w, $h = $PerfRes.Split('x')
# -RenderOffscreen ignores -ResX/-ResY (the first run rendered 888x500): set the resolution with r.SetRes as well
$res.perf = RunGame 'perf' @('-windowed', "-ResX=$w", "-ResY=$h", "-ExecCmds=`"r.SetRes ${PerfRes}w`"")
# S2 needs games: zero games is "not run", never a pass (oversight run 4 found "PASS 0/0"); a perf-only run writes its
# own file so it cannot overwrite the S2 evidence
$res.s2 = if ($Games -le 0) { 'not run' } elseif (@($res.games | Where-Object { -not $_.pass -or $_.leftover }).Count -eq 0) { "PASS $Games/$Games" } else { 'FAIL' }
$res.when = (Get-Date -Format s)
$file = if ($Games -le 0) { 'beta-perf.json' } else { 'beta-checks.json' }
$res | ConvertTo-Json -Depth 4 | Tee-Object -FilePath (Join-Path $Logs $file)
