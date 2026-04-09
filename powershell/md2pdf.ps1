<#
.SYNOPSIS
  Render Mermaid diagrams and convert Markdown to PDF via npx md-to-pdf.
  Uses @mermaid-js/mermaid-cli (mmdc) directly on Markdown: it extracts ```mermaid```
  fences, writes SVGs, and rewrites the Markdown to reference those SVGs.

.DESCRIPTION
  Pipeline:
    1) mmdc -i <src.md> -o <temp/converted.md> (SVGs land next to converted.md)
    2) md-to-pdf converted.md (basedir=temp)

.PARAMETER Stylesheet
  Stylesheet passed to md-to-pdf (--stylesheet). Defaults to css/default.css.
.PARAMETER OutputDir
  Output directory for PDFs (default: alongside each input file).
.PARAMETER TempRoot
  Root directory for temp work dirs (default: system temp).
.PARAMETER TempInOutput
  Place temp dir inside the output directory (or source dir if -o is absent).
.PARAMETER RunDoctoc
  Run `doctoc` to inject a Table of Contents (uses a temp copy; source file untouched).
.PARAMETER KeepTemp
  Keep temp working directory (prints its path).
.PARAMETER Files
  Markdown files to convert.
#>
param (
    [Alias("s")]
    [string]$Stylesheet,

    [Alias("o")]
    [string]$OutputDir,

    [Alias("r")]
    [string]$TempRoot,

    [Alias("p")]
    [switch]$TempInOutput,

    [Alias("t")]
    [switch]$RunDoctoc,

    [Alias("k")]
    [switch]$KeepTemp,

    [Parameter(Position = 0, ValueFromRemainingArguments = $true, Mandatory = $true)]
    [string[]]$Files
)

# npm package selectors (override via env: DOCTOC_PKG, MERMAID_CLI_PKG, MD_TO_PDF_PKG)
$DOCTOC_PKG = if ($env:DOCTOC_PKG) { $env:DOCTOC_PKG } else { "doctoc@2.3.0" }
$MERMAID_CLI_PKG = if ($env:MERMAID_CLI_PKG) { $env:MERMAID_CLI_PKG } else { "@mermaid-js/mermaid-cli@11.12.0" }
$MD_TO_PDF_PKG = if ($env:MD_TO_PDF_PKG) { $env:MD_TO_PDF_PKG } else { "md-to-pdf@5.2.5" }

# Set default stylesheet
if (-not $Stylesheet) {
    $scriptDir = Split-Path -Parent $PSCommandPath
    $defaultStylesheet = Join-Path $scriptDir "..\css\default.css"
    if (Test-Path $defaultStylesheet) {
        $Stylesheet = (Resolve-Path $defaultStylesheet).Path
    }
}

if ($Stylesheet -and -not (Test-Path $Stylesheet)) {
    Write-Error "Stylesheet not found: $Stylesheet"
    exit 1
}

function Convert-MarkdownFile {
    param (
        [string]$src
    )

    if (-not (Test-Path $src)) {
        Write-Warning "File not found: $src"
        return
    }

    $absSrc = (Resolve-Path $src).Path
    $baseName = Split-Path $src -Leaf
    $stem = [System.IO.Path]::GetFileNameWithoutExtension($baseName)
    $srcDir = Split-Path $absSrc -Parent

    $workdir = $null
    if ($TempInOutput) {
        $baseOut = if ($OutputDir) { $OutputDir } else { $srcDir }
        if (-not (Test-Path $baseOut)) { New-Item -ItemType Directory -Path $baseOut -Force | Out-Null }
        $workdir = Join-Path $baseOut ("{0}_{1}" -f $stem, [System.IO.Path]::GetRandomFileName())
        New-Item -ItemType Directory -Path $workdir -Force | Out-Null
    }
    elseif ($TempRoot) {
        if (-not (Test-Path $TempRoot)) { New-Item -ItemType Directory -Path $TempRoot -Force | Out-Null }
        $workdir = Join-Path $TempRoot ("{0}_{1}" -f $stem, [System.IO.Path]::GetRandomFileName())
        New-Item -ItemType Directory -Path $workdir -Force | Out-Null
    }
    else {
        $tempDir = [System.IO.Path]::GetTempPath()
        $workdir = Join-Path $tempDir ("{0}_{1}" -f $stem, [System.IO.Path]::GetRandomFileName())
        New-Item -ItemType Directory -Path $workdir -Force | Out-Null
    }

    $convertedMd = Join-Path $workdir ("{0}_converted.md" -f $stem)
    $inputMd = $absSrc

    if ($RunDoctoc) {
        $inputMd = Join-Path $workdir $baseName
        Copy-Item $absSrc $inputMd
        npx $DOCTOC_PKG $inputMd
    }

    # Extract title from first # heading
    $docTitle = $stem
    $firstHeading = Get-Content $inputMd | Where-Object { $_ -match "^\s*#+\s*(.*)" } | Select-Object -First 1
    if ($firstHeading -match "^\s*#+\s*(.*)") {
        $docTitle = $Matches[1].Trim()
    }

    # Mermaid CLI handles extraction + SVG generation in one pass.
    npx $MERMAID_CLI_PKG -i $inputMd -o $convertedMd

    $targetDir = if ($OutputDir) { $OutputDir } else { $srcDir }
    if (-not (Test-Path $targetDir)) { New-Item -ItemType Directory -Path $targetDir -Force | Out-Null }

    # md-to-pdf writes next to the input markdown by default.
    $tempPdf = [System.IO.Path]::ChangeExtension($convertedMd, ".pdf")
    $outPdf = Join-Path $targetDir ("{0}.pdf" -f $stem)

    $cmdArgs = @($convertedMd, "--basedir", $workdir, "--document-title", $docTitle)
    if ($Stylesheet) {
        $cmdArgs += "--stylesheet", $Stylesheet
    }

    npx $MD_TO_PDF_PKG @cmdArgs

    if (Test-Path $tempPdf) {
        Copy-Item $tempPdf $outPdf -Force
    }
    else {
        Write-Error "PDF generation failed. Expected: $tempPdf"
    }

    if ($KeepTemp) {
        Write-Host "Temp kept at: $workdir"
    }
    else {
        Remove-Item -Recurse -Force $workdir
    }

    Write-Host "Created: $outPdf"
}

foreach ($file in $Files) {
    Convert-MarkdownFile $file
}
