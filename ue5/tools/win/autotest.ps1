# Runs Scripts/autotest.py in the uncooked game.  autotest.ps1 -Test rematch [-Auto cpu:novice:w:untimed] [-Extra '...']
param([string]$Test = 'cpu', [string]$Auto = 'cpu:novice:w:untimed', [string]$Extra = '', [int]$TimeoutSec = 900, [switch]$KeepJournal)
. "$PSScriptRoot\common.ps1"
$out = Join-Path $Workspace "autotest\$Test"
New-Item -ItemType Directory -Force $out | Out-Null
$script = (Join-Path $Repo 'ue5\TownChess\Scripts\autotest.py').Replace('\', '/')
$log = Join-Path $Logs "autotest-$Test.log"
$argv = @("`"$Project`"", '/Game/TownChess/L_Table', '-game', '-RenderOffscreen', '-nosound', '-unattended', "-tcauto=$Auto",
          "-ExecCmds=`"py $script`"", "-TCTest=$Test", "-TCOut=$($out.Replace('\', '/'))", "-abslog=`"$log`"") + ($Extra -split ' ' | Where-Object { $_ })
if (-not $KeepJournal) { Remove-Item (Join-Path $Repo 'ue5\TownChess\Saved\TownChess\core\journal') -Recurse -Force -ErrorAction SilentlyContinue  # fresh game }
$p = Start-Process "$UERoot\Engine\Binaries\Win64\UnrealEditor.exe" -ArgumentList $argv -PassThru
if (-not $p.WaitForExit($TimeoutSec * 1000)) { $p.Kill(); throw 'autotest timed out' }
Select-String -Path $log -Pattern '\[TCTEST\] (PASS|FAIL|RESULT)' | ForEach-Object { $_.Line -replace '^.*\[TCTEST\] ', '' }
