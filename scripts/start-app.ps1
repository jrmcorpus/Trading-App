param(
  [switch]$OpenBrowser
)

$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $PSScriptRoot
$LogsDir = Join-Path $RepoRoot "logs"
$PidsDir = Join-Path $RepoRoot "pids"
$EnvLocal = Join-Path $RepoRoot ".env.local"
$EnvExample = Join-Path $RepoRoot ".env.example"
$BridgePidFile = Join-Path $PidsDir "market-bridge.pid"
$DevPidFile = Join-Path $PidsDir "vite-dev.pid"

function Write-Step {
  param([string]$Message)
  Write-Host "==> $Message"
}

function Get-ListeningProcessId {
  param([int]$Port)
  $connection = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($null -eq $connection) {
    return $null
  }
  return [int]$connection.OwningProcess
}

function Wait-ForPort {
  param(
    [int]$Port,
    [int]$TimeoutSeconds = 30
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    if ($null -ne (Get-ListeningProcessId -Port $Port)) {
      return $true
    }
    Start-Sleep -Milliseconds 500
  }
  return $false
}

function Ensure-NodeModules {
  $nodeModulesPath = Join-Path $RepoRoot "node_modules"
  if (Test-Path $nodeModulesPath) {
    return
  }

  Write-Step "Installing npm dependencies"
  Push-Location $RepoRoot
  try {
    & npm.cmd install
  } finally {
    Pop-Location
  }
}

function Ensure-EnvFile {
  if (Test-Path $EnvLocal) {
    return
  }

  if (Test-Path $EnvExample) {
    Write-Step "Creating .env.local from .env.example"
    Copy-Item $EnvExample $EnvLocal
    return
  }

  throw ".env.local is missing and .env.example was not found."
}

function Start-ComposeIfPresent {
  $composeFiles = @(
    "docker-compose.yml",
    "docker-compose.yaml",
    "compose.yml",
    "compose.yaml"
  )

  $composePath = $null
  foreach ($candidate in $composeFiles) {
    $fullPath = Join-Path $RepoRoot $candidate
    if (Test-Path $fullPath) {
      $composePath = $fullPath
      break
    }
  }

  if ($null -eq $composePath) {
    Write-Step "No Docker compose file found, skipping Docker"
    return
  }

  if ($null -eq (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw "Docker compose file found but docker is not installed or not on PATH."
  }

  Write-Step "Starting Docker dependencies"
  Push-Location $RepoRoot
  try {
    & docker compose up -d
  } finally {
    Pop-Location
  }
}

function Start-BackgroundProcess {
  param(
    [string]$Name,
    [int]$Port,
    [string]$FilePath,
    [string[]]$Arguments,
    [string]$PidFile,
    [string]$StdOutFile,
    [string]$StdErrFile,
    [string]$ReadyPattern = ""
  )

  $existingPid = Get-ListeningProcessId -Port $Port
  if ($null -ne $existingPid) {
    Write-Step "$Name already listening on port $Port (PID $existingPid)"
    Set-Content -Path $PidFile -Value $existingPid -Encoding ascii
    return $existingPid
  }

  Write-Step "Starting $Name"
  $process = Start-Process `
    -FilePath $FilePath `
    -ArgumentList $Arguments `
    -WorkingDirectory $RepoRoot `
    -WindowStyle Hidden `
    -RedirectStandardOutput $StdOutFile `
    -RedirectStandardError $StdErrFile `
    -PassThru

  Set-Content -Path $PidFile -Value $process.Id -Encoding ascii

  if (-not (Wait-ForPort -Port $Port -TimeoutSeconds 30)) {
    $runningProcess = Get-Process -Id $process.Id -ErrorAction SilentlyContinue
    if ($null -ne $runningProcess -and $ReadyPattern -and (Test-Path $StdOutFile)) {
      $readyMatch = Select-String -Path $StdOutFile -Pattern $ReadyPattern -Quiet -ErrorAction SilentlyContinue
      if ($readyMatch) {
        return $process.Id
      }
    }
    $stdErr = if (Test-Path $StdErrFile) { Get-Content $StdErrFile -Raw } else { "" }
    $stdOut = if (Test-Path $StdOutFile) { Get-Content $StdOutFile -Raw } else { "" }
    throw "$Name failed to start on port $Port.`nSTDOUT:`n$stdOut`nSTDERR:`n$stdErr"
  }

  return $process.Id
}

New-Item -ItemType Directory -Force -Path $LogsDir | Out-Null
New-Item -ItemType Directory -Force -Path $PidsDir | Out-Null

if ($null -eq (Get-Command node -ErrorAction SilentlyContinue)) {
  throw "Node.js is not installed or not on PATH."
}

if ($null -eq (Get-Command npm.cmd -ErrorAction SilentlyContinue)) {
  throw "npm is not installed or not on PATH."
}

Push-Location $RepoRoot
try {
  Ensure-NodeModules
  Ensure-EnvFile
  Start-ComposeIfPresent

  $bridgePid = Start-BackgroundProcess `
    -Name "market bridge" `
    -Port 8787 `
    -FilePath "node" `
    -Arguments @("mt5_bridge/server.mjs") `
    -PidFile $BridgePidFile `
    -StdOutFile (Join-Path $LogsDir "market-bridge.out.log") `
    -StdErrFile (Join-Path $LogsDir "market-bridge.err.log") `
    -ReadyPattern "listening on http://localhost:8787"

  $devPid = Start-BackgroundProcess `
    -Name "frontend dev server" `
    -Port 3000 `
    -FilePath "npm.cmd" `
    -Arguments @("run", "dev") `
    -PidFile $DevPidFile `
    -StdOutFile (Join-Path $LogsDir "vite-dev.out.log") `
    -StdErrFile (Join-Path $LogsDir "vite-dev.err.log") `
    -ReadyPattern "http://(127\.0\.0\.1|localhost):3000"

  if ($OpenBrowser) {
    Start-Process "http://127.0.0.1:3000/"
  }

  Write-Host ""
  Write-Host "App is ready."
  Write-Host "Frontend: http://127.0.0.1:3000/"
  Write-Host "Bridge:   http://127.0.0.1:8787/health"
  Write-Host "Bridge PID: $bridgePid"
  Write-Host "Dev PID:    $devPid"
  Write-Host "Logs: $LogsDir"
  Write-Host ""
  Write-Host "To stop everything later:"
  Write-Host "npm run app:down"
} finally {
  Pop-Location
}
