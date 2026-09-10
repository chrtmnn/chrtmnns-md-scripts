#!/usr/bin/env pwsh

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$InvocationDirectory = (Get-Location).Path

# PowerShell does not unroll a parenthesized array expression such as
# `md2pdf (Get-ChildItem *.md).Name` into separate positional arguments: the whole
# array arrives as a single element of $args. Flatten it so the parsing loop below
# always sees plain strings.
function ConvertTo-FlatArgumentList {
    param([object[]]$Arguments)

    $flat = New-Object System.Collections.Generic.List[string]
    foreach ($item in $Arguments) {
        if ($null -eq $item) {
            continue
        }

        if ($item -is [string]) {
            $flat.Add($item)
            continue
        }

        if ($item -is [System.Collections.IEnumerable]) {
            foreach ($nested in (ConvertTo-FlatArgumentList -Arguments @($item))) {
                $flat.Add($nested)
            }
            continue
        }

        $flat.Add([string]$item)
    }

    return ,$flat.ToArray()
}

$CliArgs = ConvertTo-FlatArgumentList -Arguments $args

# Ordinal (case-sensitive) sets: PowerShell's @{} hashtables and the -contains
# operator both compare case-insensitively, which would make the valueless flag
# -R/--recursive collide with the path option -r/--temp-root and swallow the
# following argument as a path.
function New-OrdinalSet {
    param([string[]]$Values)

    $set = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::Ordinal)
    foreach ($value in $Values) {
        [void]$set.Add($value)
    }

    return ,$set
}

# Options that take a value which must be resolved against the caller's CWD.
$pathValueOptions = New-OrdinalSet @("-o", "--output-dir", "-r", "--temp-root")

# Options that take a value but whose value must NOT be resolved as a path.
# --merge takes an output PDF base name, not a path. -s/--stylesheet may be a
# bare name from ~/.md2pdf, so md2pdf resolves it itself against the caller's
# directory, which is passed in MD2PDF_INVOCATION_DIR below.
$passthroughValueOptions = New-OrdinalSet @("-s", "--stylesheet", "--css-var", "--merge")

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

    $inlineOption = $false
    foreach ($option in $pathValueOptions) {
        $prefix = "$option="
        if ($arg.StartsWith($prefix, [System.StringComparison]::Ordinal)) {
            $value = $arg.Substring($prefix.Length)
            $resolvedArgs.Add("$option=$(Resolve-ArgumentPath $value)")
            $inlineOption = $true
            break
        }
    }

    if ($inlineOption) {
        continue
    }

    # Inline form of a passthrough option, e.g. --merge=handbook. Forwarded
    # verbatim so the value is never treated as a path.
    foreach ($option in $passthroughValueOptions) {
        if ($arg.StartsWith("$option=", [System.StringComparison]::Ordinal)) {
            $resolvedArgs.Add($arg)
            $inlineOption = $true
            break
        }
    }

    if ($inlineOption) {
        continue
    }

    if ($pathValueOptions.Contains($arg)) {
        $resolvedArgs.Add($arg)
        if ($index + 1 -ge $CliArgs.Count) {
            Write-Error "Option $arg requires a path argument."
            exit 1
        }

        $index++
        $resolvedArgs.Add((Resolve-ArgumentPath $CliArgs[$index]))
        continue
    }

    if ($passthroughValueOptions.Contains($arg)) {
        $resolvedArgs.Add($arg)
        if ($index + 1 -ge $CliArgs.Count) {
            Write-Error "Option $arg requires an argument."
            exit 1
        }

        $index++
        $resolvedArgs.Add($CliArgs[$index])
        continue
    }

    if ($arg.StartsWith("-", [System.StringComparison]::Ordinal)) {
        $resolvedArgs.Add($arg)
        continue
    }

    $resolvedArgs.Add((Resolve-ArgumentPath $arg))
}

# md2pdf runs from the repo root, so it is told where relative -s values and
# stylesheet names are resolved. The previous value is restored because a
# script run from an interactive PowerShell shares that session's environment,
# and a stale value would redirect later direct `pnpm md2pdf` runs.
$previousInvocationDirectory = $env:MD2PDF_INVOCATION_DIR
$env:MD2PDF_INVOCATION_DIR = $InvocationDirectory

Push-Location $RepoRoot
try {
    & pnpm --silent md2pdf -- @resolvedArgs
    exit $LASTEXITCODE
}
finally {
    Pop-Location
    $env:MD2PDF_INVOCATION_DIR = $previousInvocationDirectory
}
