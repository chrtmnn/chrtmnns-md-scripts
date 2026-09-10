# chrtmnn's md scripts

Convert Markdown files to PDF from any terminal with one command:

```powershell
md2pdf README.md
```

The command shows a compact progress view, refreshes an existing doctoc table of contents on a temporary copy, renders Mermaid diagrams, and writes a PDF next to the Markdown file unless another output directory is configured. Arguments may be single files or whole folders, and `--merge` combines them into one PDF.

## Table of Contents

<!-- START doctoc generated TOC please keep comment here to allow auto update -->
<!-- DON'T EDIT THIS SECTION, INSTEAD RE-RUN doctoc TO UPDATE -->

- [Installation](#installation)
- [Usage](#usage)
- [Options](#options)
- [Uninstall](#uninstall)
- [Additional usage information](#additional-usage-information)
  - [Converting Folders](#converting-folders)
  - [Merging Into One PDF](#merging-into-one-pdf)
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
.\scripts\install.ps1
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

Convert every `*.md` file of a folder:

```powershell
md2pdf docs
```

Include subfolders:

```powershell
md2pdf -R docs
```

Combine everything into a single PDF named `handbook.pdf`:

```powershell
md2pdf -R --merge handbook docs
```

Combine a folder and one extra file into a single PDF with one table of contents spanning all documents:

```powershell
md2pdf -f --merge handbook docs CHANGELOG.md
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

Render Mermaid diagrams as PNG instead of SVG:

```powershell
md2pdf --png README.md
```

## Options

`md2pdf [-R] [--merge name] [-s pdf.css] [--css-var name=value] [-o output_dir] [-r temp_root | -p] [-f] [-u] [-k] [--verbose] [--debug] [--png] [files or folders...]`

| option                    | description                                                                                               |
|---------------------------|-----------------------------------------------------------------------------------------------------------|
| `-R, --recursive`         | Also expand subfolders of folder arguments. Skips `node_modules`, `.git`, and folders starting with a dot. |
| `--merge <name>`          | Combine all resolved Markdown files into one PDF with this base name. The `.pdf` suffix is optional.      |
| `-s, --stylesheet <file>` | Stylesheet for the generated PDF. Defaults to `src/css/default.css`. Relative `@import` and `url()` references are resolved against the stylesheet's own folder. |
| `--css-var <name=value>`  | Override a CSS custom property for this run. The leading `--` is optional. Repeat for multiple variables. |
| `-o, --output-dir <dir>`  | Output directory for PDFs. Defaults to each Markdown file's directory, or to the common parent folder of all inputs with `--merge`. |
| `-r, --temp-root <dir>`   | Root directory for temporary work dirs. Defaults to the system temp directory.                            |
| `-p, --temp-in-output`    | Place the temporary work dir inside the output directory.                                                 |
| `-f, --force-doctoc`      | Create or refresh a TOC on the temporary conversion copy, even without source TOC markers.                |
| `-u, --update-md-toc`     | Update an existing doctoc TOC in the original Markdown file. Does not create a new source TOC.            |
| `-k, --keep-temp`         | Keep the temporary work directory and print its path.                                                     |
| `--verbose`               | Print output from doctoc, mermaid-cli, and md-to-pdf while they run.                                      |
| `--debug`                 | Also write a standalone HTML file next to the PDF using the same stylesheet.                              |
| `--png`                   | Render Mermaid diagrams as PNG instead of SVG. Useful for PDF viewers or downstream tools that handle embedded SVG poorly. |
| `-h, --help`              | Show help.                                                                                                |

## Uninstall

Remove the wrapper from your user `PATH`:

```powershell
.\scripts\uninstall.ps1
```

Restart your terminal afterwards.

---

<div class="page-break"></div>

## Additional usage information

### Converting Folders

A positional argument may be a Markdown file or a folder. A folder contributes the `*.md` files it contains, at the position where you named it, so `md2pdf intro.md chapters appendix.md` converts `intro.md`, then everything in `chapters`, then `appendix.md`.

- Only the `.md` extension is matched, upper or lower case (`.md`, `.MD`). Other Markdown extensions such as `.markdown` are **not** picked up.
- Files inside one folder are converted in file name order. The comparison is a plain code-point comparison so the order is identical on every machine, which also means names starting with an upper-case letter come first (`README.md` before `readme.md`).
- Pass `-R` to include subfolders. `node_modules`, `.git`, and any folder whose name starts with a dot are skipped, and folder links (symlinks and junctions) are not followed, so a link pointing back at a parent folder cannot cause an endless loop.
- Passing both a folder and a file inside it converts that file once, not twice.
- A folder without any `.md` file produces a warning and is not counted as a failure.

### Merging Into One PDF

`--merge <name>` combines every resolved Markdown file into a single PDF:

```powershell
md2pdf -R --merge handbook docs
```

This writes `handbook.pdf`. The `.pdf` suffix is optional, so `--merge handbook.pdf` is equivalent. The name is a file name, not a path; use `-o` to choose the folder. Without `-o` the PDF is written to the common parent folder of all inputs.

Merging happens on the Markdown, before rendering, and the normal conversion then runs once over the combined document. Two consequences are worth knowing:

- All other options still apply. In particular `-f/--force-doctoc` produces **one** table of contents spanning every document, which is usually the main reason to merge in the first place.
- Each document starts on a new page. The page break is produced by the `.document-break` helper in the default stylesheet. If you pass your own stylesheet with `-s`, add a matching rule or the documents will run together. To flatten the breaks, use `--css-var document-page-break-before=auto --css-var document-break-before=auto`.

> **Limitation**: relative link and image targets are not rewritten when documents are merged. All documents share one base location, so a `![](images/logo.png)` written relative to a subfolder will not resolve in the merged PDF. `md2pdf` prints a warning whenever the merged inputs come from more than one folder. Use absolute paths or URLs for assets in documents you intend to merge.

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

If the source Markdown does not yet contain the marker block, pass `-f` once to let doctoc create it on the temporary conversion copy. The newly created block is then placed directly before the first second-order (`##`) heading in the file, regardless of where doctoc itself would otherwise have inserted it.

To also write the refreshed TOC back into the original Markdown file (instead of only into the temporary conversion copy), combine `-u` with an existing marker block.

### Mermaid Diagram Syntax

Mermaid code fences are rendered automatically during conversion.

Diagrams render to SVG by default. Pass `--png` to render them as PNG instead, at a 3x scale for print resolution. SVG is a good default because it stays crisp at any zoom level, but choose `--png` if the target PDF viewer or a downstream tool handles embedded SVG poorly.

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
