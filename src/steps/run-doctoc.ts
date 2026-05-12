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
 * Refreshes or creates a table of contents on a temporary Markdown copy.
 *
 * The original source file is never modified.
 *
 * @param context - Mutable conversion state for the current source file.
 */
export function runDoctoc(context: ConversionContext): void {
  const shouldRun = context.options.forceDoctoc || hasTocMarkers(context.sourceFile);
  if (!shouldRun) {
    return;
  }

  context.inputMarkdown = path.join(context.workdir, context.baseName);
  fs.copyFileSync(context.sourceFile, context.inputMarkdown);
  console.log(`Running doctoc on ${context.inputMarkdown}...`);
  runNpx([context.options.packages.doctoc, context.inputMarkdown]);
}
