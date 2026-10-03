# One-time content setup: template mannequins, CC0 Poly Haven assets, and the playable level (L_Table).
. "$PSScriptRoot\common.ps1"
$content = Join-Path $Repo 'ue5\TownChess\Content'
foreach ($pair in @(@('Templates\TemplateResources\High\Characters\Content', 'Characters'), @('Templates\TemplateResources\Standard\XRMannequins\Content', 'XRMannequins'))) {
  $dst = Join-Path $content $pair[1]
  if (-not (Test-Path $dst)) { Copy-Item -Recurse (Join-Path $UERoot $pair[0]) $dst }
}
if (-not (Test-Path (Join-Path $Assets 'models\chess_set'))) { python (Join-Path $Repo 'ue5\tools\fetch_polyhaven.py') $Assets 2k }
$env:TC_ASSETS = $Assets
& "$UERoot\Engine\Binaries\Win64\UnrealEditor-Cmd.exe" $Project "-ExecutePythonScript=$(Join-Path $Repo 'ue5\TownChess\Scripts\build_level.py')" -unattended -nosplash -nullrhi -log=build-level.log 2>&1 | Out-Null
Select-String -Path (Join-Path $Repo 'ue5\TownChess\Saved\Logs\build-level.log') -Pattern 'TCBENCH\] (BUILD|board pieces|WARNING)' | ForEach-Object { $_.Line }
