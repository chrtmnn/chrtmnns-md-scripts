import fs from 'fs';
import path from 'path';
import { ConversionContext, ConverterOptions } from '../types';
import { runNpx } from './run-npx';

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
 * Line-ending-preserving check for a blank (whitespace-only) line.
 *
 * @param line - Single line of Markdown, without its line terminator.
 * @returns `true` when the line contains only whitespace.
 */
function isBlank(line: string): boolean {
  return line.trim().length === 0;
}

/**
 * Detects a fenced-code-block delimiter line (``` or ~~~, indented up to 3
 * spaces, 3 or more delimiter characters).
 *
 * @param line - Single line of Markdown, without its line terminator.
 * @returns The delimiter character and run length, or `null` when the line
 *   is not a fence delimiter.
 */
function matchFenceDelimiter(line: string): { char: string; len: number } | null {
  const match = /^ {0,3}(`{3,}|~{3,})/.exec(line);
  if (!match) {
    return null;
  }
  const delimiter = match[1];
  return { char: delimiter[0], len: delimiter.length };
}

/**
 * Checks whether a line is an ATX second-order heading (`## ...`).
 *
 * @param line - Single line of Markdown, without its line terminator.
 * @returns `true` when the line is exactly a `##` heading.
 */
function isAtxH2(line: string): boolean {
  return /^ {0,3}##(?:[ \t]|$)/.test(line);
}

/**
 * Checks whether a line could plausibly be the text of a setext heading,
 * i.e. it isn't blank and doesn't look like the start of some other block
 * (ATX heading, fence, list item, blockquote). This is a heuristic, not a
 * full CommonMark block-start disambiguation.
 *
 * @param line - Single line of Markdown, without its line terminator.
 * @returns `true` when the line could be setext heading text.
 */
function isPotentialSetextText(line: string): boolean {
  if (isBlank(line)) {
    return false;
  }
  if (/^ {0,3}#/.test(line)) {
    return false;
  }
  if (matchFenceDelimiter(line)) {
    return false;
  }
  if (/^ {0,3}[-*+] /.test(line)) {
    return false;
  }
  if (/^ {0,3}\d+[.)] /.test(line)) {
    return false;
  }
  if (/^ {0,3}>/.test(line)) {
    return false;
  }
  return true;
}

/**
 * Checks whether a line is a setext second-order-heading underline (a run
 * of one or more `-` characters, optionally indented and trailed by
 * whitespace).
 *
 * @param line - Single line of Markdown, without its line terminator.
 * @returns `true` when the line is a setext `-` underline.
 */
function isSetextH2Underline(line: string): boolean {
  return /^ {0,3}-+[ \t]*$/.test(line);
}

/**
 * Finds the first second-order heading in a fence-aware scan of the
 * document, recognising both ATX (`## ...`) and setext (text line followed
 * by a `---` underline) headings. Lines inside fenced code blocks (```/~~~,
 * closed only by a matching or longer run of the same character) are
 * ignored.
 *
 * @param lines - Document lines, without line terminators.
 * @returns The index of the first `##`-equivalent heading line, or `-1`
 *   when none exists.
 */
function findFirstH2Index(lines: string[]): number {
  let fenceChar: string | null = null;
  let fenceLen = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fence = matchFenceDelimiter(line);

    if (fence) {
      if (fenceChar === null) {
        fenceChar = fence.char;
        fenceLen = fence.len;
      } else if (fence.char === fenceChar && fence.len >= fenceLen) {
        fenceChar = null;
        fenceLen = 0;
      }
      continue;
    }

    if (fenceChar !== null) {
      continue;
    }

    if (isAtxH2(line)) {
      return i;
    }

    if (i + 1 < lines.length && isPotentialSetextText(line) && isSetextH2Underline(lines[i + 1])) {
      return i;
    }
  }

  return -1;
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
 * Detects a leading YAML frontmatter block (as supported by md-to-pdf's
 * underlying front-matter parser): the very first line must be exactly
 * `---` (no leading indentation, trailing whitespace allowed), closed by a
 * later line that is exactly `---` or `...`.
 *
 * @param lines - Document lines, without line terminators.
 * @returns The index of the closing delimiter line, or `-1` when the
 *   document has no leading frontmatter block (including the degenerate
 *   case of an unterminated leading `---`, which is treated as no
 *   frontmatter rather than swallowing the rest of the file).
 */
function findFrontmatterEnd(lines: string[]): number {
  if (lines.length === 0 || !/^---[ \t]*$/.test(lines[0])) {
    return -1;
  }

  for (let i = 1; i < lines.length; i++) {
    if (/^(?:---|\.\.\.)[ \t]*$/.test(lines[i])) {
      return i;
    }
  }

  return -1;
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
