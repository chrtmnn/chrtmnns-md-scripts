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
5. Wait for the `typecheck` GitHub Action to pass
6. Merge via squash on GitHub
7. `git checkout main && git pull && git branch -d feat/<topic>`

**Per release**:

1. Bump `version` in `package.json` on `main`
2. `git tag -a v<x.y.z> -m "<summary>"`
3. `git push --tags`

## Commands

```bash
pnpm typecheck          # TypeScript type-check (no emit)
pnpm md2pdf [options] [files...]   # Full pipeline: TOC → Mermaid → PDF
pnpm test               # Manual smoke test of md2pdf with CSS overrides
```

Run a single tool directly with tsx:
```bash
npx tsx src/md2pdf.ts --help
```

There is no automated test suite beyond the manual `test` script.

## Architecture

The project is a CLI toolsuite for converting Markdown to PDF with Mermaid diagram support.

### Pipeline model (`src/md2pdf.ts`)

`md2pdf` is the main entry point. After argument parsing it enters an `async run()` function that imports `@clack/prompts` and renders an `intro` / per-step spinner / `outro` UI. Each step is wrapped by a local `runStep(label, action)` helper that drives a spinner (or `log.info`/`log.success` when `--verbose` is set).

Each step is a function that accepts a `ConversionContext` and **mutates it in place** (all steps return `void`). Steps run in order; `cleanup` runs in a `finally` block unconditionally.

```
prepareWorkdir → runDoctoc → extractTitle → renderMermaid
  → createStylesheet → renderPdf → copyOutput → cleanup
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

### Doctoc auto-detection (`src/steps/run-doctoc.ts`)

`runDoctoc` runs automatically when the source file contains `<!-- START doctoc generated TOC`. The `-f`/`--force-doctoc` flag forces a run even when no markers are present. By default, doctoc runs on a temp copy. The `-u`/`--update-md-toc` flag also updates the original Markdown file when it already has doctoc markers.

### Temp directory strategy

Each conversion creates an isolated temp directory (`stem_<8 random chars>`). Location:
- Default: OS temp dir
- `-r <root>`: custom root directory
- `-p`: inside the output directory (or source dir if `-o` is absent)

The `-k` flag preserves the temp dir for debugging.

### CSS variable system

`src/css/default.css` defines all CSS custom properties. `--css-var name=value` (repeatable, leading `--` optional) injects overrides into a `:root {}` block appended to the base stylesheet in a merged temp file (`style-overrides.css`). Key properties:

| Variable | Default | Effect |
|---|---|---|
| `--heading-page-break-before` | `always` | Page break before h1/h2 |
| `--heading-break-before` | `page` | Same, modern syntax |
| `--first-heading-page-break-before` | `auto` | Suppresses break before the first h1/h2 |
| `--font-text` | `"Aptos"` | Body font |
| `--font-code` | `"JetBrains Mono"` | Code font |
| `--page-margin-top` / `-right` / `-bottom` / `-left` | `2cm` / `2cm` / `2cm` / `2.5cm` | Individual page margins (A4) |
| `--page-margin` | composed from the four individual margins | Shorthand to set all four margins at once |

To disable per-heading page breaks: `--css-var heading-page-break-before=auto --css-var heading-break-before=auto`.

### External tool invocation

All three sub-tools are invoked via `npx` through `runNpx` (`src/steps/run-npx.ts`). Output is piped (hidden) by default and inherited when `--verbose` is set. On failure, `runNpx` re-throws with the tool's stderr/stdout as the error message. Fallback versions are hardcoded in `resolve-options.ts` (not the `^` ranges in `package.json`):

| Tool | Env var override | Hardcoded fallback |
|---|---|---|
| doctoc | `DOCTOC_PKG` | `doctoc@2.3.0` |
| @mermaid-js/mermaid-cli | `MERMAID_CLI_PKG` | `@mermaid-js/mermaid-cli@11.12.0` |
| md-to-pdf | `MD_TO_PDF_PKG` | `md-to-pdf@5.2.5` |

### Global wrapper (`bin/`)

`bin/md2pdf.ps1` resolves relative file paths against the caller's working directory before delegating to `pnpm --silent md2pdf`. `bin/md2pdf.cmd` delegates to the `.ps1`. Add `bin/` to `PATH` via `install.ps1`; remove via `uninstall.ps1`.

The wrapper classifies each CLI argument before forwarding it: path options (`-s`, `-o`, `-r`, and their long forms) have their value resolved to an absolute path; passthrough-value options (`--css-var`) have their value forwarded verbatim; flags and positional arguments are resolved as paths or passed as-is.
