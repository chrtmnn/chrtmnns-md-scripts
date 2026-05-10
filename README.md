# chrtmnn's md scripts

Collection of (hopefully) useful Markdown scripts.

* [github.com/chrtmnn/chrtmnns-md-scripts](https://github.com/chrtmnn/chrtmnns-md-scripts)

## Table of Contents

<!-- START doctoc generated TOC please keep comment here to allow auto update -->
<!-- DON'T EDIT THIS SECTION, INSTEAD RE-RUN doctoc TO UPDATE -->

- [Prerequisites](#prerequisites)
- [Markdown to PDF `src/md2pdf.js`](#markdown-to-pdf-srcmd2pdfjs)

<!-- END doctoc generated TOC please keep comment here to allow auto update -->

## Prerequisites

- Node.js (incl. npm/npx) available in PATH.
- Internet access for the first run so `npx` can fetch `doctoc`, `@mermaid-js/mermaid-cli` and `md-to-pdf` (or install
  them globally ahead of time with `npm install -g doctoc @mermaid-js/mermaid-cli md-to-pdf`).

## Markdown to PDF `src/md2pdf.js`

**Usage**

`node src/md2pdf.js [-s pdf.css] [--css-var name=value] [-o output_dir] [-r temp_root | -p] [-t] [-k] file1.md [file2.md ...]`

or via pnpm:

`pnpm run md2pdf -- [-s pdf.css] [--css-var name=value] [-o output_dir] [-r temp_root | -p] [-t] [-k] file1.md [file2.md ...]`

**Options**

| option | description |
|--------|-------------|
| `-s, --stylesheet <file>` | Stylesheet passed to md-to-pdf (--stylesheet). Defaults to `src/css/default.css`. |
| `--css-var <name=value>` | Override a CSS custom property for this run. The leading `--` is optional. Repeat for multiple variables. |
| `-o, --output-dir <dir>` | Output directory for PDFs (default: alongside each input file). |
| `-r, --temp-root <dir>` | Root directory for temp work dirs (default: system temp). |
| `-p, --temp-in-output` | Place temp dir inside the output directory (or source dir if -o is absent). |
| `-t, --run-doctoc` | Run `doctoc` to inject a Table of Contents (temp copy only). |
| `-k, --keep-temp` | Keep temp working directory (prints its path). |
| `-h, --help` | Show help. |

**Notes**

- Requires `commander` package.

**Example**

  ```bash
  pnpm run md2pdf -- -t README.md
  ```

  ```bash
  pnpm run md2pdf -- --css-var heading-page-break-before=auto --css-var heading-break-before=auto README.md
  ```
