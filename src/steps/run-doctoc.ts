import fs from 'fs';
import path from 'path';
import { ConversionContext, ConverterOptions } from '../types';
import { runNpx } from './run-npx';
import { isBlank, findFirstH2Index, findFrontmatterEnd } from './markdown-scan';

const DOCTOC_MARKER = '<!-- START doctoc generated TOC';
const DOCTOC_END_MARKER = '<!-- END doctoc generated TOC please keep comment here to allow auto update -->';

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
 * where doctoc put them.
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
    relocateTocBeforeFirstH2(context.inputMarkdown);
  }
}

/**
 * Removes the doctoc block `[startIdx, endIdx]` from `lines`, collapsing
 * the blank-line seam left behind so the removal doesn't produce a doubled
 * blank line.
 *
 * @param lines - Full document lines, without line terminators.
 * @param startIdx - Index of the doctoc start-marker line.
 * @param endIdx - Index of the doctoc end-marker line.
 * @returns The document lines with the block removed, and the removed
 *   block itself.
 */
function removeBlockCollapsingSeam(
  lines: string[],
  startIdx: number,
  endIdx: number,
): { withoutBlock: string[]; block: string[] } {
  const block = lines.slice(startIdx, endIdx + 1);
  let before = lines.slice(0, startIdx);
  let after = lines.slice(endIdx + 1);

  const hadBlankBefore = before.length > 0 && isBlank(before[before.length - 1]);
  const hadBlankAfter = after.length > 0 && isBlank(after[0]);

  while (before.length > 0 && isBlank(before[before.length - 1])) {
    before.pop();
  }
  while (after.length > 0 && isBlank(after[0])) {
    after.shift();
  }

  if (before.length > 0 && after.length > 0 && (hadBlankBefore || hadBlankAfter)) {
    before = before.concat(['']);
  }

  return { withoutBlock: before.concat(after), block };
}

/**
 * Re-inserts the doctoc block directly before `lines[h2Idx]`, ensuring
 * exactly one blank line on each side of the block (no leading blank when
 * the block lands at the very top of the file).
 *
 * @param lines - Document lines with the doctoc block already removed.
 * @param block - The doctoc block lines to re-insert.
 * @param h2Idx - Index (within `lines`) of the first `##`-equivalent heading.
 * @returns The document lines with the block re-inserted.
 */
function insertBlockBeforeIndex(lines: string[], block: string[], h2Idx: number): string[] {
  const before = lines.slice(0, h2Idx);
  const after = lines.slice(h2Idx);

  while (before.length > 0 && isBlank(before[before.length - 1])) {
    before.pop();
  }

  const result = [...before];
  if (before.length > 0) {
    result.push('');
  }
  result.push(...block);
  result.push('');
  result.push(...after);
  return result;
}

/**
 * Relocates a freshly created doctoc block so it sits directly before the
 * first second-order (`##`) heading in the file, instead of wherever
 * doctoc's own default placement chose (by default, near the top of the
 * file). No-ops when the file has no doctoc block, when no `##`-equivalent
 * heading exists anywhere in the document (doctoc's placement is left
 * untouched), or when the block is already directly before the first `##`
 * heading (the file is left byte-identical).
 *
 * A leading YAML frontmatter block (see {@link findFrontmatterEnd}) is
 * treated as opaque: it is excluded from the heading scan and the TOC
 * block is never inserted at or before its closing delimiter, even if a
 * frontmatter value line is immediately followed by a line of dashes that
 * would otherwise look like a setext heading underline.
 *
 * Only ever rewrites `filePath` in place; callers must only pass the temp
 * copy (`context.inputMarkdown`), never the user's source file.
 *
 * @param filePath - Markdown file to rewrite in place.
 */
function relocateTocBeforeFirstH2(filePath: string): void {
  const raw = fs.readFileSync(filePath, 'utf8');
  const eol = raw.includes('\r\n') ? '\r\n' : '\n';
  const hadTrailingNewline = raw.endsWith('\n');

  const lines = raw.split(/\r\n|\n/);
  if (hadTrailingNewline) {
    lines.pop();
  }

  const startIdx = lines.findIndex((line) => line.includes(DOCTOC_MARKER));
  if (startIdx === -1) {
    return;
  }

  const endIdx = lines.findIndex((line, i) => i >= startIdx && line.includes(DOCTOC_END_MARKER));
  if (endIdx === -1) {
    return;
  }

  const { withoutBlock, block } = removeBlockCollapsingSeam(lines, startIdx, endIdx);

  // Frontmatter detection runs on `withoutBlock` (post-removal), so it
  // stays correct even if doctoc's block had ended up inside or right
  // after the frontmatter: removal never shifts the leading lines, so the
  // frontmatter's own indices are unaffected either way.
  const frontmatterEnd = findFrontmatterEnd(withoutBlock);
  const searchStart = frontmatterEnd === -1 ? 0 : frontmatterEnd + 1;

  const relativeH2Idx = findFirstH2Index(withoutBlock.slice(searchStart));
  if (relativeH2Idx === -1) {
    // No `##`-equivalent heading anywhere in the searchable region (either
    // no such heading exists, or the document is frontmatter-only): leave
    // doctoc's own placement untouched.
    return;
  }
  const h2Idx = searchStart + relativeH2Idx;

  const finalLines = insertBlockBeforeIndex(withoutBlock, block, h2Idx);
  const finalContent = finalLines.join(eol) + (hadTrailingNewline ? eol : '');

  if (finalContent !== raw) {
    fs.writeFileSync(filePath, finalContent);
  }
}
