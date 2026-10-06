# HUD portraits: a headshot of each opponent from the game (capture.ps1 close-up through the opponent's seat).
# Output C:\TownChess\shots\portrait_<id>.png; ue5/tools/portraits.py crops/grades them into ue5/assets/ui/.
param([string[]]$Opponents = @('caged', 'annotator'))
foreach ($o in $Opponents) {
  & "$PSScriptRoot\capture.ps1" -Name "portrait_$o" -Preset epic -Auto 'none' -WarmSec 15 `
    -Extra "-tcopponent=$o -TCCamLoc=-5,-3.8,112 -TCCamTarget=67,-3.8,104 -TCFov=30" | Select-String 'exported|FAILED'
}
