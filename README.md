# chrtmnn's md scripts

Collection of (hopefully) useful Markdown scripts.

* [github.com/chrtmnn/chrtmnns-md-scripts](https://github.com/chrtmnn/chrtmnns-md-scripts)

## Table of Contents

<!-- START doctoc generated TOC please keep comment here to allow auto update -->
<!-- DON'T EDIT THIS SECTION, INSTEAD RE-RUN doctoc TO UPDATE -->

- [Prerequisites](#prerequisites)
- [Markdown to PDF `bash/md2pdf.sh`](#markdown-to-pdf-bashmd2pdfsh)
- [Markdown to PDF `powershell/md2pdf.ps1`](#markdown-to-pdf-powershellmd2pdfps1)
- [Markdown to PDF `node/md2pdf.js`](#markdown-to-pdf-nodemd2pdfjs)

<!-- END doctoc generated TOC please keep comment here to allow auto update -->

## Prerequisites

- Node.js (incl. npm/npx) available in PATH.
- Internet access for the first run so `npx` can fetch `doctoc`, `@mermaid-js/mermaid-cli` and `md-to-pdf` (or install
  them globally ahead of time with `npm install -g doctoc @mermaid-js/mermaid-cli md-to-pdf`).

## Markdown to PDF `bash/md2pdf.sh`

**Usage**

`md2pdf.sh [-s pdf.css] [-o output_dir] [-r temp_root | -p] [-t] [-k] file1.md [file2.md ...]`

**Options**

| option      | description                                                                   |
|-------------|-------------------------------------------------------------------------------|
| `-s <file>` | Stylesheet passed to md-to-pdf (--stylesheet). Defaults to `css/default.css`. |
| `-o <dir>`  | Output directory for PDFs (default: alongside each input file).               |
| `-r <dir>`  | Root directory for temp work dirs (default: system temp).                     |
| `-p`        | Place temp dir inside the output directory (or source dir if -o is absent).   |
| `-t`        | Run `doctoc` to inject a Table of Contents (temp copy only).                  |
| `-k`        | Keep temp working directory (prints its path).                                |
| `-h`        | Show help.                                                                    |

**Notes**

- The PDF document title is taken from the first Markdown heading; falls back to the filename stem.

**Default package versions**

Override npm package versions used by `npx` via env vars:

- `DOCTOC_PKG` (default [`doctoc@2.3.0`](https://www.npmjs.com/package/doctoc/v/2.3.0))
- `MERMAID_CLI_PKG` (default [
  `@mermaid-js/mermaid-cli@11.12.0`](https://www.npmjs.com/package/@mermaid-js/mermaid-cli/v/11.12.0))
- `MD_TO_PDF_PKG` (default [`md-to-pdf@5.2.5`](https://www.npmjs.com/package/md-to-pdf/v/5.2.5))

**Example**

  ```bash
  ./bash/md2pdf.sh -t README.md
  ```

## Markdown to PDF `powershell/md2pdf.ps1`

**Usage**

`powershell/md2pdf.ps1 [-Stylesheet pdf.css] [-OutputDir output_dir] [-TempRoot temp_root | -TempInOutput] [-RunDoctoc] [-KeepTemp] file1.md [file2.md ...]`

**Options**

| option             | description                                                                   |
|--------------------|-------------------------------------------------------------------------------|
| `-Stylesheet <file>` | Stylesheet passed to md-to-pdf (--stylesheet). Defaults to `css/default.css`. |
| `-OutputDir <dir>`  | Output directory for PDFs (default: alongside each input file).               |
| `-TempRoot <dir>`   | Root directory for temp work dirs (default: system temp).                     |
| `-TempInOutput`    | Place temp dir inside the output directory (or source dir if -o is absent).   |
| `-RunDoctoc`       | Run `doctoc` to inject a Table of Contents (temp copy only).                  |
| `-KeepTemp`        | Keep temp working directory (prints its path).                                |

**Notes**

- Identical functionality to `bash/md2pdf.sh`.
- Supports short aliases: `-s`, `-o`, `-r`, `-p`, `-t`, `-k`.

**Example**

  ```powershell
  ./powershell/md2pdf.ps1 -t README.md
  ```

## Markdown to PDF `node/md2pdf.js`

**Usage**

`node node/md2pdf.js [-s pdf.css] [-o output_dir] [-r temp_root | -p] [-t] [-k] file1.md [file2.md ...]`

oder über npm:

`npm run md2pdf -- [-s pdf.css] [-o output_dir] [-r temp_root | -p] [-t] [-k] file1.md [file2.md ...]`

**Options**

| option | description |
|--------|-------------|
| `-s, --stylesheet <file>` | Stylesheet passed to md-to-pdf (--stylesheet). Defaults to `css/default.css`. |
| `-o, --output-dir <dir>` | Output directory for PDFs (default: alongside each input file). |
| `-r, --temp-root <dir>` | Root directory for temp work dirs (default: system temp). |
| `-p, --temp-in-output` | Place temp dir inside the output directory (or source dir if -o is absent). |
| `-t, --run-doctoc` | Run `doctoc` to inject a Table of Contents (temp copy only). |
| `-k, --keep-temp` | Keep temp working directory (prints its path). |
| `-h, --help` | Show help. |

**Notes**

- Identical functionality to `bash/md2pdf.sh` and `powershell/md2pdf.ps1`.
- Requires `commander` package.

**Example**

  ```bash
  npm run md2pdf -- -t README.md
  ```
