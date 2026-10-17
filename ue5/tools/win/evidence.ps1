# Beta evidence (docs/BETA.md G2): runs the UE autotest suite strictly and writes C:\TownChess\logs\beta-evidence-suite.json.
# G2 evidence, strict: each result.json is deleted first, empty arguments are never passed (powershell -File drops an
# empty string and the script then aborts on a missing value), and only a result written after the test began counts.
$w = 'C:\TownChess\townchess\ue5\tools\win'
& powershell -NoProfile -ExecutionPolicy Bypass -File "$w\lock.ps1" -Action acquire -Owner lead -WaitMin 240
if ($LASTEXITCODE -ne 0) { 'NO LOCK'; exit 2 }
try {
  Set-Location C:\TownChess\townchess; git pull -q
  $ev = [ordered]@{ commit = (git log --oneline -1); started = (Get-Date -Format s); tests = [ordered]@{} }
  $names = @('cpu', 'drag', 'keys', 'rematch', 'promo')
  $extra = @{ promo = '-tcstartfen=8/4P3/8/8/8/8/k7/4K3_w_-_-_0_1 -tcallowstartfen' }
  if ($env:TC_DRYRUN) { foreach ($t in $names) { "would run $t extra=[$($extra[$t])]" }; exit 0 }
  foreach ($t in $names) {
    $rf = "C:\TownChess\autotest\$t\result.json"
    Remove-Item $rf -ErrorAction SilentlyContinue
    $t0 = Get-Date
    $args2 = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "$w\autotest.ps1", '-Test', $t)
    if ($extra.ContainsKey($t)) { $args2 += @('-Extra', $extra[$t]) }
    & powershell @args2 2>&1 | Out-Null
    if ((Test-Path $rf) -and (Get-Item $rf).LastWriteTime -gt $t0) {
      $r = Get-Content $rf -Raw | ConvertFrom-Json
      $ev.tests[$t] = "pass=$($r.pass) $(@($r.checks | Where-Object { $_.ok }).Count)/$(@($r.checks).Count) at $((Get-Item $rf).LastWriteTime.ToString('s'))"
    } else { $ev.tests[$t] = 'DID NOT RUN (no fresh result.json)' }
  }
  $ev.finished = (Get-Date -Format s)
  $ev | ConvertTo-Json -Depth 4 | Tee-Object -FilePath C:\TownChess\logs\beta-evidence-suite.json
} finally { & powershell -NoProfile -ExecutionPolicy Bypass -File "$w\lock.ps1" -Action release -Owner lead }
