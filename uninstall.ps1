$BinDir = (Resolve-Path (Join-Path $PSScriptRoot "bin")).Path
$CurrentPath = [Environment]::GetEnvironmentVariable("PATH", "User")
$Parts = $CurrentPath -split ";" | Where-Object { $_ -ne $BinDir }

if ($Parts.Count -eq ($CurrentPath -split ";").Count) {
    Write-Host "Not found in PATH: $BinDir"
    exit 0
}

[Environment]::SetEnvironmentVariable("PATH", ($Parts -join ";"), "User")
Write-Host "Removed from PATH: $BinDir"
Write-Host "Restart your terminal for the change to take effect."