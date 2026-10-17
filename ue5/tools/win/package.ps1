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
# Stockfish (GPL-3.0) for the league levels: unmodified upstream binary, run by the core as a separate process.
# Ships with its licence (Copying.txt) and SOURCE.txt (release + source archive), as GPL requires. Cached in the workspace.
$sfZip = Join-Path $Workspace 'assets\engines\stockfish-sf_19-windows-x86-64-universal.zip'
if (-not (Test-Path $sfZip)) {
  New-Item -ItemType Directory -Force (Split-Path $sfZip) | Out-Null
  Invoke-WebRequest -UseBasicParsing 'https://github.com/official-stockfish/Stockfish/releases/download/sf_19/stockfish-windows-x86-64-universal.zip' -OutFile $sfZip
}
$sfTmp = Join-Path $env:TEMP 'tc-stockfish'
Remove-Item $sfTmp -Recurse -Force -ErrorAction SilentlyContinue
Expand-Archive $sfZip $sfTmp
$engines = Join-Path $coreDst 'engines'
New-Item -ItemType Directory -Force $engines | Out-Null
Copy-Item (Get-ChildItem $sfTmp -Recurse -Filter 'stockfish*.exe' | Select-Object -First 1).FullName (Join-Path $engines 'stockfish.exe') -Force
Copy-Item (Get-ChildItem $sfTmp -Recurse -Filter 'Copying.txt' | Select-Object -First 1).FullName $engines -Force
Copy-Item (Join-Path $Repo 'tools\engines\SOURCE.txt') $engines -Force
Remove-Item $sfTmp -Recurse -Force
"stockfish bundled: " + (Get-Item (Join-Path $engines 'stockfish.exe')).Length + " bytes"
# -prereqs stages Engine\Extras\Redist (VC++ and GameInput installers): the launcher stub offers them when a PC lacks them
& "$UERoot\Engine\Build\BatchFiles\RunUAT.bat" BuildCookRun "-project=$Project" -platform=Win64 "-clientconfig=$Config" -build -cook -stage -pak -prereqs -archive "-archivedirectory=$Builds\$Config" -utf8output -unattended 2>&1 | Tee-Object -FilePath "$Logs\package-$Config.log" | Select-String -Pattern 'BUILD SUCCESSFUL|BUILD FAILED|Error:|AutomationTool exiting' | ForEach-Object { $_.Line }
exit $LASTEXITCODE
