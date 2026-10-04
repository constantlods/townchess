# Runs Scripts/mh_opponent.py headless. -Stages: create,inspect,body,skin,rig,textures,build
param([string]$Stages = 'create,inspect', [string]$Name = 'MH_Opponent', [string]$Preset = '')
. "$PSScriptRoot\common.ps1"
$env:TC_MH_STAGES = $Stages
$env:TC_MH_NAME = $Name
$env:TC_MH_PRESET = $Preset
& "$UERoot\Engine\Binaries\Win64\UnrealEditor-Cmd.exe" $Project "-ExecutePythonScript=$(Join-Path $Repo 'ue5\TownChess\Scripts\mh_opponent.py')" -unattended -nosplash -RenderOffscreen '-log=metahuman.log' 2>&1 | Out-Null
Select-String -Path (Join-Path $Repo 'ue5\TownChess\Saved\Logs\metahuman.log') -Pattern '\[TCMH\]|Error: .*MetaHuman|LogMetaHuman.*(Error|Warning)|login|Login|auth' | ForEach-Object { $_.Line }
