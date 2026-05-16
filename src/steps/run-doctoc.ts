import fs from 'fs';
import path from 'path';
import { ConversionContext, ConverterOptions } from '../types';
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
 * Decides whether the doctoc step needs to run for a given source file.
 *
 * @param options - Converter options carrying the `--force-doctoc` flag.
 * @param sourceFile - Absolute path to the source Markdown file.
 * @returns `true` when doctoc must process the file, `false` otherwise.
 */
export function shouldRunDoctoc(options: ConverterOptions, sourceFile: string): boolean {
  return options.forceDoctoc || hasTocMarkers(sourceFile);
}

/**
 * Refreshes or creates a table of contents for the conversion input.
 *
 * The source Markdown is updated only when `--update-md-toc` is set and
 * doctoc markers already exist in the original file. Callers should gate
 * this step with {@link shouldRunDoctoc}.
 *
 * @param context - Mutable conversion state for the current source file.
 */
export function runDoctoc(context: ConversionContext): void {
  const sourceHasToc = hasTocMarkers(context.sourceFile);

  if (context.options.updateMdToc && sourceHasToc) {
    runNpx([context.options.packages.doctoc, context.sourceFile], { verbose: context.options.verbose });
  }

  context.inputMarkdown = path.join(context.workdir, context.baseName);
  fs.copyFileSync(context.sourceFile, context.inputMarkdown);

  if (!context.options.updateMdToc || !sourceHasToc) {
    runNpx([context.options.packages.doctoc, context.inputMarkdown], { verbose: context.options.verbose });
  }
}
