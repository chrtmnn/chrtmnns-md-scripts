import fs from 'fs';
import path from 'path';
import { ConversionContext, ConverterOptions } from '../types';
import { runNpx } from './run-npx';
import { DOCTOC_MARKER, relocateTocBeforeFirstH2 } from './toc-placement';

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
 * When doctoc creates a brand-new TOC (no markers existed in the source
 * file yet, i.e. the `--force-doctoc` case), the generated block is
 * relocated to sit directly before the first second-order (`##`) heading
 * in the temp copy. Refreshes of an already-existing TOC are left exactly
 * where doctoc put them. The placement rules themselves live in
 * {@link relocateTocBeforeFirstH2}; this step only applies them to the temp
 * copy, never to `context.sourceFile`.
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

  // Only a freshly created TOC gets relocated. If markers already existed in
  // the source file, doctoc only refreshed the block in place (on the temp
  // copy, or on `context.sourceFile` above when `--update-md-toc` applies)
  // and it must not move. This never touches `context.sourceFile`.
  if (!sourceHasToc) {
    relocateTocInFile(context.inputMarkdown);
  }
}

/**
 * Applies {@link relocateTocBeforeFirstH2} to a file in place, writing only
 * when the relocation actually changed something so an already correctly
 * placed TOC leaves the file byte-identical.
 *
 * Only ever rewrites `filePath` in place; callers must only pass the temp
 * copy (`context.inputMarkdown`), never the user's source file.
 *
 * @param filePath - Markdown file to rewrite in place.
 */
function relocateTocInFile(filePath: string): void {
  const raw = fs.readFileSync(filePath, 'utf8');
  const relocated = relocateTocBeforeFirstH2(raw);

  if (relocated !== raw) {
    fs.writeFileSync(filePath, relocated);
  }
}
