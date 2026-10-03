# Compile the TownChess editor target (Win64 Development).
. "$PSScriptRoot\common.ps1"
& "$UERoot\Engine\Build\BatchFiles\Build.bat" TownChessEditor Win64 Development "-Project=$Project" -WaitMutex 2>&1 | Tee-Object -FilePath "$Logs\build-editor.log" | Select-String -Pattern 'error|warning C4|Result:|Total execution' | ForEach-Object { $_.Line }
exit $LASTEXITCODE
