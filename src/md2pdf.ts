#!/usr/bin/env node

import fs from 'fs';
import os from 'os';
import path from 'path';
import { program } from 'commander';
import { cleanup } from './steps/cleanup';
import { copyOutput } from './steps/copy-output';
import { MergedInput, mergeMarkdown } from './steps/merge-markdown';
import { resolveInputs } from './steps/resolve-inputs';
import { resolveStylesheet } from './steps/resolve-stylesheet';
import { extractTitle } from './steps/extract-title';
import { inlineAssets } from './steps/inline-assets';
import { prepareWorkdir } from './steps/prepare-workdir';
import { hasMermaidFences, renderMermaid } from './steps/render-mermaid';
import { renderHtml } from './steps/render-html';
import { renderPdf } from './steps/render-pdf';
import { resolveOptions, collect } from './steps/resolve-options';
import { runDoctoc, shouldRunDoctoc } from './steps/run-doctoc';
import { describeStylesheet } from './steps/stylesheet-lookup';
import { ConverterOptions } from './types';

program
  .name('md2pdf')
  .description('Render Mermaid diagrams and convert Markdown to PDF')
  .argument('[files...]', 'Markdown files or directories to convert')
  .option('-R, --recursive', 'Expand directory arguments recursively')
  .option('--merge <name>', 'Merge all resolved Markdown files into a single PDF with this base name')
  .option(
    '-s, --stylesheet <path>',
    'Stylesheet path, or the name of a stylesheet in ~/.md2pdf (".css" optional); "default" forces the bundled one',
  )
  .option('--css-var <name=value>', 'Override a CSS custom property, repeatable', collect, [])
  .option('-o, --output-dir <path>', 'Output directory for PDFs')
  .option('-r, --temp-root <path>', 'Root directory for temp work dirs')
  .option('-p, --temp-in-output', 'Place temp dir inside the output directory')
  .option('-f, --force-doctoc', 'Force doctoc even when no TOC markers are present')
  .option('-u, --update-md-toc', 'Update an existing doctoc table of contents in the source Markdown')
  .option('-k, --keep-temp', 'Keep temp working directory')
  .option('--verbose', 'Print output from external conversion tools')
  .option('--debug', 'Also emit a standalone HTML file next to the PDF')
  .option('--png', 'Render Mermaid diagrams as PNG instead of SVG')
  .parse(process.argv);

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
    skippedCount = merged.skipped.length;
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
  let failedCount = 0;

  try {
    const effectiveStylesheet = resolveStylesheet(options, cssTempDir);

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
