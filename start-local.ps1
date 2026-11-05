# Start the environment API, then the planner.
# Both programs read PORT and HOST. Those values are applied in separate
# processes: the API keeps its own bind address, and the planner always uses
# port 3000 with Create React App's default host so the browser opens
# http://localhost:3000. Sharing one PORT made the planner probe the API port
# while that process was still starting and report the port as already in use.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $root

$settings = Join-Path $root 'local.settings.ps1'
if (Test-Path -LiteralPath $settings) { . $settings }

$apiPort = if ($env:PORT) { $env:PORT } else { '8787' }
$apiHost = if ($env:HOST) { $env:HOST } else { '127.0.0.1' }
$plannerPort = '3000'
$plannerUrl = "http://localhost:$plannerPort"
if (-not $env:ALLOWED_ORIGINS) {
  $env:ALLOWED_ORIGINS = "http://localhost:${plannerPort},http://127.0.0.1:${plannerPort}"
}
if (-not $env:REACT_APP_ENVIRONMENT_API_URL) {
  $publicHost = if ($apiHost -in @('0.0.0.0', '::')) { '127.0.0.1' } else { $apiHost }
  $env:REACT_APP_ENVIRONMENT_API_URL = "http://${publicHost}:$apiPort/api/environment/v1"
}
$allowedOrigins = $env:ALLOWED_ORIGINS
$apiUrl = $env:REACT_APP_ENVIRONMENT_API_URL

Write-Host "Planner: $plannerUrl"
Write-Host "Environment API: $apiUrl"

$quotedRoot = $root.Replace("'", "''")
$quotedOrigins = $allowedOrigins.Replace("'", "''")
$serverCommand = @"
`$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath '$quotedRoot'
`$env:PORT = '$apiPort'
`$env:HOST = '$apiHost'
`$env:ALLOWED_ORIGINS = '$quotedOrigins'
npm.cmd run environment:server
"@
Start-Process -FilePath powershell.exe -ArgumentList @('-NoExit', '-NoProfile', '-Command', $serverCommand)

$listenHost = if ($apiHost -in @('0.0.0.0', '::')) { '127.0.0.1' } else { $apiHost }
$deadline = (Get-Date).AddSeconds(20)
$apiListening = $false
while ((Get-Date) -lt $deadline) {
  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $wait = $client.BeginConnect($listenHost, [int]$apiPort, $null, $null)
    if ($wait.AsyncWaitHandle.WaitOne(400) -and $client.Connected) {
      $apiListening = $true
      break
    }
  } catch {
  } finally {
    $client.Dispose()
  }
  Start-Sleep -Milliseconds 200
}
if ($apiListening) {
  Write-Host "Environment API is listening on ${listenHost}:$apiPort"
} else {
  Write-Host "Environment API is not listening on ${listenHost}:$apiPort yet. The planner will still start; check the API window."
}

# Create React App uses PORT for the dev server and, when HOST is unset,
# binds all interfaces and opens http://localhost:3000. Drop the API values
# inherited from this session or local.settings.ps1 before starting it.
$env:PORT = $plannerPort
Remove-Item Env:\HOST -ErrorAction SilentlyContinue
Remove-Item Env:\BROWSER -ErrorAction SilentlyContinue
$env:REACT_APP_ENVIRONMENT_API_URL = $apiUrl
npm.cmd start
