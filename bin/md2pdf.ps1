#!/usr/bin/env pwsh

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$InvocationDirectory = (Get-Location).Path
$CliArgs = $args

$pathValueOptions = @{
    "-s" = $true
    "--stylesheet" = $true
    "-o" = $true
    "--output-dir" = $true
    "-r" = $true
    "--temp-root" = $true
}

# Options that take a value but whose value must NOT be resolved as a path.
$passthroughValueOptions = @("--css-var")

function Resolve-ArgumentPath {
    param([string]$Value)

    if ([string]::IsNullOrWhiteSpace($Value)) {
        return $Value
    }

    if ([System.IO.Path]::IsPathRooted($Value)) {
        return [System.IO.Path]::GetFullPath($Value)
    }

    return [System.IO.Path]::GetFullPath((Join-Path $InvocationDirectory $Value))
}

$resolvedArgs = New-Object System.Collections.Generic.List[string]
$treatRemainingAsFiles = $false

for ($index = 0; $index -lt $CliArgs.Count; $index++) {
    $arg = $CliArgs[$index]

    if ($treatRemainingAsFiles) {
        $resolvedArgs.Add((Resolve-ArgumentPath $arg))
        continue
    }

    if ($arg -eq "--") {
        $treatRemainingAsFiles = $true
        continue
    }

    $inlinePathOption = $false
    foreach ($option in $pathValueOptions.Keys) {
        $prefix = "$option="
        if ($arg.StartsWith($prefix)) {
            $value = $arg.Substring($prefix.Length)
            $resolvedArgs.Add("$option=$(Resolve-ArgumentPath $value)")
            $inlinePathOption = $true
            break
        }
    }

    if ($inlinePathOption) {
        continue
    }

    if ($pathValueOptions.ContainsKey($arg)) {
        $resolvedArgs.Add($arg)
        if ($index + 1 -ge $CliArgs.Count) {
            Write-Error "Option $arg requires a path argument."
            exit 1
        }

        $index++
        $resolvedArgs.Add((Resolve-ArgumentPath $CliArgs[$index]))
        continue
    }

    if ($passthroughValueOptions -contains $arg) {
        $resolvedArgs.Add($arg)
        if ($index + 1 -ge $CliArgs.Count) {
            Write-Error "Option $arg requires an argument."
            exit 1
        }

        $index++
        $resolvedArgs.Add($CliArgs[$index])
        continue
    }

    if ($arg.StartsWith("-")) {
        $resolvedArgs.Add($arg)
        continue
    }

    $resolvedArgs.Add((Resolve-ArgumentPath $arg))
}

Push-Location $RepoRoot
try {
    & pnpm md2pdf -- @resolvedArgs
    exit $LASTEXITCODE
}
finally {
    Pop-Location
}
