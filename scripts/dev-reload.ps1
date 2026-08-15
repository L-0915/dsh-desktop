# Safe plugin dev loop for dsh-desktop — builds and verifies only.
# It NEVER kills or restarts the web service: host-side changes need a
# restart, and that decision belongs to you (this script tells you when).
#
# Usage (from D:\dsh-home\dsh-desktop):
#   powershell -File scripts\dev-reload.ps1
$ErrorActionPreference = 'Stop'

$root = Split-Path $PSScriptRoot -Parent
$pkg = Join-Path $root 'packages\dsh-desktop'

Write-Host '==> [1/3] Building plugin...' -ForegroundColor Cyan
Push-Location $pkg
pnpm run build
if ($LASTEXITCODE -ne 0) { Pop-Location; Write-Host 'BUILD FAILED' -ForegroundColor Red; exit 1 }
Pop-Location

Write-Host '==> [2/3] Verifying artifact contract...' -ForegroundColor Cyan
& (Join-Path $PSScriptRoot 'verify-artifacts.ps1')
if ($LASTEXITCODE -ne 0) { Write-Host 'ARTIFACT CHECK FAILED' -ForegroundColor Red; exit 1 }

Write-Host '==> [3/3] Smoke tests...' -ForegroundColor Cyan
node (Join-Path $PSScriptRoot 'smoke.mjs')
if ($LASTEXITCODE -ne 0) { Write-Host 'SMOKE TESTS FAILED' -ForegroundColor Red; exit 1 }

# Report what still needs a restart.
$webProc = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -match 'bin\.ts "web"' } |
  Select-Object -First 1
if ($webProc -ne $null) {
  Write-Host ''
  Write-Host 'All checks passed.' -ForegroundColor Green
  Write-Host 'CLIENT changes (Card.tsx / locales.ts / UI): refresh the browser (F5) — no restart needed.' -ForegroundColor Green
  Write-Host 'HOST changes (routes.ts / icons.ts / config.ts): restart the web service to load them.' -ForegroundColor Yellow
} else {
  Write-Host 'Web service is not running.' -ForegroundColor Yellow
}
