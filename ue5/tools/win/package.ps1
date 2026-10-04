# Package TownChess for Win64 with the local core bundled (node runtime + dist/core) under Content\TownChessCore.
param([string]$Config = 'Development')
. "$PSScriptRoot\common.ps1"
Push-Location $Repo
npm ci --no-audit --no-fund | Out-Null
node tools/bundle-core.mjs
node tools/verify-core-bundle.mjs
Pop-Location
$coreDst = Join-Path $Repo 'ue5\TownChess\Content\TownChessCore'
New-Item -ItemType Directory -Force $coreDst | Out-Null
Copy-Item (Join-Path $Repo 'dist\core\*') $coreDst -Force
Copy-Item 'C:\Program Files\nodejs\node.exe' $coreDst -Force
Copy-Item 'C:\Program Files\nodejs\LICENSE' (Join-Path $coreDst 'NODE-LICENSE.txt') -Force -ErrorAction SilentlyContinue
# -prereqs stages Engine\Extras\Redist (VC++ and GameInput installers): the launcher stub offers them when a PC lacks them
& "$UERoot\Engine\Build\BatchFiles\RunUAT.bat" BuildCookRun "-project=$Project" -platform=Win64 "-clientconfig=$Config" -build -cook -stage -pak -prereqs -archive "-archivedirectory=$Builds\$Config" -utf8output -unattended 2>&1 | Tee-Object -FilePath "$Logs\package-$Config.log" | Select-String -Pattern 'BUILD SUCCESSFUL|BUILD FAILED|Error:|AutomationTool exiting' | ForEach-Object { $_.Line }
exit $LASTEXITCODE
