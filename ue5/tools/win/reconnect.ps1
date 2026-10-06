# Kill/reconnect test on Windows (port of ue5/tools/reconnect_test.sh; docs/BETA.md G2/S4):
#  1. play vs the engine in the uncooked game and kill it at ply N (autotest -TCKillAtPly)
#  2. no local core (node.exe started by this test) may survive the kill
#  3. relaunch keeping the journal: the core restores the game, the client reconnects, rebuilds board/turn/clocks
#     (-TCExpectPly/-TCExpectFen) and plays on
param([int]$Ply = 12)
. "$PSScriptRoot\common.ps1"
$t0 = Get-Date
& "$PSScriptRoot\autotest.ps1" -Test cpu -Auto 'cpu:novice:w:5+0' -Extra "-TCKillAtPly=$Ply" | Out-Null
$r1 = Get-Content (Join-Path $Workspace 'autotest\cpu\result.json') -Raw | ConvertFrom-Json
"killed at ply $($r1.killed_at_ply)"
Start-Sleep 3
$orphans = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CreationDate -gt $t0 })
if ($orphans.Count) { "FAIL orphan local core(s): $($orphans.Count)" } else { 'PASS no orphan local core after the kill' }
$fen = ([string]$r1.killed_fen).Replace(' ', '_')
& "$PSScriptRoot\autotest.ps1" -Test reconnect -Auto '' -KeepJournal -Extra "-TCExpectPly=$($r1.killed_at_ply) -TCExpectFen=$fen" -TimeoutSec 1200 | Out-Null
$r2 = Get-Content (Join-Path $Workspace 'autotest\reconnect\result.json') -Raw | ConvertFrom-Json
"RECONNECT pass=$($r2.pass) checks=$(@($r2.checks | Where-Object { $_.ok }).Count)/$(@($r2.checks).Count) " + ((@($r2.checks | Where-Object { -not $_.ok }) | ForEach-Object { $_.name + ' ' + $_.detail }) -join '; ')
