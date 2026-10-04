# Reference-comparison screenshot of the uncooked game from the player's seat (Scripts/capture.py).
#   capture.ps1 -Name baseline [-Res 1920x1080] [-Preset cinematic] [-Auto cpu:novice:w:untimed]
param([string]$Name = 'shot', [string]$Res = '1920x1080', [string]$Preset = 'cinematic',
      [string]$Auto = 'cpu:novice:w:untimed', [int]$WarmSec = 30, [string]$Source = 'final')
. "$PSScriptRoot\common.ps1"
$shots = Join-Path $Workspace 'shots'
New-Item -ItemType Directory -Force $shots | Out-Null
$out = (Join-Path $shots "$Name.png").Replace('\', '/')
$script = (Join-Path $Repo 'ue5\TownChess\Scripts\capture.py').Replace('\', '/')
$log = Join-Path $Logs "capture-$Name.log"
$argv = @("`"$Project`"", '/Game/TownChess/L_Table', '-game', '-RenderOffscreen', '-nosound', '-unattended',
          "-tcauto=$Auto", "-ExecCmds=`"py $script`"", "-TCShot=$out", "-TCShotRes=$Res", "-TCPreset=$Preset",
          "-TCWarmSec=$WarmSec", "-TCSource=$Source", "-abslog=`"$log`"")
$p = Start-Process "$UERoot\Engine\Binaries\Win64\UnrealEditor.exe" -ArgumentList $argv -PassThru
if (-not $p.WaitForExit(900000)) { $p.Kill(); throw 'capture timed out' }
Select-String -Path $log -Pattern '\[TCSHOT\]' | ForEach-Object { $_.Line }
if (-not (Test-Path $out)) { throw "no screenshot at $out" }
