# Build-PC lock: one builder at a time (overlapping runs contaminated test results before, see WINDOWS_SETUP.md).
#   lock.ps1 -Action acquire -Owner render-agent [-WaitMin 120]   (waits; a lock older than 3 h counts as stale)
#   lock.ps1 -Action release -Owner render-agent
#   lock.ps1 -Action status
# The lock is a file in the workspace (C:\TownChess\build.lock) holding the owner and the time; nothing else changes.
param([ValidateSet('acquire', 'release', 'status')][string]$Action = 'status', [string]$Owner = 'lead', [int]$WaitMin = 120)
$lock = 'C:\TownChess\build.lock'
function Read-Lock { if (Test-Path $lock) { Get-Content $lock -Raw } else { '' } }
switch ($Action) {
  'status' { $l = Read-Lock; if ($l) { "LOCKED $l" } else { 'FREE' } }
  'release' {
    $l = Read-Lock
    if ($l -and -not $l.StartsWith("$Owner ")) { "NOT OWNER: $l"; exit 1 }
    Remove-Item $lock -ErrorAction SilentlyContinue; "RELEASED by $Owner"
  }
  'acquire' {
    $deadline = (Get-Date).AddMinutes($WaitMin)
    while ($true) {
      if ((Test-Path $lock) -and ((Get-Date) - (Get-Item $lock).LastWriteTime).TotalHours -gt 3) {
        "STALE lock removed: $(Read-Lock)"; Remove-Item $lock -ErrorAction SilentlyContinue
      }
      try {
        $fs = [System.IO.File]::Open($lock, 'CreateNew', 'Write')  # atomic: fails if the file exists
        $b = [System.Text.Encoding]::UTF8.GetBytes("$Owner $(Get-Date -Format s)")
        $fs.Write($b, 0, $b.Length); $fs.Close()
        "ACQUIRED by $Owner"; exit 0
      } catch {
        if ((Get-Date) -gt $deadline) { "TIMEOUT waiting; held by: $(Read-Lock)"; exit 2 }
        Start-Sleep 20
      }
    }
  }
}
