#!/usr/bin/env node

import fs from 'fs';
import os from 'os';
import path from 'path';
import { program } from 'commander';
import { cleanup } from './steps/cleanup';
import { copyOutput } from './steps/copy-output';
import { resolveStylesheet } from './steps/resolve-stylesheet';
import { extractTitle } from './steps/extract-title';
import { prepareWorkdir } from './steps/prepare-workdir';
import { hasMermaidFences, renderMermaid } from './steps/render-mermaid';
import { renderPdf } from './steps/render-pdf';
import { resolveOptions, collect } from './steps/resolve-options';
import { runDoctoc, shouldRunDoctoc } from './steps/run-doctoc';
import { ConverterOptions } from './types';

program
  .name('md2pdf')
  .description('Render Mermaid diagrams and convert Markdown to PDF')
  .argument('[files...]', 'Markdown files to convert')
  .option('-s, --stylesheet <path>', 'Stylesheet passed to md-to-pdf')
  .option('--css-var <name=value>', 'Override a CSS custom property, repeatable', collect, [])
  .option('-o, --output-dir <path>', 'Output directory for PDFs')
  .option('-r, --temp-root <path>', 'Root directory for temp work dirs')
  .option('-p, --temp-in-output', 'Place temp dir inside the output directory')
  .option('-f, --force-doctoc', 'Force doctoc even when no TOC markers are present')
  .option('-u, --update-md-toc', 'Update an existing doctoc table of contents in the source Markdown')
  .option('-k, --keep-temp', 'Keep temp working directory')
  .option('--verbose', 'Print output from external conversion tools')
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

  // Resolve the effective stylesheet once for all files.
  const cssTempDir = options.cssVars.length > 0
    ? fs.mkdtempSync(path.join(os.tmpdir(), 'md2pdf_css_'))
    : undefined;

  let convertedCount = 0;
  let failedCount = 0;

  try {
    const effectiveStylesheet = resolveStylesheet(options, cssTempDir ?? os.tmpdir());

    for (const file of program.args) {
      log.info(path.resolve(file));

      const context = runStep('Preparing workspace', () => prepareWorkdir(file, options));
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
        runStep('Extracting document title', () => extractTitle(context));
        if (hasMermaidFences(context.sourceFile)) {
          runStep('Rendering Mermaid diagrams', () => renderMermaid(context));
        } else {
          fs.copyFileSync(context.inputMarkdown, context.convertedMarkdown);
        }
        runStep('Rendering PDF', () => renderPdf(context));
        runStep('Copying output', () => copyOutput(context));

        log.success(`Created ${context.outputPdf}`);
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
    if (cssTempDir) {
      fs.rmSync(cssTempDir, { recursive: true, force: true });
    }
  }

  if (failedCount > 0) {
    outro(`${convertedCount} converted, ${failedCount} failed`);
    process.exit(1);
  }

  outro(`${convertedCount} converted`);
}
