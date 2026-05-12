#!/usr/bin/env node

import { program } from 'commander';
import { cleanup } from './steps/cleanup';
import { copyOutput } from './steps/copy-output';
import { createStylesheet } from './steps/create-stylesheet';
import { extractTitle } from './steps/extract-title';
import { prepareWorkdir } from './steps/prepare-workdir';
import { renderMermaid } from './steps/render-mermaid';
import { renderPdf } from './steps/render-pdf';
import { resolveOptions, collect } from './steps/resolve-options';
import { runDoctoc } from './steps/run-doctoc';
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
  .parse(process.argv);

if (program.args.length === 0) {
  program.help();
}

let options: ConverterOptions;
try {
  options = resolveOptions(program);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

for (const file of program.args) {
  const context = prepareWorkdir(file, options);
  if (!context) {
    continue;
  }

  try {
    runDoctoc(context);
    extractTitle(context);
    renderMermaid(context);
    createStylesheet(context);
    renderPdf(context);
    copyOutput(context);
  } finally {
    cleanup(context);
  }
}
