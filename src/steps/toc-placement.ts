/**
 * Pure text transformation behind the TOC relocation performed by
 * `run-doctoc.ts`. Kept separate from that file so the placement rules —
 * blank-line hygiene, line-ending preservation and the byte-identical no-op —
 * can be exercised as plain string in / string out, without doctoc, `npx`, or
 * a temp directory. `run-doctoc.ts` owns the file I/O; this module owns the
 * rules.
 */

import { isBlank, findFirstH2Index, findFrontmatterEnd } from './markdown-scan';

/** Opening marker of a doctoc-generated table of contents block. */
export const DOCTOC_MARKER = '<!-- START doctoc generated TOC';

/** Closing marker of a doctoc-generated table of contents block. */
export const DOCTOC_END_MARKER =
  '<!-- END doctoc generated TOC please keep comment here to allow auto update -->';

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
 * first second-order (`##`) heading in the document, instead of wherever
 * doctoc's own default placement chose (by default, near the top of the
 * file). Returns the input unchanged when the document has no doctoc block,
 * when no `##`-equivalent heading exists anywhere (doctoc's placement is left
 * untouched), or when the block already sits directly before the first `##`
 * heading — in which case the returned string is byte-identical to the input.
 *
 * The document's dominant line ending (`\r\n` when the input contains one,
 * `\n` otherwise) and the presence or absence of a trailing newline are
 * preserved.
 *
 * A leading YAML frontmatter block (see {@link findFrontmatterEnd}) is
 * treated as opaque: it is excluded from the heading scan and the TOC block
 * is never inserted at or before its closing delimiter, even if a frontmatter
 * value line is immediately followed by a line of dashes that would otherwise
 * look like a setext heading underline.
 *
 * @param raw - Full Markdown document contents.
 * @returns The document with the TOC block relocated, or `raw` unchanged.
 */
export function relocateTocBeforeFirstH2(raw: string): string {
  const eol = raw.includes('\r\n') ? '\r\n' : '\n';
  const hadTrailingNewline = raw.endsWith('\n');

  const lines = raw.split(/\r\n|\n/);
  if (hadTrailingNewline) {
    lines.pop();
  }

  const startIdx = lines.findIndex((line) => line.includes(DOCTOC_MARKER));
  if (startIdx === -1) {
    return raw;
  }

  const endIdx = lines.findIndex((line, i) => i >= startIdx && line.includes(DOCTOC_END_MARKER));
  if (endIdx === -1) {
    return raw;
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
    return raw;
  }
  const h2Idx = searchStart + relativeH2Idx;

  const finalLines = insertBlockBeforeIndex(withoutBlock, block, h2Idx);
  return finalLines.join(eol) + (hadTrailingNewline ? eol : '');
}
