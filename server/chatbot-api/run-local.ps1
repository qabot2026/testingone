# Optional local test ONLY if you have a Firebase service account JSON key file (Firebase Console → Project settings → Service accounts).
# Production uses Railway + FIREBASE_SERVICE_ACCOUNT_JSON — see STEP-BY-STEP.md.
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

Write-Host "--- Contact form API (local) ---" -ForegroundColor Cyan
Write-Host ""

$haveKey = (Read-Host "Do you have a service account JSON key file on disk? [y/N]").Trim().ToLowerInvariant()
if ($haveKey -ne "y" -and $haveKey -ne "yes") {
    Write-Host ""
    Write-Host "You don't need this script." -ForegroundColor Yellow
    Write-Host "  No local key file  ->  Deploy on Railway; set FIREBASE_SERVICE_ACCOUNT_JSON in Railway (STEP-BY-STEP.md)."
    Write-Host "  Org blocks keys     ->  Same: use Railway variables; do not commit secrets."
    Write-Host ""
    exit 0
}

Write-Host ""
Write-Host "JSON key — full Windows path examples:" -ForegroundColor DarkGray
Write-Host '  C:\Keys\my-project-sa.json' -ForegroundColor DarkGray
Write-Host "  Tip: Shift+Right-click the .json file in Explorer -> Copy as path, then paste and remove quotes if any." -ForegroundColor DarkGray
Write-Host ""

$keyPathRaw = Read-Host "Full path to service account JSON file"
$keyPath = $keyPathRaw.Trim().TrimStart('"').TrimEnd('"')

Write-Host ""
Write-Host "Sheet ID — from the browser URL:" -ForegroundColor DarkGray
Write-Host "  https://docs.google.com/spreadsheets/d/THIS_PART_IS_THE_ID/edit" -ForegroundColor DarkGray
Write-Host ""

$sheetId = (Read-Host "Paste Google Sheet ID only").Trim()
if (-not (Test-Path -LiteralPath $keyPath)) {
    throw "File not found: $keyPath"
}

$env:GOOGLE_APPLICATION_CREDENTIALS = $keyPath
$env:SHEETS_SPREADSHEET_ID = $sheetId
Remove-Item Env:\DISABLE_FIRESTORE -ErrorAction SilentlyContinue
Remove-Item Env:\DISABLE_SHEETS -ErrorAction SilentlyContinue

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    Write-Host "Install Node.js first, then reopen PowerShell." -ForegroundColor Red
    exit 1
}

npm install
Write-Host ""
Write-Host "Listening on http://localhost:8080/contact-form-submissions" -ForegroundColor Green
npm start
