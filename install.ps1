$BinDir = (Resolve-Path (Join-Path $PSScriptRoot "bin")).Path
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