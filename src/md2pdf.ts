#!/usr/bin/env node

import fs from 'fs';
import os from 'os';
import path from 'path';
import { createProgram } from './cli-program';
import { cleanup } from './steps/cleanup';
import { assertOutputReplaceable, copyOutput } from './steps/copy-output';
import { describeUnusedCssVar, findUnusedCssVars } from './steps/css-var-usage';
import { describeMissingMarkerBlock, scanDoctocMarkers } from './steps/doctoc-markers';
import { MergedInput, mergeMarkdown } from './steps/merge-markdown';
import { describeOutputCollisions, findOutputCollisions } from './steps/output-targets';
import { resolveInputs } from './steps/resolve-inputs';
import { resolveStylesheet } from './steps/resolve-stylesheet';
import { extractTitle } from './steps/extract-title';
import { inlineAssets } from './steps/inline-assets';
import { prepareWorkdir } from './steps/prepare-workdir';
import { hasMermaidFences, renderMermaid } from './steps/render-mermaid';
import { renderHtml } from './steps/render-html';
import { renderPdf } from './steps/render-pdf';
import { resolveOptions } from './steps/resolve-options';
import { createStatusLine } from './steps/status-line';
import { createTempRegistry } from './steps/temp-registry';
import { runDoctoc, shouldRunDoctoc } from './steps/run-doctoc';
import { describeStylesheet } from './steps/stylesheet-lookup';
import { ConversionContext, ConverterOptions } from './types';

const program = createProgram().parse(process.argv);

if (program.args.length === 0) {
  // `error: true` sends the help to stderr and exits 1: invoking the tool
  // with no arguments is a usage error, not a successful run (#51).
  program.help({ error: true });
}

let options: ConverterOptions;
try {
  options = resolveOptions(program);
} catch (error) {
  console.error(formatError(error));
  process.exit(1);
}

void run(options).catch((error) => {
  console.error(formatError(error));
  process.exit(1);
});

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function run(options: ConverterOptions): Promise<void> {
  const { S_STEP_ACTIVE, intro, isTTY, log, outro } = await import('@clack/prompts');

  // The live line only makes sense on a terminal: piped into a file or a CI
  // log its escape sequences would end up in the output, and `--verbose` wants
  // a durable line per step rather than one that is overwritten (#59).
  const interactive = isTTY(process.stdout) && !options.verbose;
  const status = createStatusLine(process.stdout, interactive);

  /**
   * Shows what is running right now, in clack's own line shape.
   *
   * @param text - Step description, already prefixed with the file name.
   */
  function showStatus(text: string): void {
    status.show(`${S_STEP_ACTIVE}  ${text}`);
  }

  function runStep<T>(label: string, action: () => T): T {
    if (options.verbose) {
      log.info(label);
    }
    showStatus(label);

    try {
      const result = action();
      if (options.verbose) {
        log.success(label);
      }
      status.hide();
      return result;
    } catch (error) {
      status.hide();
      // Without this the output ended on the plain "started" line (#51).
      log.error(`${label} failed`);
      throw error;
    }
  }

  /**
   * One live line for a whole file, naming the step in progress.
   *
   * Seven persistent lines per file buried the warnings in a 30-file run
   * (#59), so the steps share a single line that is rewritten in place and
   * ends as `Created <pdf>`; the per-step lines come back with `--verbose`.
   */
  function fileProgress(name: string) {
    showStatus(name);

    return {
      /** Runs one pipeline step, naming it on this file's line. */
      run<T>(label: string, action: () => T): T {
        if (options.verbose) {
          log.info(`${name} · ${label}`);
        }
        showStatus(`${name} · ${label}`);

        try {
          const result = action();
          if (options.verbose) {
            log.success(`${name} · ${label}`);
          }
          return result;
        } catch (error) {
          status.hide();
          if (!interactive) {
            log.error(`${name} · ${label} failed`);
          }
          throw error;
        }
      },
      /** Reports a non-fatal problem without disturbing the live line. */
      warn(message: string): void {
        status.hide();
        log.warn(message);
      },
      /** Ends the file with a success message. */
      done(message: string): void {
        status.hide();
        log.success(message);
      },
      /** Ends the file with a failure message. */
      failed(message: string): void {
        status.hide();
        log.error(message);
      },
      /** Ends the file with a neutral message, for a skipped file. */
      skipped(message: string): void {
        status.hide();
        log.warn(message);
      },
    };
  }

  intro('md2pdf');

  // A retired `--css-var` name still works but is translated, which the user
  // has to be told about to migrate the command line (#59).
  options.cssVarWarnings.forEach((warning) => log.warn(warning));

  // A personal ~/.md2pdf/default.css replaces the bundled stylesheet without
  // any flag, so --verbose says which one is in use and why.
  if (options.verbose) {
    log.info(describeStylesheet({ path: options.stylesheet, origin: options.stylesheetOrigin }));
  }

  // Positional arguments may be files or directories; expand them into the
  // concrete list of Markdown files before anything else runs.
  const inputs = runStep('Resolving input files', () => resolveInputs(program.args, options));
  inputs.warnings.forEach((warning) => log.warn(warning));
  inputs.rejected.forEach((file) => log.warn(`Skipped non-Markdown file: ${file}`));

  // Every output path is known before anything is written, so a collision
  // aborts the run instead of letting a later file silently replace an
  // earlier one's output. A merged run writes a single output. Missing files
  // write nothing and are reported later.
  if (!options.merge) {
    const collisions = findOutputCollisions(
      inputs.files.filter((file) => fs.existsSync(file)),
      options.outputDir,
    );
    if (collisions.length > 0) {
      log.error(describeOutputCollisions(collisions));
      outro('Conversion aborted');
      process.exit(1);
    }
  }

  // Checked before any temp directory exists, so the early exit cannot leak
  // one: `process.exit` does not run `finally` blocks.
  if (options.merge && inputs.files.length === 0) {
    log.error('Nothing to merge: no Markdown files were resolved from the given arguments.');
    outro('Merge failed');
    process.exit(1);
  }

  // `finally` covers a failure but not a signal, so every live temp directory
  // is registered and removed on Ctrl-C as well (#51). While an external tool
  // runs, `execFileSync` blocks the event loop and the handler only fires once
  // that child has exited — which the same Ctrl-C asks it to do, since the
  // signal reaches the whole process group.
  const tempDirs = createTempRegistry(
    (directory) => fs.rmSync(directory, { recursive: true, force: true }),
    options.keepTemp,
  );

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      status.hide();
      tempDirs.removeAll();
      // 128 + signal number, the shell convention for a terminated process.
      process.exit(signal === 'SIGINT' ? 130 : 143);
    });
  }

  // `--merge` concatenates the resolved Markdown before rendering and then
  // feeds the pipeline a single file, so every other flag keeps working
  // unchanged and doctoc produces one TOC spanning all documents.
  let merged: MergedInput | undefined;
  let runOptions = options;
  let filesToConvert = inputs.files;
  let skippedCount = 0;
  let convertedCount = 0;
  // Rejected non-Markdown positionals count like missing files; a merged run
  // reports them through skippedCount instead.
  let failedCount = options.merge ? 0 : inputs.rejected.length;

  // Resolve the effective stylesheet once for all files. The temp dir receives
  // the self-contained copy when the stylesheet has local references to
  // inline or overrides to append, and stays empty otherwise.
  const cssTempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'md2pdf_css_'));
  tempDirs.register(cssTempDir);

  try {
    if (options.merge) {
      merged = runStep('Merging Markdown files', () => mergeMarkdown(inputs.files, options));
      tempDirs.register(merged.mergeDir);
      merged.warnings.forEach((warning) => log.warn(warning));
      merged.skipped.forEach((file) => log.warn(`Skipped missing file: ${file}`));
      skippedCount = merged.skipped.length + inputs.rejected.length;
      filesToConvert = [merged.mergedFile];

      // The merged file lives in a temp directory, so the target directory has
      // to be pinned explicitly instead of being derived from its location:
      // `-o` when given, otherwise the common ancestor of the inputs.
      runOptions = { ...options, outputDir: merged.targetDir };
    }

    const effectiveStylesheet = resolveStylesheet(options, cssTempDir);

    // An override the stylesheet never reads is written out and ignored by
    // the browser, which a typo in the name would otherwise leave invisible.
    if (effectiveStylesheet && options.cssVars.length > 0) {
      const css = fs.readFileSync(effectiveStylesheet, 'utf8');
      findUnusedCssVars(css, options.cssVars).forEach((name) => log.warn(describeUnusedCssVar(name)));
    }

    for (const file of filesToConvert) {
      const progress = fileProgress(merged ? `${merged.mergedCount} documents merged` : path.basename(file));

      // Inside the try, so a failure here fails this file like any other step
      // instead of aborting the whole run, leaking the work directory and
      // skipping the summary (#51).
      let context: ConversionContext | undefined;

      try {
        context = progress.run('Preparing workspace', () => prepareWorkdir(file, runOptions));
        if (!context) {
          progress.skipped(`Skipped missing file: ${file}`);
          failedCount++;
          continue;
        }

        tempDirs.register(context.workdir);

        // Narrowed once, so the steps below keep a definitely-defined context
        // after the `continue` above.
        const active = context;
        active.effectiveStylesheet = effectiveStylesheet;

        // Checked before `-u` can write back to the source and before any
        // rendering, so a protected output fails the file without side effects.
        assertOutputReplaceable(active);
        // `-u` only refreshes an existing marker block. A broken pair is
        // reported by runDoctoc, and a merged run cannot carry `-u`.
        if (options.writeToc && scanDoctocMarkers(fs.readFileSync(active.sourceFile, 'utf8')).kind === 'none') {
          progress.warn(describeMissingMarkerBlock(active.sourceFile, options.toc === 'always'));
        }
        if (shouldRunDoctoc(options, active.sourceFile)) {
          progress.run('Table of contents', () => runDoctoc(active));
        }
        if (options.title) {
          // An explicit title beats both the first heading and the name a
          // merged run derives from `--merge` (#59).
          active.docTitle = options.title;
        } else if (!merged) {
          // A merged run keeps the `--merge` name as its document title,
          // which prepareWorkdir already derived from the merged file name.
          progress.run('Extracting document title', () => extractTitle(active));
        }
        // `inputMarkdown` rather than the source file: that is what
        // renderMermaid reads, and doctoc may have replaced it with the temp
        // copy in between (#51).
        if (hasMermaidFences(active.inputMarkdown)) {
          progress.run('Rendering Mermaid diagrams', () => renderMermaid(active));
        } else {
          // Wrapped like every other step, so it gets the same spinner and
          // failure marker instead of happening silently.
          progress.run('Preparing Markdown', () => fs.copyFileSync(active.inputMarkdown, active.convertedMarkdown));
        }
        // md-to-pdf renders from a server rooted at the work directory, so
        // the document's own assets have to be carried into the converted
        // Markdown before it runs.
        progress.run('Embedding assets', () => inlineAssets(active)).forEach((warning) => progress.warn(warning));
        progress.run('Rendering PDF', () => renderPdf(active));
        if (options.html) {
          progress.run('Rendering HTML', () => renderHtml(active));
        }
        progress.run('Copying output', () => copyOutput(active));

        progress.done(`Created ${active.outputPdf}`);
        if (options.html) {
          log.success(`Created ${active.outputHtml}`);
        }
        convertedCount++;
      } catch (error) {
        progress.failed(formatError(error));
        failedCount++;
      } finally {
        if (context) {
          cleanup(context);
          tempDirs.unregister(context.workdir);
          if (options.keepTemp) {
            log.info(`Temp kept at ${context.workdir}`);
          }
        }
      }
    }
  } finally {
    if (options.keepTemp) {
      // `-k` keeps the stylesheet that was actually used, without which the
      // kept work directory cannot reproduce the run (#51).
      log.info(`Effective stylesheet kept at ${cssTempDir}`);
      if (merged) {
        log.info(`Merged Markdown kept at ${merged.mergedFile}`);
      }
    } else {
      fs.rmSync(cssTempDir, { recursive: true, force: true });
      if (merged) {
        fs.rmSync(merged.mergeDir, { recursive: true, force: true });
      }
    }

    tempDirs.unregister(cssTempDir);
    if (merged) {
      tempDirs.unregister(merged.mergeDir);
    }
  }

  if (merged) {
    if (convertedCount === 0) {
      outro('Merge failed');
      process.exit(1);
    }

    const mergedPdf = `${options.merge}.pdf`;
    if (skippedCount > 0) {
      outro(`${merged.mergedCount} merged into ${mergedPdf}, ${skippedCount} skipped`);
      process.exit(1);
    }

    outro(`${merged.mergedCount} merged into ${mergedPdf}`);
    return;
  }

  if (failedCount > 0) {
    outro(`${convertedCount} converted, ${failedCount} failed`);
    process.exit(1);
  }

  outro(`${convertedCount} converted`);
}
