$RepoRoot = $PSScriptRoot

# --- pnpm ---
if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
    $answer = Read-Host "pnpm not found. Install it globally via npm? [y/N]"
    if ($answer -match '^[Yy]') {
        npm install -g pnpm
        if ($LASTEXITCODE -ne 0) {
            Write-Error "Failed to install pnpm."
            exit 1
        }
    } else {
        Write-Error "pnpm is required. Aborting."
        exit 1
    }
}

# --- dependencies ---
if (-not (Test-Path (Join-Path $RepoRoot "node_modules"))) {
    Write-Host "Installing dependencies..."
    Push-Location $RepoRoot
    try {
        pnpm install
        if ($LASTEXITCODE -ne 0) {
            Write-Error "pnpm install failed."
            exit 1
        }
    } finally {
        Pop-Location
    }
}

# --- PATH ---
$BinDir = (Resolve-Path (Join-Path $RepoRoot "bin")).Path
$CurrentPath = [Environment]::GetEnvironmentVariable("PATH", "User")
$Parts = $CurrentPath -split ";"

if ($Parts -contains $BinDir) {
    Write-Host "Already in PATH: $BinDir"
    exit 0
}

$NewPath = ($CurrentPath.TrimEnd(";") + ";" + $BinDir)
[Environment]::SetEnvironmentVariable("PATH", $NewPath, "User")
Write-Host "Added to PATH: $BinDir"
Write-Host "Restart your terminal for the change to take effect."