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
import { runDoctoc, shouldRunDoctoc } from './steps/run-doctoc';
import { describeStylesheet } from './steps/stylesheet-lookup';
import { ConverterOptions } from './types';

const program = createProgram().parse(process.argv);

if (program.args.length === 0) {
  program.help();
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
      const result = action();
      log.success(label);
      return result;
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

  // `--merge` concatenates the resolved Markdown before rendering and then
  // feeds the pipeline a single file, so every other flag keeps working
  // unchanged and doctoc produces one TOC spanning all documents.
  let merged: MergedInput | undefined;
  let runOptions = options;
  let filesToConvert = inputs.files;
  let skippedCount = 0;

  if (options.merge) {
    if (inputs.files.length === 0) {
      log.error('Nothing to merge: no Markdown files were resolved from the given arguments.');
      outro('Merge failed');
      process.exit(1);
    }

    merged = runStep('Merging Markdown files', () => mergeMarkdown(inputs.files, options));
    merged.warnings.forEach((warning) => log.warn(warning));
    merged.skipped.forEach((file) => log.warn(`Skipped missing file: ${file}`));
    skippedCount = merged.skipped.length + inputs.rejected.length;
    filesToConvert = [merged.mergedFile];

    // The merged file lives in a temp directory, so the target directory has
    // to be pinned explicitly instead of being derived from its location:
    // `-o` when given, otherwise the common ancestor of the inputs.
    runOptions = { ...options, outputDir: merged.targetDir };
  }

  // Resolve the effective stylesheet once for all files. The temp dir receives
  // the self-contained copy when the stylesheet has local references to
  // inline or overrides to append, and stays empty otherwise.
  const cssTempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'md2pdf_css_'));

  let convertedCount = 0;
  // Rejected non-Markdown positionals count like missing files; a merged run
  // reports them through skippedCount instead.
  let failedCount = merged ? 0 : inputs.rejected.length;

  try {
    const effectiveStylesheet = resolveStylesheet(options, cssTempDir);

    // An override the stylesheet never reads is written out and ignored by
    // the browser, which a typo in the name would otherwise leave invisible.
    if (effectiveStylesheet && options.cssVars.length > 0) {
      const css = fs.readFileSync(effectiveStylesheet, 'utf8');
      findUnusedCssVars(css, options.cssVars).forEach((name) => log.warn(describeUnusedCssVar(name)));
    }

    for (const file of filesToConvert) {
      log.info(merged ? `${merged.mergedCount} documents merged` : path.resolve(file));

      const context = runStep('Preparing workspace', () => prepareWorkdir(file, runOptions));
      if (!context) {
        log.warn(`Skipped missing file: ${file}`);
        failedCount++;
        continue;
      }

      context.effectiveStylesheet = effectiveStylesheet;

      try {
        // Checked before `-u` can write back to the source and before any
        // rendering, so a protected output fails the file without side effects.
        assertOutputReplaceable(context);
        // `-u` only refreshes an existing marker block. A broken pair is
        // reported by runDoctoc, and a merged run cannot carry `-u`.
        if (options.updateMdToc && scanDoctocMarkers(fs.readFileSync(context.sourceFile, 'utf8')).kind === 'none') {
          log.warn(describeMissingMarkerBlock(context.sourceFile, options.forceDoctoc));
        }
        if (shouldRunDoctoc(options, context.sourceFile)) {
          runStep('Table of contents', () => runDoctoc(context));
        }
        if (!merged) {
          // A merged run keeps the `--merge` name as its document title,
          // which prepareWorkdir already derived from the merged file name.
          runStep('Extracting document title', () => extractTitle(context));
        }
        if (hasMermaidFences(context.sourceFile)) {
          runStep('Rendering Mermaid diagrams', () => renderMermaid(context));
        } else {
          fs.copyFileSync(context.inputMarkdown, context.convertedMarkdown);
        }
        // md-to-pdf renders from a server rooted at the work directory, so
        // the document's own assets have to be carried into the converted
        // Markdown before it runs.
        runStep('Embedding assets', () => inlineAssets(context)).forEach((warning) => log.warn(warning));
        runStep('Rendering PDF', () => renderPdf(context));
        if (options.debug) {
          runStep('Rendering debug HTML', () => renderHtml(context));
        }
        runStep('Copying output', () => copyOutput(context));

        log.success(`Created ${context.outputPdf}`);
        if (options.debug) {
          log.success(`Created ${context.outputHtml}`);
        }
        convertedCount++;
      } catch (error) {
        log.error(formatError(error));
        failedCount++;
      } finally {
        cleanup(context);
        if (context.options.keepTemp) {
          log.info(`Temp kept at ${context.workdir}`);
        }
      }
    }
  } finally {
    fs.rmSync(cssTempDir, { recursive: true, force: true });

    if (merged) {
      if (options.keepTemp) {
        log.info(`Merged Markdown kept at ${merged.mergedFile}`);
      } else {
        fs.rmSync(merged.mergeDir, { recursive: true, force: true });
      }
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
