# Verify the built plugin artifacts match the dsh web loader contract.
# Exit 1 with a message when something is wrong.
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$pkg = Join-Path $root 'packages\dsh-desktop'

$name = (Get-Content (Join-Path $pkg 'package.json') -Raw | ConvertFrom-Json).name
$client = Join-Path $pkg 'lib\client.js'
$index = Join-Path $pkg 'lib\index.mjs'

$fail = 0
function Check($label, $ok, $detail = '') {
  if ($ok) { Write-Output "PASS  $label" } else { Write-Output "FAIL  $label  $detail"; $script:fail = 1 }
}

Check 'client.js exists' (Test-Path $client)
if (Test-Path $client) {
  $head = Get-Content $client -TotalCount 3 | Out-String
  Check 'client.js registers via __ModuleLoader__' ($head -match 'window\.__ModuleLoader__\.load\(\{')
  Check 'client.js id matches package name' ($head -match [regex]::Escape($name))
  Check 'client.js has no bare ESM imports' (-not (Select-String -Path $client -Pattern '^import ' -Quiet))
}
Check 'host index.mjs exists' (Test-Path $index)

$exports = (Get-Content (Join-Path $pkg 'package.json') -Raw | ConvertFrom-Json).exports
Check 'exports "." points at lib/index.mjs' (($exports | ConvertTo-Json -Depth 6) -match './lib/index.mjs')
Check 'exports "./client" points at lib/client.js' (($exports | ConvertTo-Json -Depth 6) -match './lib/client.js')

if ($fail -eq 0) { Write-Output "`nArtifact contract OK — safe to (re)start the web profile." } else { Write-Output "`nArtifact contract BROKEN — rebuild before restarting."; exit 1 }
