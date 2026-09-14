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
  const { intro, log, outro, spinner } = await import('@clack/prompts');

  function runStep<T>(label: string, action: () => T): T {
    if (options.verbose) {
      log.info(label);
      try {
        const result = action();
        log.success(label);
        return result;
      } catch (error) {
        // The spinner branch marks a failed step; without this the verbose
        // output ended on the plain "started" line (#51).
        log.error(`${label} failed`);
        throw error;
      }
    }

    const step = spinner();
    step.start(label);

    try {
      const result = action();
      step.stop(label);
      return result;
    } catch (error) {
      step.stop(`${label} failed`);
      throw error;
    }
  }

  intro('md2pdf');

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
      log.info(merged ? `${merged.mergedCount} documents merged` : path.resolve(file));

      // Inside the try, so a failure here fails this file like any other step
      // instead of aborting the whole run, leaking the work directory and
      // skipping the summary (#51).
      let context: ConversionContext | undefined;

      try {
        context = runStep('Preparing workspace', () => prepareWorkdir(file, runOptions));
        if (!context) {
          log.warn(`Skipped missing file: ${file}`);
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
        if (options.updateMdToc && scanDoctocMarkers(fs.readFileSync(active.sourceFile, 'utf8')).kind === 'none') {
          log.warn(describeMissingMarkerBlock(active.sourceFile, options.forceDoctoc));
        }
        if (shouldRunDoctoc(options, active.sourceFile)) {
          runStep('Table of contents', () => runDoctoc(active));
        }
        if (!merged) {
          // A merged run keeps the `--merge` name as its document title,
          // which prepareWorkdir already derived from the merged file name.
          runStep('Extracting document title', () => extractTitle(active));
        }
        // `inputMarkdown` rather than the source file: that is what
        // renderMermaid reads, and doctoc may have replaced it with the temp
        // copy in between (#51).
        if (hasMermaidFences(active.inputMarkdown)) {
          runStep('Rendering Mermaid diagrams', () => renderMermaid(active));
        } else {
          // Wrapped like every other step, so it gets the same spinner and
          // failure marker instead of happening silently.
          runStep('Preparing Markdown', () => fs.copyFileSync(active.inputMarkdown, active.convertedMarkdown));
        }
        // md-to-pdf renders from a server rooted at the work directory, so
        // the document's own assets have to be carried into the converted
        // Markdown before it runs.
        runStep('Embedding assets', () => inlineAssets(active)).forEach((warning) => log.warn(warning));
        runStep('Rendering PDF', () => renderPdf(active));
        if (options.debug) {
          runStep('Rendering debug HTML', () => renderHtml(active));
        }
        runStep('Copying output', () => copyOutput(active));

        log.success(`Created ${active.outputPdf}`);
        if (options.debug) {
          log.success(`Created ${active.outputHtml}`);
        }
        convertedCount++;
      } catch (error) {
        log.error(formatError(error));
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
