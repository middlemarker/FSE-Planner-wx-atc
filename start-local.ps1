# Start the local environment service and the planner using install.ps1 settings.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $root
$settings = Join-Path $root 'local.settings.ps1'
if (Test-Path -LiteralPath $settings) { . $settings }
if (-not $env:PORT) { $env:PORT = '8787' }
if (-not $env:HOST) { $env:HOST = '127.0.0.1' }
if (-not $env:ALLOWED_ORIGINS) { $env:ALLOWED_ORIGINS = 'http://localhost:3000,http://127.0.0.1:3000' }
if (-not $env:REACT_APP_ENVIRONMENT_API_URL) {
  $publicHost = if ($env:HOST -in @('0.0.0.0', '::')) { '127.0.0.1' } else { $env:HOST }
  $env:REACT_APP_ENVIRONMENT_API_URL = "http://${publicHost}:$($env:PORT)/api/environment/v1"
}
Write-Host "Environment API: $env:REACT_APP_ENVIRONMENT_API_URL"
$serverCommand = @"
Set-Location -LiteralPath '$root'
if (Test-Path -LiteralPath '.\local.settings.ps1') { . .\local.settings.ps1 }
if (-not `$env:PORT) { `$env:PORT = '$($env:PORT)' }
if (-not `$env:HOST) { `$env:HOST = '$($env:HOST)' }
if (-not `$env:ALLOWED_ORIGINS) { `$env:ALLOWED_ORIGINS = '$($env:ALLOWED_ORIGINS)' }
npm.cmd run environment:server
"@
Start-Process -FilePath powershell.exe -ArgumentList @('-NoExit', '-NoProfile', '-Command', $serverCommand)
npm.cmd start
