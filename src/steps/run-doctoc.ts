import fs from 'fs';
import path from 'path';
import { ConversionContext } from '../types';
import { runNpx } from './run-npx';

const DOCTOC_MARKER = '<!-- START doctoc generated TOC';

/**
 * Checks whether a Markdown file contains doctoc-managed TOC markers.
 *
 * @param filePath - Markdown file to inspect.
 * @returns `true` when doctoc should refresh an existing TOC.
 */
function hasTocMarkers(filePath: string): boolean {
  return fs.readFileSync(filePath, 'utf8').includes(DOCTOC_MARKER);
}

/**
 * Refreshes or creates a table of contents for the conversion input.
 *
 * The source Markdown is updated only when `--update-md-toc` is set and
 * doctoc markers already exist in the original file.
 *
 * @param context - Mutable conversion state for the current source file.
 */
export function runDoctoc(context: ConversionContext): void {
  const sourceHasToc = hasTocMarkers(context.sourceFile);
  const shouldRun = context.options.forceDoctoc || sourceHasToc;
  if (!shouldRun) {
    return;
  }

  if (context.options.updateMdToc && sourceHasToc) {
    console.log(`Updating doctoc in ${context.sourceFile}...`);
    runNpx([context.options.packages.doctoc, context.sourceFile]);
  }

  context.inputMarkdown = path.join(context.workdir, context.baseName);
  fs.copyFileSync(context.sourceFile, context.inputMarkdown);

  if (!context.options.updateMdToc || !sourceHasToc) {
    console.log(`Running doctoc on ${context.inputMarkdown}...`);
    runNpx([context.options.packages.doctoc, context.inputMarkdown]);
  }
}
