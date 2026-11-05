# Interactive setup for FSE Planner and the local weather/VATSIM service.
# Run: powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1
# Check only: powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1 -CheckOnly
param(
  [switch]$CheckOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$MinimumNode = [version]'22.15.0'

function Write-Step([string]$Message) { Write-Host ""; Write-Host "== $Message" -ForegroundColor Cyan }
function Write-Ok([string]$Message) { Write-Host "  ok   $Message" -ForegroundColor Green }
function Write-Warn([string]$Message) { Write-Host "  warn $Message" -ForegroundColor Yellow }
function Write-Bad([string]$Message) { Write-Host "  fail $Message" -ForegroundColor Red }

function Read-Yes([string]$Prompt, [bool]$DefaultYes = $true) {
  $hint = if ($DefaultYes) { 'Y/n' } else { 'y/N' }
  while ($true) {
    $answer = Read-Host "$Prompt [$hint]"
    if ([string]::IsNullOrWhiteSpace($answer)) { return $DefaultYes }
    switch ($answer.Trim().ToLowerInvariant()) {
      { $_ -in @('y', 'yes') } { return $true }
      { $_ -in @('n', 'no') } { return $false }
      default { Write-Host 'Answer y or n.' }
    }
  }
}

function Read-Value([string]$Prompt, [string]$Default) {
  $answer = Read-Host "$Prompt [$Default]"
  if ([string]::IsNullOrWhiteSpace($answer)) { return $Default }
  return $answer.Trim()
}

function Update-SessionPath {
  $machine = [Environment]::GetEnvironmentVariable('Path', 'Machine')
  $user = [Environment]::GetEnvironmentVariable('Path', 'User')
  if ($machine -or $user) { $env:Path = "$machine;$user" }
}

function Get-NodeVersion {
  $node = Get-Command node -ErrorAction SilentlyContinue
  if (-not $node) { return $null }
  $raw = (& node -v 2>$null)
  if ($raw -match 'v?(\d+)\.(\d+)\.(\d+)') {
    return [pscustomobject]@{
      Raw = $raw.Trim()
      Version = [version]::new([int]$Matches[1], [int]$Matches[2], [int]$Matches[3])
      Path = $node.Source
    }
  }
  return [pscustomobject]@{ Raw = "$raw"; Version = $null; Path = $node.Source }
}

function Test-SystemCa {
  $node = Get-Command node -ErrorAction SilentlyContinue
  if (-not $node) { return $false }
  & node --use-system-ca -e "process.exit(0)" 1>$null 2>$null
  return $LASTEXITCODE -eq 0
}

function Test-PortOpen([int]$Port) {
  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $client.Connect('127.0.0.1', $Port)
    return $true
  } catch {
    return $false
  } finally {
    $client.Dispose()
  }
}

function Install-WithWinget([string]$Id, [string]$Label) {
  $winget = Get-Command winget -ErrorAction SilentlyContinue
  if (-not $winget) {
    Write-Bad "winget is not available, so $Label cannot be installed from here."
    Write-Host "  Install $Label yourself, open a new terminal, and run this script again."
    return $false
  }
  if (-not (Read-Yes "Install $Label now? ($Id)")) { return $false }
  Write-Host "  Running winget. Windows may ask for permission."
  & winget install --id $Id --exact --accept-package-agreements --accept-source-agreements
  if ($LASTEXITCODE -ne 0) {
    Write-Bad "winget did not install $Label (exit $LASTEXITCODE)."
    return $false
  }
  Update-SessionPath
  return $true
}

function Get-PrerequisiteReport {
  $node = Get-NodeVersion
  $npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
  if (-not $npm) { $npm = Get-Command npm -ErrorAction SilentlyContinue }
  $git = Get-Command git -ErrorAction SilentlyContinue
  $winget = Get-Command winget -ErrorAction SilentlyContinue
  $nodeOk = $false
  $nodeDetail = 'not installed'
  if ($node) {
    $nodeDetail = "$($node.Raw) at $($node.Path)"
    $nodeOk = ($null -ne $node.Version -and $node.Version -ge $MinimumNode -and (Test-SystemCa))
    if (-not $nodeOk) { $nodeDetail = "$($node.Raw) is below $MinimumNode or does not support --use-system-ca" }
  }
  return [pscustomobject]@{
    NodeOk = $nodeOk
    NodeDetail = $nodeDetail
    NpmOk = [bool]$npm
    NpmPath = $(if ($npm) { $npm.Source } else { '' })
    GitOk = [bool]$git
    GitPath = $(if ($git) { $git.Source } else { '' })
    WingetOk = [bool]$winget
  }
}

function Show-Prerequisites($Report) {
  Write-Step 'Prerequisites'
  if ($Report.NodeOk) { Write-Ok "Node.js $($Report.NodeDetail)" } else { Write-Bad "Node.js $($Report.NodeDetail). Need $MinimumNode or newer." }
  if ($Report.NpmOk) { Write-Ok "npm $($Report.NpmPath)" } else { Write-Bad 'npm was not found. It is installed together with Node.js.' }
  if ($Report.GitOk) { Write-Ok "git $($Report.GitPath)" } else { Write-Warn 'git was not found. It is required only when cloning into a new folder.' }
  if ($Report.WingetOk) { Write-Ok 'winget is available for missing tools' } else { Write-Warn 'winget was not found. Missing tools must be installed by hand.' }
}

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$report = Get-PrerequisiteReport
Show-Prerequisites $report
if ($CheckOnly) {
  if ($report.NodeOk -and $report.NpmOk) { exit 0 }
  exit 1
}

Write-Step 'Install missing tools'
if (-not $report.NodeOk) {
  if (Install-WithWinget 'OpenJS.NodeJS.LTS' 'Node.js LTS') {
    $report = Get-PrerequisiteReport
    Show-Prerequisites $report
  }
}
if (-not $report.NodeOk -or -not $report.NpmOk) {
  Write-Bad 'Node.js and npm are still not ready in this terminal.'
  Write-Host '  If the installer just finished, close this window, open a new one, and run the script again.'
  exit 1
}
if (-not $report.GitOk) {
  $installGit = Read-Yes 'git is missing. Install it? It is used when the chosen folder does not already contain the project.' $false
  if ($installGit) {
    if (Install-WithWinget 'Git.Git' 'Git') { $report = Get-PrerequisiteReport }
  }
}

Write-Step 'Install location'
Write-Host 'Dependencies are installed inside the chosen folder. Nothing is copied to Program Files.'
$defaultDir = $scriptRoot
if (-not (Test-Path -LiteralPath (Join-Path $scriptRoot 'package.json'))) {
  $defaultDir = Join-Path $env:USERPROFILE 'FSE-Planner'
}
$installDir = $null
while (-not $installDir) {
  $candidate = Read-Value 'Folder' $defaultDir
  try { $candidate = [System.IO.Path]::GetFullPath($candidate) } catch { Write-Bad 'That path is not valid.'; continue }
  Write-Host "  $candidate"
  if (-not (Read-Yes 'Use this folder?')) { continue }
  $exists = Test-Path -LiteralPath $candidate
  $hasProject = $exists -and (Test-Path -LiteralPath (Join-Path $candidate 'package.json')) -and (Test-Path -LiteralPath (Join-Path $candidate 'server\index.mjs'))
  if ($exists -and -not $hasProject) {
    $items = @(Get-ChildItem -Force -LiteralPath $candidate -ErrorAction SilentlyContinue)
    if ($items.Count -gt 0) {
      Write-Bad 'That folder is not empty and is not this project. Choose another folder.'
      continue
    }
  }
  $installDir = $candidate
  $installDirHasProject = $hasProject
}

if (-not $installDirHasProject) {
  Write-Step 'Copy the project'
  if (-not $report.GitOk) {
    Write-Bad 'git is required to clone the project into an empty folder.'
    exit 1
  }
  $origin = 'https://github.com/piero-la-lune/FSE-Planner.git'
  $branch = 'master'
  if (Test-Path -LiteralPath (Join-Path $scriptRoot '.git')) {
    $detectedOrigin = & git -C $scriptRoot remote get-url origin 2>$null
    $detectedBranch = & git -C $scriptRoot rev-parse --abbrev-ref HEAD 2>$null
    if ($detectedOrigin) { $origin = $detectedOrigin.Trim() }
    if ($detectedBranch -and $detectedBranch -ne 'HEAD') { $branch = $detectedBranch.Trim() }
  }
  $origin = Read-Value 'Git address' $origin
  $branch = Read-Value 'Branch' $branch
  Write-Host "Clone $origin ($branch) into $installDir"
  if (-not (Read-Yes 'Clone now?')) { exit 1 }
  $parent = Split-Path -Parent $installDir
  if ($parent -and -not (Test-Path -LiteralPath $parent)) { New-Item -ItemType Directory -Path $parent | Out-Null }
  & git clone --branch $branch --single-branch $origin $installDir
  if ($LASTEXITCODE -ne 0) { Write-Bad 'git clone failed.'; exit 1 }
}

Set-Location -LiteralPath $installDir
Write-Ok "Project folder: $installDir"

Write-Step 'JavaScript dependencies'
if (Test-Path -LiteralPath (Join-Path $installDir 'package-lock.json')) {
  Write-Host 'npm ci will install the locked dependency set. An existing node_modules folder is replaced.'
  $installCommand = @('ci', '--legacy-peer-deps')
} else {
  Write-Host 'No lockfile was found. npm install will choose current matching versions.'
  $installCommand = @('install', '--legacy-peer-deps')
}
if (-not (Read-Yes 'Install JavaScript dependencies now?')) { Write-Bad 'Stopped before installing dependencies.'; exit 1 }
& npm.cmd @installCommand
if ($LASTEXITCODE -ne 0) { Write-Bad 'npm did not finish successfully.'; exit 1 }
if (-not (Test-Path -LiteralPath (Join-Path $installDir 'node_modules\react'))) {
  Write-Bad 'node_modules\react is missing after install.'
  exit 1
}
& node --check (Join-Path $installDir 'server\index.mjs')
if ($LASTEXITCODE -ne 0) { Write-Bad 'server\index.mjs did not pass a syntax check.'; exit 1 }
Write-Ok 'Dependencies are installed and the environment service parses.'

Write-Step 'Local service settings'
$defaultPort = '8787'
$defaultHost = '127.0.0.1'
$defaultOrigin = 'http://localhost:3000'
$settingsPath = Join-Path $installDir 'local.settings.ps1'
$envPath = Join-Path $installDir '.env.development.local'
$skipSettings = $false
if (Test-Path -LiteralPath $settingsPath) {
  Write-Warn "Found existing $settingsPath"
  if (-not (Read-Yes 'Replace those local settings?' $false)) {
    Write-Ok 'Existing local settings were left unchanged.'
    $skipSettings = $true
  }
}
if (-not $skipSettings) {
  $portText = Read-Value 'Environment API port' $defaultPort
  $port = 0
  if (-not [int]::TryParse($portText, [ref]$port) -or $port -lt 1 -or $port -gt 65535) {
    Write-Bad 'The port must be a number from 1 to 65535.'
    exit 1
  }
  if (Test-PortOpen $port) {
    Write-Warn "Something on this computer is already accepting connections on port $port."
    if (-not (Read-Yes 'Use that port anyway?' $false)) { exit 1 }
  }
  $hostName = Read-Value 'Bind address (127.0.0.1 keeps it on this computer)' $defaultHost
  $origin = Read-Value 'Browser address' $defaultOrigin
  $publicHost = if ($hostName -in @('0.0.0.0', '::')) { '127.0.0.1' } else { $hostName }
  $apiUrl = "http://${publicHost}:$port/api/environment/v1"
  $origins = "$origin,http://127.0.0.1:3000" 
  if ($origin -eq 'http://127.0.0.1:3000') { $origins = 'http://127.0.0.1:3000,http://localhost:3000' }
  Write-Host ''
  Write-Host "  Folder:           $installDir"
  Write-Host "  Environment API:  $apiUrl"
  Write-Host "  Bind:             ${hostName}:$port"
  Write-Host "  Allowed browser:  $origins"
  if (-not (Read-Yes 'Write this setup?')) { exit 1 }
  @(
    "# Generated by install.ps1. This file is local and is not committed."
    "`$env:PORT = '$port'"
    "`$env:HOST = '$hostName'"
    "`$env:ALLOWED_ORIGINS = '$origins'"
    "`$env:REACT_APP_ENVIRONMENT_API_URL = '$apiUrl'"
  ) | Set-Content -LiteralPath $settingsPath -Encoding utf8
  $envLines = @()
  if (Test-Path -LiteralPath $envPath) { $envLines = @(Get-Content -LiteralPath $envPath | Where-Object { $_ -notmatch '^\s*REACT_APP_ENVIRONMENT_API_URL=' }) }
  $envLines += "REACT_APP_ENVIRONMENT_API_URL=$apiUrl"
  $envLines | Set-Content -LiteralPath $envPath -Encoding utf8
  Write-Ok 'Saved local.settings.ps1 and .env.development.local'
}

Write-Step 'Setup complete'
Write-Ok "Node.js $($report.NodeDetail)"
Write-Ok 'JavaScript dependencies are present'
Write-Host ''
Write-Host 'Start both processes with:'
Write-Host '  powershell -NoProfile -ExecutionPolicy Bypass -File .\start-local.ps1'
Write-Host ''
if (Read-Yes 'Start the environment service and the planner now?' $false) {
  & (Join-Path $installDir 'start-local.ps1')
}
