# Shared settings for the TownChess Windows scripts. Everything stays inside the workspace.
$ErrorActionPreference = 'Stop'
$Workspace = if ($env:TC_WORKSPACE) { $env:TC_WORKSPACE } else { 'C:\TownChess' }
$Repo      = Join-Path $Workspace 'townchess'
$Project   = Join-Path $Repo 'ue5\TownChess\TownChess.uproject'
$UERoot    = if ($env:TC_UE_ROOT) { $env:TC_UE_ROOT } else { 'C:\Program Files\Epic Games\UE_5.8' }
$Logs      = Join-Path $Workspace 'logs'
$Assets    = Join-Path $Workspace 'assets\polyhaven'
$Builds    = Join-Path $Workspace 'builds'
$env:PATH  = "C:\Program Files\nodejs;$env:PATH"
New-Item -ItemType Directory -Force $Logs, $Builds | Out-Null
if (-not (Test-Path "$UERoot\Engine\Binaries\Win64\UnrealEditor.exe")) { throw "Unreal Engine not found at $UERoot (set TC_UE_ROOT)" }
