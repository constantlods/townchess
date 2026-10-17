# Graphics benchmark (docs/graphics): fixed cameras via capture.ps1 (UnrealEditor -game -RenderOffscreen) + packaged perf run (beta_checks.ps1 -Games 0). Takes the build-PC lock.
$w = 'C:\TownChess\townchess\ue5\tools\win'
& powershell -NoProfile -ExecutionPolicy Bypass -File "$w\lock.ps1" -Action acquire -Owner lead -WaitMin 120
if ($LASTEXITCODE -ne 0) { 'NO LOCK'; exit 2 }
try {
  Set-Location C:\TownChess\townchess; git pull -q; git log --oneline -1
  $shots = @(@('base_main', 'cpu:novice:w:5+0', '-TCHud=1 -TCPlay=10'),
             @('base_hands', 'cpu:novice:w:untimed', '-tcview=0 -TCCamLoc=-56,-46,116 -TCCamTarget=-38,-20,98 -TCFov=36'),
             @('base_opponent', 'cpu:novice:w:untimed', '-TCCamLoc=-5,-3.8,112 -TCCamTarget=67,-3.8,104 -TCFov=30'),
             @('base_black', 'cpu:novice:b:untimed', '-TCHud=1 -TCPlay=10'))
  foreach ($s in $shots) { & powershell -NoProfile -ExecutionPolicy Bypass -File "$w\capture.ps1" -Name $s[0] -Preset epic -Auto $s[1] -Extra $s[2] -WarmSec 22 2>&1 | Select-String 'exported|FAILED' }
  & powershell -NoProfile -ExecutionPolicy Bypass -File "$w\beta_checks.ps1" -Games 0 2>&1 | Out-Null
  $r = Get-Content C:\TownChess\logs\beta-perf.json -Raw | ConvertFrom-Json
  "PERF $($r.perf.resolution) avg=$($r.perf.avgFps) low1=$($r.perf.low1Fps) pass=$($r.perf.pass)"
  nvidia-smi --query-gpu=memory.used,utilization.gpu --format=csv,noheader
} finally { & powershell -NoProfile -ExecutionPolicy Bypass -File "$w\lock.ps1" -Action release -Owner lead }
