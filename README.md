# chrtmnn's md scripts

Convert Markdown files to PDF from any terminal with one command:

```powershell
md2pdf README.md
```

The command shows a compact progress view, refreshes an existing doctoc table of contents on a temporary copy, renders Mermaid diagrams, and writes a PDF next to the Markdown file unless another output directory is configured.

## Table of Contents

<!-- START doctoc generated TOC please keep comment here to allow auto update -->
<!-- DON'T EDIT THIS SECTION, INSTEAD RE-RUN doctoc TO UPDATE -->

- [Installation](#installation)
- [Usage](#usage)
- [Options](#options)
- [Uninstall](#uninstall)
- [Additional usage information](#additional-usage-information)
  - [Manual Page Breaks](#manual-page-breaks)
  - [Table of Contents Markers](#table-of-contents-markers)
  - [Mermaid Diagram Syntax](#mermaid-diagram-syntax)

<!-- END doctoc generated TOC please keep comment here to allow auto update -->

## Installation

Prerequisites:

- Node.js with `npm`/`npx` available in `PATH`
- Internet access on first use so `npx` can fetch the conversion tools

Run the install script once from this repository:

```powershell
.\install.ps1
```

The script installs pnpm globally (with confirmation) if it is not already available, runs `pnpm install` if dependencies are missing, and adds the `bin/` directory to your user `PATH`. Restart your terminal afterwards. The `md2pdf` command is then available from any directory.

## Usage

Convert one Markdown file:

```powershell
md2pdf README.md
```

Convert multiple files:

```powershell
md2pdf README.md docs\usage.md
```

Write PDFs to an output directory:

```powershell
md2pdf -o pdf README.md
```

Update an existing TOC in the original Markdown file while converting:

```powershell
md2pdf -u README.md
```

Create a TOC on the temporary conversion copy even when the source file has no doctoc markers:

```powershell
md2pdf -f README.md
```

Show help:

```powershell
md2pdf
```

Show output from the underlying conversion tools:

```powershell
md2pdf --verbose README.md
```

Also emit an HTML file next to the PDF for inspection:

```powershell
md2pdf --debug README.md
```

## Options

`md2pdf [-s pdf.css] [--css-var name=value] [-o output_dir] [-r temp_root | -p] [-f] [-u] [-k] [--verbose] [--debug] [files...]`

| option                    | description                                                                                               |
|---------------------------|-----------------------------------------------------------------------------------------------------------|
| `-s, --stylesheet <file>` | Stylesheet for the generated PDF. Defaults to `src/css/default.css`.                                      |
| `--css-var <name=value>`  | Override a CSS custom property for this run. The leading `--` is optional. Repeat for multiple variables. |
| `-o, --output-dir <dir>`  | Output directory for PDFs. Defaults to each Markdown file's directory.                                    |
| `-r, --temp-root <dir>`   | Root directory for temporary work dirs. Defaults to the system temp directory.                            |
| `-p, --temp-in-output`    | Place the temporary work dir inside the output directory.                                                 |
| `-f, --force-doctoc`      | Create or refresh a TOC on the temporary conversion copy, even without source TOC markers.                |
| `-u, --update-md-toc`     | Update an existing doctoc TOC in the original Markdown file. Does not create a new source TOC.            |
| `-k, --keep-temp`         | Keep the temporary work directory and print its path.                                                     |
| `--verbose`               | Print output from doctoc, mermaid-cli, and md-to-pdf while they run.                                      |
| `--debug`                 | Also write a standalone HTML file next to the PDF using the same stylesheet.                              |
| `-h, --help`              | Show help.                                                                                                |

## Uninstall

Remove the wrapper from your user `PATH`:

```powershell
.\uninstall.ps1
```

Restart your terminal afterwards.

---

<div class="page-break"></div>

## Additional usage information

### Manual Page Breaks

The default stylesheet exposes a `.page-break` helper that forces a page break before the element it is applied to. Insert an empty HTML element with the class wherever the next page should start — any of these work:

```markdown
<i class="page-break"></i>
<span class="page-break"></span>
<div class="page-break"></div>
```

The helper sets `display: block` internally, so inline elements work too. The marker is invisible in the rendered PDF and is ignored by Markdown viewers that do not honour the class.

### Table of Contents Markers

`md2pdf` refreshes a TOC automatically when the source Markdown contains a doctoc marker block. Add the following block once at the location where the TOC should appear:

```markdown
<!-- START doctoc generated TOC please keep comment here to allow auto update -->
<!-- END doctoc generated TOC please keep comment here to allow auto update -->
```

On the next conversion, doctoc fills the block with the current heading structure. Subsequent runs keep the block in place and update its content.

If the source Markdown does not yet contain the marker block, pass `-f` once to let doctoc insert the block at the top of the temporary conversion copy.

To also write the refreshed TOC back into the original Markdown file (instead of only into the temporary conversion copy), combine `-u` with an existing marker block.

### Mermaid Diagram Syntax

Mermaid code fences are rendered automatically during conversion.

> For further information visit https://mermaid.js.org/intro/syntax-reference.html.

**Markdown input**:

<pre><code>```mermaid
flowchart LR
  A[Markdown file] --> B[Table of Contents]
  B --> C[Render diagrams]
  C --> D[PDF output]
```</code></pre>

**Rendered preview**:

```mermaid
flowchart LR
    A[Markdown file] --> B[Table of Contents]
    B --> C[Render diagrams]
    C --> D[PDF output]
```
