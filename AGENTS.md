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
pnpm test:coverage      # Same tests with Node's built-in line/branch coverage report
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

`pnpm test:coverage` only reports files that at least one test imports. The
modules that no test loads (`md2pdf.ts` and the `runNpx` steps) are missing
from the table rather than listed at 0 %, so the "all files" total covers the
tested modules only.

**Convention for testable helpers**: pure logic that deserves tests moves into
its own module rather than being `export`ed out of a file that also does I/O.
`markdown-scan.ts` (scanning primitives, out of `run-doctoc.ts`),
`toc-placement.ts` (TOC relocation rules, out of `run-doctoc.ts`),
`merge-assembly.ts` (concatenation and common-ancestor computation, out of
`merge-markdown.ts`), `option-values.ts` (`--css-var` / `--merge`
validation, out of `resolve-options.ts`), `css-import-conditions.ts`
(`@import` layer/supports/media parsing, out of `resolve-stylesheet.ts`),
`npx-invocation.ts` (the shell-free npx lookup and error formatting, out of
`run-npx.ts`), `css-import-hoisting.ts` (remote `@import` placement and
restating, out of `resolve-stylesheet.ts`) and `stylesheet-lookup.ts` (the `-s`
lookup order, out of `resolve-options.ts`) all follow that split: the step file
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
| `effectiveStylesheet` | `createStylesheet` | Final CSS path (the base stylesheet as-is, or its self-contained copy with inlined references and overrides) |
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

When doctoc creates a **brand-new** TOC (no markers existed in the source file, i.e. the `--force-doctoc` case), the generated block is relocated on the temp copy to sit directly before the first second-order (`##`, or setext-style heading followed by a `---` underline) heading in the file — instead of wherever doctoc's own default placement put it. Refreshes of an already-existing TOC (markers were already present) are left exactly where doctoc put them; the relocation logic never touches `context.sourceFile`. Headings that do not render are ignored when locating the target position (see *Markdown scanning*). If the document has no `##`-equivalent heading at all, doctoc's original placement is left untouched. The relocation rules themselves are a pure string-to-string transformation in `src/steps/toc-placement.ts` (`relocateTocBeforeFirstH2`); `run-doctoc.ts` only applies them to the temp copy and writes the file back when the content actually changed.

### Markdown scanning (`src/steps/markdown-scan.ts`)

Both heading lookups — `findFirstHeading` (→ `extractTitle` → `--document-title`) and `findFirstH2Index` (→ `relocateTocBeforeFirstH2`) — scan through `mapLiveContent`, which reduces the document to the lines that actually render. Keeping the tracking in one place is what stops the two consumers from drifting apart; a container that hides a heading has to hide it from both.

Two containers are tracked, both line-oriented:

- **Fenced code blocks** (` ``` `/`~~~`): closed only by a run of the same character that is at least as long **and** carries no info string, per CommonMark. ` ```js ` can open a block but never close one, so `['```', '## inside', '```js', '## after']` has no heading outside the block at all.
- **HTML comment blocks**: a line whose first non-space characters are `<!--` is a CommonMark type-2 HTML block and is opaque up to **and including** the line carrying `-->`, so `<!-- x --> # Real` yields no heading. The abbreviated empty comment `<!-->` counts as closed on its own line. A `<!--` that appears *after* other content is an inline span and affects only its own line: complete spans are removed, which keeps `## Heading <!-- omit in toc -->` a heading, and anything after an unclosed `<!--` is dropped up to the end of that line. A mid-line `<!--` deliberately does **not** open a block for the following lines — doing so would fire on prose that merely mentions the delimiter (a `` `<!--` `` in an inline code span, an indented code sample) and hide every heading after it, which is the failure this module exists to prevent.

`matchAtxHeading` applies the CommonMark rules for the heading text itself: `#hashtag` is not a heading, four spaces of indentation make an indented code block, and the optional closing hash sequence is stripped rather than returned — `## Heading ##` is the heading `Heading`. The closing run only counts when preceded by a space or tab or when it is the whole remainder, so `## Heading#` keeps its `#` and `## #` is an empty heading.

This is a documented heuristic, not a CommonMark parser. Backslash-escaped hashes (`## foo \#\##`, which CommonMark renders as `foo ###`), other HTML block types, link reference definitions and inline escapes are deliberately not modelled.

### Temp directory strategy

Each conversion creates an isolated temp directory via `fs.mkdtempSync(path.join(base, `${stem}_`))` (`stem_` followed by 6 random characters chosen by Node, e.g. `stem_aB3xQ9`). `mkdtempSync` creates the directory atomically, so a name collision fails loudly instead of two runs silently sharing a directory. Location:
- Default: OS temp dir
- `-r <root>`: custom root directory
- `-p`: inside the output directory (or source dir if `-o` is absent)

The `-k` flag preserves the temp dir for debugging.

md-to-pdf is invoked with `--basedir <workdir>`. That is not a free choice: md-to-pdf serves `--basedir` over HTTP and loads the document from `http://localhost:<port>/<path relative to basedir>`, so the served directory has to be the one holding the converted Markdown and the generated Mermaid SVGs. Pointing `--basedir` at the source directory instead would put the document outside the served root and break the Mermaid references.

`renderPdf` also passes `--config-file src/config/md-to-pdf.config.json`, which sets `pdf_options.preferCSSPageSize: true`. Without it Puppeteer's `format: 'a4'` default wins over the stylesheet's `@page { size }`, and Chromium scales a non-A4 CSS page (e.g. `--css-var page-size=A5`) down onto A4 sheets. `--pdf-options` is deliberately not used for this: md-to-pdf assigns it over `pdf_options` wholesale, which would drop the `printBackground` / `format` / `margin` defaults and any front-matter `pdf_options`. A config file is merged onto the defaults, and front matter still takes precedence over it.

### Asset embedding (`src/steps/inline-assets.ts`)

Because the renderer only sees the work directory, a relative image reference in the user's document (`![](images/foo.png)`) would look for the asset next to the *generated* file. Absolute paths do not help either: Chromium refuses to load `file://` resources from an `http://localhost` page. `inlineAssets` therefore rewrites local image targets in the converted Markdown to `data:` URIs before `renderPdf` runs, which fixes resolution without giving up the temp directory isolation.

- Only **image** targets are rewritten: Markdown `![alt](target)` and HTML `<img src>`. Links are never fetched during rendering and are left alone.
- Fenced code blocks and inline code spans are skipped, so documentation that *shows* image syntax survives intact. Reference-style images (`![alt][ref]`) are not handled, because a link reference definition is shared between links and images.
- Targets that already resolve inside the work directory are left untouched. This is what keeps the Mermaid SVGs working.
- URLs (`https://`, `data:`, protocol-relative) are left untouched. Windows drive letters are not mistaken for URL schemes because a scheme must be at least two characters.
- Single-file runs resolve relative targets against `context.sourceDir`. Merged runs resolve them per source document inside `mergeMarkdown` (see below), so by the time this step runs they are already absolute.
- A target that does not resolve to an existing file, or an asset larger than `MAX_INLINE_BYTES` (32 MiB), is reported as a warning and left as written.

A side effect worth knowing: the `--debug` HTML is now self-contained, so it renders correctly even when `-o` puts it somewhere other than the source directory.

### Stylesheet lookup (`src/steps/stylesheet-lookup.ts`)

`resolveOptions` resolves `-s <value>` through `findStylesheet`, taking the first candidate that is a regular file:

1. `<value>` as a path, resolved against the caller's directory: `MD2PDF_INVOCATION_DIR` when set (the global wrapper sets it, see *Global wrapper*), otherwise `process.cwd()`. No extension is ever added here.
2. For a bare name only — no `/` or `\`, no drive prefix, not `.` / `..` — `<config dir>/<value>`.
3. For a bare name that does not end in `.css` (case-insensitive), `<config dir>/<value>.css`.

The config directory is `MD2PDF_CONFIG_DIR` when set and non-empty, otherwise `~/.md2pdf` (`os.homedir()`). Stylesheets live directly in it; subdirectories are never searched for the `-s` name, although a stylesheet found there may still `@import` files from its subdirectories (see *CSS variable system*). A directory that carries the stylesheet's name is skipped. The match is passed on as an absolute path, since a relative value now refers to the caller's directory rather than the process working directory.

When nothing matches, a path value keeps the single-line `Stylesheet not found: <path>` error, and a bare name lists every location that was tried.

`chooseStylesheet` wraps that lookup with the choice for the whole run (#40) and reports the origin alongside the path:

| `-s` value | result | origin |
|---|---|---|
| `default` | the bundled `src/css/default.css`, without any lookup | `bundled` |
| anything else | `findStylesheet` as above | `option` |
| none, `<config dir>/default.css` exists | that file, **replacing** the bundled stylesheet | `user-default` |
| none | the bundled stylesheet, or nothing when it is missing | `bundled` |

`default` is reserved absolutely: neither the invocation directory nor the config directory is consulted for it, so a single run can fall back to the bundled stylesheet without naming a path that differs per machine. The personal file stays reachable as `-s default.css` (a bare name, so the config directory applies) or by path. An explicit `-s default` in a checkout without `src/css/default.css` fails like any other unmatched `-s`; without `-s` the run continues with no stylesheet at all, as before.

The personal default replaces rather than extends, exactly like any other `-s` value — a user file therefore has to carry the `@page` setup, `.page-break`, `.document-break` and every custom property `--css-var` targets, which the README says under *Personal Stylesheets*. `ConverterOptions.stylesheetOrigin` carries the origin so `md2pdf.ts` can print `describeStylesheet` under `--verbose`, since an unflagged switch of the default is otherwise invisible.

Tests must never touch the real home directory: the lookup rules take both directories and an `isFile` callback as parameters, and the `resolveOptions` tests point both environment variables at temp directories.

### CSS variable system

`src/css/default.css` defines all CSS custom properties. `--css-var name=value` (repeatable, leading `--` optional) injects overrides into a `:root {}` block appended to the base stylesheet in a merged temp file (`style-overrides.css`). Key properties:

md-to-pdf never references `--stylesheet` by path in the rendered page — it reads the file and injects its text into an inline `<style>` tag (puppeteer's `page.addStyleTag({ path })`), so any relative `@import` or `url()` in the base stylesheet would resolve against the page's own location (the `--basedir` HTTP server), not the stylesheet's directory on disk, regardless of where the merged file is written. `resolveStylesheet` (`src/steps/resolve-stylesheet.ts`) therefore makes the stylesheet fully self-contained before writing it out: local `@import` targets are inlined recursively (each resolved against its own file's directory, with diamond imports allowed and circular imports rejected), and local `url()` targets are rewritten to `data:` URIs. Remote (`http(s):`) references and existing `data:` URIs are left untouched. A missing local target aborts the run with its path.

This runs for every configured stylesheet, with or without `--css-var` — the breakage is inherent to how md-to-pdf consumes stylesheets, not to the overrides. The self-contained copy goes into a per-run `md2pdf_css_` temp directory as `style-overrides.css` (the name predates the change; the `:root {}` block is only appended when there are overrides). Fast path: without overrides and without any local reference to resolve, the original path is returned and nothing is written, so the bundled `default.css` is passed through as-is.

An inlined `@import` keeps its conditions as wrapping blocks, nested in grammar order: `@import "x.css" layer(base) supports(display: grid) print;` becomes `@layer base { @supports (display: grid) { @media print { … } } }`. The tail parsing (`layer` / `layer(<name>)`, `supports(…)` with balanced parentheses, then the media query list) is in `src/steps/css-import-conditions.ts`; malformed tails (unbalanced parentheses, empty `layer()` / `supports()`) abort with the importing file named.

**Remote `@import`s are hoisted.** A browser honours an `@import` only where it precedes every other rule and sits outside any block, so a remote one cannot stay where it was written: inlining a local import before it, or wrapping its file in one of those condition blocks, makes the browser drop it *silently* — the PDF then renders without the remote stylesheet, which in practice means a web font falling back. `resolveStylesheet` therefore lifts every remote `@import` to the top of the effective stylesheet, in source order, folding the conditions of the whole import chain into its own tail:

| Found in | Hoisted as |
|---|---|
| top level, or an unconditioned import | `@import url(REMOTE);` |
| a file imported with `layer(fonts)` | `@import url(REMOTE) layer(fonts);` |
| a file imported with `print` | `@import url(REMOTE) print;` |
| `layer(inner) screen` inside a file imported with `layer(outer)` | `@import url(REMOTE) layer(outer.inner) screen;` |

The composition rules are in `css-import-conditions.ts` next to the tail parsing: layer names nest with `.`, `supports()` conditions combine as `(A) and (B)`, and media query lists combine as a cross product (`print, screen` inside `(min-width: 10cm)` → `print and (min-width: 10cm), screen and (min-width: 10cm)`, with the media type leading each rendered query because CSS requires that). A pair that cannot hold at once is dropped from the cross product rather than failing it, so `print` inside `print, screen` composes to `print`; `all` adds no constraint and leaves the other side as written. A negated feature query is parenthesised on the way out (`screen and (not (hover))`), because a bare `not (…)` may not be followed by a further `and`.

Where no faithful composition exists the run aborts with the importing file named rather than emit an `@import` that would be dropped again: an anonymous `layer` has no name to nest with another layer, two different media *types* cannot both hold, a query whose own `not` / `only` negates a media type cannot be narrowed by `and`, and a media query list that contributes nothing would silently *widen* the condition. A single set of conditions is passed through verbatim, so a lone anonymous `layer` or `not print` survives untouched.

Two consequences worth knowing:

- **Cascade order changes.** A hoisted remote sheet moves ahead of local rules that preceded it in source order, so where both define the same selector the local rule now wins. For the main use case — a `fonts.css` full of `@font-face` declarations — that is irrelevant, but exact source order cannot be preserved: inlined content has to follow the `@import`s, not precede them.
- **Insertion point.** The imports go after a leading `@charset` and after any leading `@layer` *statements* (`@layer a, b;`), because those fix cascade-layer order by first appearance and must keep their position. A `@layer x { }` *block* is an ordinary rule, so the hoisted imports go above it.

The statement is re-emitted byte-for-byte when the chain adds no conditions, so a stylesheet whose only remote `@import` already sat at the top still takes the fast path and is passed through unchanged — as long as the statement is followed by a newline, which is what the marker consumes. A file ending `@import url(R);` with no trailing newline gains one and is therefore written out.

Two shapes worth expecting in the output: a conditioned local import whose only content *was* the remote import leaves its wrapper behind empty (`@media print { }`), and a diamond that reaches the same remote import twice contributes it once. Both are harmless. The placement and restating rules are a pure string-to-string transformation in `src/steps/css-import-hoisting.ts`; `resolve-stylesheet.ts` keeps the filesystem work.

Two pre-existing gaps that the hoisting does **not** close, because the `@import` never matches in the first place: a statement whose conditions are interrupted by a block comment (`@import url(…) /* c */;`), and one missing its `;` — the latter is deliberately left unmatched, since a tail that ran on to the next `;` anywhere in the file would otherwise let hoisting relocate whole rules.

| Variable | Default | Effect |
|---|---|---|
| `--heading-page-break-before` | `auto` | Page break before h1/h2 |
| `--heading-break-before` | `auto` | Same, modern syntax |
| `--first-heading-page-break-before` | `auto` | Suppresses break before the first h1/h2 |
| `--font-text` | `"Aptos"` | Body font |
| `--font-code` | `"JetBrains Mono"` | Code font |
| `--page-margin-top` / `-right` / `-bottom` / `-left` | `2cm` / `2cm` / `2cm` / `2.5cm` | Individual page margins (A4) |
| `--page-margin` | composed from the four individual margins | Shorthand to set all four margins at once |
| `--page-size` | `A4` | `@page` size, e.g. `A5`, `letter`, `A4 landscape` |
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

The wrapper classifies each CLI argument before forwarding it: path options (`-o`, `-r`, and their long forms) have their value resolved to an absolute path; passthrough-value options (`-s`, `--css-var`, `--merge`, and their long forms) have their value forwarded verbatim, in both the space-separated and the `--option=value` inline form; flags and positional arguments are resolved as paths or passed as-is. Positional arguments are resolved to absolute paths whether they are files or directories.

`-s/--stylesheet` is a passthrough option because its value may be a bare name from `~/.md2pdf` (see *Stylesheet lookup*), which only `md2pdf` itself can tell apart from a path. Instead of resolving it, the wrapper exports the caller's directory as `MD2PDF_INVOCATION_DIR` for the duration of the call and restores the previous value in its `finally` block: a script run from an interactive PowerShell shares that session's environment, and a stale value would redirect later direct `pnpm md2pdf` runs.

Option lookup uses ordinal (case-sensitive) `HashSet`s built by `New-OrdinalSet`. PowerShell's `@{}` hashtables and the `-contains` operator both compare case-insensitively, which would make the valueless flag `-R/--recursive` collide with the path option `-r/--temp-root` and swallow the next argument as a path.

Before classification, `$args` is flattened by `ConvertTo-FlatArgumentList`. PowerShell passes a parenthesized array expression (`md2pdf (Get-ChildItem *.md).Name`) as a *single* array-valued argument instead of unrolling it, which would otherwise break the string-based parsing loop.
