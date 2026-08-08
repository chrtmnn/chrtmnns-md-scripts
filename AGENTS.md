# AGENTS

This file provides guidance to AI Agents when working with code in this repository.

## Workflow

`main` stays in a runnable state. Every change goes through a short-lived branch.

**Branch naming**: `feat/<topic>`, `fix/<topic>`, `docs/<topic>`, `refactor/<topic>`.

**Per change**:

1. `git checkout -b feat/<topic>`
2. Commit work in focused commits (see git-commit skill for message policy)
3. `git push -u origin feat/<topic>`
4. `gh pr create` — the template prompts for what / why / verification
5. Wait for the `typecheck` and `test` GitHub Action checks to pass
6. Merge via squash on GitHub
7. `git checkout main && git pull && git branch -d feat/<topic>`

**Per release**:

1. Bump `version` in `package.json` on `main`
2. `git tag -a v<x.y.z> -m "<summary>"`
3. `git push --tags`

## Commands

```bash
pnpm typecheck          # TypeScript type-check (no emit), test files included
pnpm test               # Automated unit tests (node:test), this is what CI runs
pnpm md2pdf [options] [files...]   # Full pipeline: TOC → Mermaid → PDF
pnpm smoke              # Manual smoke test of md2pdf with CSS overrides
```

Run a single tool directly with tsx:
```bash
npx tsx src/md2pdf.ts --help
```

### Tests

The unit tests live in `src/test/*.test.ts` and run on Node's built-in
`node:test` runner with `node:assert`, through tsx as an ESM loader
(`node --import tsx --test`). No test framework is a dependency. They are
inside `src/` so `tsconfig.json` (`rootDir: src`) type-checks them along with
everything else — `pnpm typecheck` covers the tests too.

`src/test/helpers.ts` holds the fixture helpers: every test writes into its own
`fs.mkdtempSync` directory that is removed by a `t.after` hook, so a run never
leaves files in the repository.

Scope: the pure logic only. Steps that shell out through `runNpx` (doctoc,
mermaid-cli, md-to-pdf) are not covered — the tests must stay fast and must not
need the network or Chromium. Tests that need a symbolic link skip themselves
via `t.skip()` when the platform refuses to create one (Windows needs Developer
Mode or elevation); the Windows-junction test skips on other platforms.

**Convention for testable helpers**: pure logic that deserves tests moves into
its own module rather than being `export`ed out of a file that also does I/O.
`markdown-scan.ts` (scanning primitives, out of `run-doctoc.ts`),
`toc-placement.ts` (TOC relocation rules, out of `run-doctoc.ts`),
`merge-assembly.ts` (concatenation and common-ancestor computation, out of
`merge-markdown.ts`) and `option-values.ts` (`--css-var` / `--merge`
validation, out of `resolve-options.ts`) all follow that split: the step file
keeps the filesystem work, the extracted module keeps the rules.

## Architecture

The project is a CLI toolsuite for converting Markdown to PDF with Mermaid diagram support.

### Pipeline model (`src/md2pdf.ts`)

`md2pdf` is the main entry point. After argument parsing it enters an `async run()` function that imports `@clack/prompts` and renders an `intro` / per-step spinner / `outro` UI. Each step is wrapped by a local `runStep(label, action)` helper that drives a spinner (or `log.info`/`log.success` when `--verbose` is set).

Each step is a function that accepts a `ConversionContext` and **mutates it in place**. Steps return `void`, except `inlineAssets`, which returns the non-fatal warnings the caller surfaces via `log.warn`. Steps run in order; `cleanup` runs in a `finally` block unconditionally.

Before the per-file loop, `resolveInputs` (`src/steps/resolve-inputs.ts`) turns the raw positional arguments into the concrete list of Markdown files, and — when `--merge` is set — `mergeMarkdown` (`src/steps/merge-markdown.ts`) concatenates that list into one temporary Markdown file that the loop then runs over exactly once.

```
resolveInputs → [mergeMarkdown] → for each file:
  prepareWorkdir → runDoctoc → extractTitle → renderMermaid
    → createStylesheet → inlineAssets → renderPdf → copyOutput → cleanup
```

All steps live in `src/steps/`. The types (`ConverterOptions`, `ConversionContext`, `CssVarOverride`) are in `src/types.ts`.

### `ConversionContext` field flow

`prepareWorkdir` initialises the context. Key fields that steps modify:

| Field | Set by | Purpose |
|---|---|---|
| `inputMarkdown` | `prepareWorkdir` (source path) / `runDoctoc` (temp copy) | Path fed to mermaid-cli |
| `convertedMarkdown` | `prepareWorkdir` | Output of mermaid-cli, input to md-to-pdf |
| `docTitle` | `extractTitle` | `--document-title` passed to md-to-pdf |
| `effectiveStylesheet` | `createStylesheet` | Final CSS path (base or merged with overrides) |
| `tempHtml` / `outputHtml` | `prepareWorkdir` | Debug HTML paths; populated by `renderHtml` and `copyOutput` only when `--debug` is set |

### Argument expansion (`src/steps/resolve-inputs.ts`)

Positional arguments may be files or directories. A file positional is kept as-is (including non-existent paths, which are forwarded verbatim so `prepareWorkdir` keeps producing its `Skipped missing file` warning). A directory positional is replaced by the `*.md` files it contains, at the position the user gave it.

- Extension matching is case-insensitive (`.md`, `.MD`); `.markdown` is deliberately **not** matched.
- Ordering uses plain `<`/`>` on the raw file names (UTF-16 code-unit order) rather than `localeCompare`, so it cannot shift with the machine's locale or ICU build. Note that this sorts uppercase before lowercase, e.g. `README.MD` before `readme.md`.
- `-R, --recursive` descends into subdirectories: a directory's own files first (sorted), then its subdirectories (sorted), each recursively. `-R` without a directory positional is a no-op.
- Directories named in `SKIPPED_DIRECTORY_NAMES` (`node_modules`, `.git`) and any directory whose name starts with `.` are never descended into. They can still be expanded when passed explicitly as a positional.
- Symlink loops are avoided by never following directory symlinks: recursion only descends into entries where `Dirent.isDirectory()` is true, which is false for symlinks and Windows junctions. No visited-realpath bookkeeping is needed because a cycle can only be formed through a link. Symlinked `.md` *files* are still collected (verified with an extra `statSync`).
- The final list is deduplicated by resolved absolute path (case-insensitively on Windows), keeping the first occurrence, so passing both a folder and a file inside it converts that file once.
- An empty directory produces a warning, not a failure.

### Merging (`src/steps/merge-markdown.ts`)

`--merge <name>` combines every resolved Markdown file into a single PDF. No PDF-merging library is involved and no dependency was added: the Markdown is concatenated **before** rendering and the existing pipeline then runs once over the concatenated file, so every other flag keeps working unchanged and `--force-doctoc` produces one table of contents spanning all documents.

- Documents are separated by a `<div class="document-break"></div>` block with blank lines on both sides, so a file without a trailing newline cannot glue its last line onto the next document. The matching `.document-break` rule is in `src/css/default.css`, driven by the `--document-page-break-before` / `--document-break-before` custom properties. Headings cannot be used for the break because they default to `break-before: auto`.
- The merged file is written into a temp directory named after `--merge`, so `prepareWorkdir` derives the PDF name, the temp file names, and the document title from it. The document title is therefore the `--merge` name; `extractTitle` is skipped for merged runs.
- The target directory is `-o` when given, otherwise the common ancestor directory of the resolved inputs. `md2pdf.ts` pins it by passing `{ ...options, outputDir: targetDir }` into `prepareWorkdir`, because the merged file itself lives in a temp directory.
- The merge temp directory follows the same `-r` / `-p` placement rules as the conversion work directory and is removed unless `-k` is set.
- Relative **image** targets are rewritten to absolute paths as each document is read, against that document's own directory. Concatenation is the last point at which a section's origin is still known, and `inlineAssets` embeds those absolute paths afterwards. Two documents in different directories can therefore both use `images/logo.png` and each still gets its own file.
- **Limitation**: relative **link** targets are not rewritten. Links are not fetched during rendering, so a relative link between merged documents stays relative and may not point anywhere useful in the PDF. The warning emitted when the inputs span more than one directory says so.
- The pure parts — BOM stripping, the common-ancestor computation, and the concatenation itself — live in `src/steps/merge-assembly.ts`; `merge-markdown.ts` keeps the filesystem work.

### Doctoc auto-detection (`src/steps/run-doctoc.ts`)

`runDoctoc` runs automatically when the source file contains `<!-- START doctoc generated TOC`. The `-f`/`--force-doctoc` flag forces a run even when no markers are present. By default, doctoc runs on a temp copy. The `-u`/`--update-md-toc` flag also updates the original Markdown file when it already has doctoc markers.

When doctoc creates a **brand-new** TOC (no markers existed in the source file, i.e. the `--force-doctoc` case), the generated block is relocated on the temp copy to sit directly before the first second-order (`##`, or setext-style heading followed by a `---` underline) heading in the file — instead of wherever doctoc's own default placement put it. Refreshes of an already-existing TOC (markers were already present) are left exactly where doctoc put them; the relocation logic never touches `context.sourceFile`. Headings inside fenced code blocks (` ``` `/`~~~`) are ignored when locating the target position. If the document has no `##`-equivalent heading at all, doctoc's original placement is left untouched. The relocation rules themselves are a pure string-to-string transformation in `src/steps/toc-placement.ts` (`relocateTocBeforeFirstH2`); `run-doctoc.ts` only applies them to the temp copy and writes the file back when the content actually changed.

### Temp directory strategy

Each conversion creates an isolated temp directory via `fs.mkdtempSync(path.join(base, `${stem}_`))` (`stem_` followed by 6 random characters chosen by Node, e.g. `stem_aB3xQ9`). `mkdtempSync` creates the directory atomically, so a name collision fails loudly instead of two runs silently sharing a directory. Location:
- Default: OS temp dir
- `-r <root>`: custom root directory
- `-p`: inside the output directory (or source dir if `-o` is absent)

The `-k` flag preserves the temp dir for debugging.

md-to-pdf is invoked with `--basedir <workdir>`. That is not a free choice: md-to-pdf serves `--basedir` over HTTP and loads the document from `http://localhost:<port>/<path relative to basedir>`, so the served directory has to be the one holding the converted Markdown and the generated Mermaid SVGs. Pointing `--basedir` at the source directory instead would put the document outside the served root and break the Mermaid references.

### Asset embedding (`src/steps/inline-assets.ts`)

Because the renderer only sees the work directory, a relative image reference in the user's document (`![](images/foo.png)`) would look for the asset next to the *generated* file. Absolute paths do not help either: Chromium refuses to load `file://` resources from an `http://localhost` page. `inlineAssets` therefore rewrites local image targets in the converted Markdown to `data:` URIs before `renderPdf` runs, which fixes resolution without giving up the temp directory isolation.

- Only **image** targets are rewritten: Markdown `![alt](target)` and HTML `<img src>`. Links are never fetched during rendering and are left alone.
- Fenced code blocks and inline code spans are skipped, so documentation that *shows* image syntax survives intact. Reference-style images (`![alt][ref]`) are not handled, because a link reference definition is shared between links and images.
- Targets that already resolve inside the work directory are left untouched. This is what keeps the Mermaid SVGs working.
- URLs (`https://`, `data:`, protocol-relative) are left untouched. Windows drive letters are not mistaken for URL schemes because a scheme must be at least two characters.
- Single-file runs resolve relative targets against `context.sourceDir`. Merged runs resolve them per source document inside `mergeMarkdown` (see below), so by the time this step runs they are already absolute.
- A target that does not resolve to an existing file, or an asset larger than `MAX_INLINE_BYTES` (32 MiB), is reported as a warning and left as written.

A side effect worth knowing: the `--debug` HTML is now self-contained, so it renders correctly even when `-o` puts it somewhere other than the source directory.

### CSS variable system

`src/css/default.css` defines all CSS custom properties. `--css-var name=value` (repeatable, leading `--` optional) injects overrides into a `:root {}` block appended to the base stylesheet in a merged temp file (`style-overrides.css`). Key properties:

md-to-pdf never references `--stylesheet` by path in the rendered page — it reads the file and injects its text into an inline `<style>` tag (puppeteer's `page.addStyleTag({ path })`), so any relative `@import` or `url()` in the base stylesheet would resolve against the page's own location (the `--basedir` HTTP server), not the stylesheet's directory on disk, regardless of where the merged file is written. `resolveStylesheet` (`src/steps/resolve-stylesheet.ts`) therefore makes the merged stylesheet fully self-contained before writing it out: local `@import` targets are inlined recursively (each resolved against its own file's directory, with diamond imports allowed and circular imports rejected), and local `url()` targets are rewritten to `data:` URIs. Remote (`http(s):`) references and existing `data:` URIs are left untouched.

| Variable | Default | Effect |
|---|---|---|
| `--heading-page-break-before` | `auto` | Page break before h1/h2 |
| `--heading-break-before` | `auto` | Same, modern syntax |
| `--first-heading-page-break-before` | `auto` | Suppresses break before the first h1/h2 |
| `--font-text` | `"Aptos"` | Body font |
| `--font-code` | `"JetBrains Mono"` | Code font |
| `--page-margin-top` / `-right` / `-bottom` / `-left` | `2cm` / `2cm` / `2cm` / `2.5cm` | Individual page margins (A4) |
| `--page-margin` | composed from the four individual margins | Shorthand to set all four margins at once |
| `--document-page-break-before` | `always` | Page break before each document combined with `--merge` |
| `--document-break-before` | `page` | Same, modern syntax |

To enable per-heading page breaks: `--css-var heading-page-break-before=always --css-var heading-break-before=page`.

### External tool invocation

All three sub-tools are invoked via `npx` through `runNpx` (`src/steps/run-npx.ts`). Output is piped (hidden) by default and inherited when `--verbose` is set. On failure, `runNpx` re-throws with the tool's stderr/stdout as the error message. Fallback versions are hardcoded in `resolve-options.ts` (not the `^` ranges in `package.json`):

`runNpx` uses `execFileSync` with an **argument array** and no shell. It must never build a command string: `cmd.exe` expands `%VAR%` even inside double quotes, and `%` is legal in Windows file names, so a path like `100%TMP%done.md` or a `--document-title` taken from a heading such as `Deploying to %USERPROFILE%` would be silently rewritten before the tool sees it.

Because there is no shell, Windows cannot spawn the `npx.cmd` batch file — Node rejects `.cmd` with `shell: false` (the CVE-2024-27980 hardening) with `EINVAL`. `resolveNpxInvocation` therefore runs npm's bundled `npx-cli.js` with the current Node binary (`process.execPath`), looking next to `process.execPath` first and then in the `../lib/node_modules` layout. On other platforms `npx` is executable directly and is spawned by name.

| Tool | Env var override | Hardcoded fallback |
|---|---|---|
| doctoc | `DOCTOC_PKG` | `doctoc@2.3.0` |
| @mermaid-js/mermaid-cli | `MERMAID_CLI_PKG` | `@mermaid-js/mermaid-cli@11.12.0` |
| md-to-pdf | `MD_TO_PDF_PKG` | `md-to-pdf@5.2.5` |

Mermaid diagrams render to SVG by default. The `--png` flag switches mermaid-cli's output format to PNG (`-e png`) for viewers or downstream tools that handle embedded SVG poorly. When `--png` is set, `render-mermaid.ts` also passes `-s 3` (`--scale`), a module-level `PNG_PRINT_SCALE` constant, so PNG diagrams stay sharp at print resolution instead of the blurry default scale of 1.

### Global wrapper (`bin/`)

`bin/md2pdf.ps1` resolves relative file paths against the caller's working directory before delegating to `pnpm --silent md2pdf`. `bin/md2pdf.cmd` delegates to the `.ps1`. Add `bin/` to `PATH` via `scripts/install.ps1`; remove via `scripts/uninstall.ps1`.

The wrapper classifies each CLI argument before forwarding it: path options (`-s`, `-o`, `-r`, and their long forms) have their value resolved to an absolute path; passthrough-value options (`--css-var`, `--merge`) have their value forwarded verbatim, in both the space-separated and the `--option=value` inline form; flags and positional arguments are resolved as paths or passed as-is. Positional arguments are resolved to absolute paths whether they are files or directories.

Option lookup uses ordinal (case-sensitive) `HashSet`s built by `New-OrdinalSet`. PowerShell's `@{}` hashtables and the `-contains` operator both compare case-insensitively, which would make the valueless flag `-R/--recursive` collide with the path option `-r/--temp-root` and swallow the next argument as a path.

Before classification, `$args` is flattened by `ConvertTo-FlatArgumentList`. PowerShell passes a parenthesized array expression (`md2pdf (Get-ChildItem *.md).Name`) as a *single* array-valued argument instead of unrolling it, which would otherwise break the string-based parsing loop.
