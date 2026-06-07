# Reset bloated Cursor global state (fixes renderer OOM when state.vscdb grows to GB+).
# Close Cursor completely before running (File > Exit, not just Reload Window).

$ErrorActionPreference = "Stop"
$globalStorage = Join-Path $env:APPDATA "Cursor\User\globalStorage"
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backupDir = Join-Path $globalStorage "state-backup-$stamp"

if (-not (Test-Path $globalStorage)) {
  Write-Error "Cursor globalStorage not found: $globalStorage"
}

$targets = @(
  "state.vscdb",
  "state.vscdb-wal",
  "state.vscdb-shm",
  "state.vscdb.backup"
)

Get-ChildItem $globalStorage -Filter "state.vscdb.corrupted.*" -ErrorAction SilentlyContinue | ForEach-Object { $targets += $_.Name }

$existing = @()
foreach ($name in $targets) {
  $path = Join-Path $globalStorage $name
  if (Test-Path $path) { $existing += $path }
}

if ($existing.Count -eq 0) {
  Write-Host "No state.vscdb files found — nothing to reset."
  exit 0
}

Write-Host "Found state files:"
foreach ($path in $existing) {
  $mb = [math]::Round((Get-Item $path).Length / 1MB, 2)
  Write-Host "  $mb MB  $path"
}

New-Item -ItemType Directory -Path $backupDir -Force | Out-Null
foreach ($path in $existing) {
  Move-Item -Path $path -Destination (Join-Path $backupDir (Split-Path $path -Leaf)) -Force
}

Write-Host ""
Write-Host "Moved state DB to backup folder:"
Write-Host "  $backupDir"
Write-Host ""
Write-Host "Start Cursor again. Settings/extensions sync back; chat history for this machine is cleared."
Write-Host "Delete the backup folder after confirming Cursor is stable."
