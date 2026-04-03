# chrtmnn's md scripts

Collection of (hopefully) usefully `markdown` scripts.

## Markdown to PDF

**Usage**

`md_pdf_mermaid.sh [-s pdf.css] [-o output_dir] [-r temp_root | -p] [-k] file1.md [file2.md ...]`

**Options**

| option      | description                                                                  |
|-------------|------------------------------------------------------------------------------|
| `-s <file>` | Stylesheet passed to md-to-pdf (--stylesheet). Defaults to `css/default.css`. |
| `-o <dir>`  | Output directory for PDFs (default: alongside each input file).              |
| `-r <dir>`  | Root directory for temp work dirs (default: system temp).                    |
| `-p`        | Place temp dir inside the output directory (or source dir if -o is absent).  |
| `-k`        | Keep temp working directory (prints its path).                               |
| `-h`        | Show help.                                                                   |

* Example **`bash/md2pdf.sh`**
  ```bash
  ./bash/md2pdf.sh README.md
  ```