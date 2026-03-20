$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $PSScriptRoot
$PidsDir = Join-Path $RepoRoot "pids"
$BridgePidFile = Join-Path $PidsDir "market-bridge.pid"
$DevPidFile = Join-Path $PidsDir "vite-dev.pid"

function Write-Step {
  param([string]$Message)
  Write-Host "==> $Message"
}

function Stop-ProcessFromPidFile {
  param(
    [string]$Name,
    [string]$PidFile
  )

  if (-not (Test-Path $PidFile)) {
    Write-Step "$Name PID file not found, skipping"
    return
  }

  $rawPid = Get-Content $PidFile -Raw
  $pidValue = 0
  if (-not [int]::TryParse($rawPid.Trim(), [ref]$pidValue)) {
    Remove-Item $PidFile -Force
    Write-Step "$Name PID file was invalid, removed"
    return
  }

  $process = Get-Process -Id $pidValue -ErrorAction SilentlyContinue
  if ($null -eq $process) {
    Remove-Item $PidFile -Force
    Write-Step "$Name process $pidValue is already stopped"
    return
  }

  Stop-Process -Id $pidValue -Force
  Remove-Item $PidFile -Force
  Write-Step "Stopped $Name (PID $pidValue)"
}

function Stop-ComposeIfPresent {
  $composeFiles = @(
    "docker-compose.yml",
    "docker-compose.yaml",
    "compose.yml",
    "compose.yaml"
  )

  $hasCompose = $false
  foreach ($candidate in $composeFiles) {
    if (Test-Path (Join-Path $RepoRoot $candidate)) {
      $hasCompose = $true
      break
    }
  }

  if (-not $hasCompose) {
    return
  }

  if ($null -eq (Get-Command docker -ErrorAction SilentlyContinue)) {
    Write-Step "Docker not found, skipping compose shutdown"
    return
  }

  Write-Step "Stopping Docker dependencies"
  Push-Location $RepoRoot
  try {
    & docker compose down
  } finally {
    Pop-Location
  }
}

Stop-ProcessFromPidFile -Name "frontend dev server" -PidFile $DevPidFile
Stop-ProcessFromPidFile -Name "market bridge" -PidFile $BridgePidFile
Stop-ComposeIfPresent

Write-Host ""
Write-Host "App services stopped."
