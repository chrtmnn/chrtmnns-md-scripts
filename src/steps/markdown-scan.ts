/**
 * Shared, fence-aware Markdown scanning primitives. Extracted from
 * `run-doctoc.ts` (which uses them to locate the first `##`-equivalent
 * heading for TOC placement) so that other steps can reuse the same
 * fence/indentation/setext handling instead of a second, divergent
 * implementation.
 */

/**
 * Line-ending-preserving check for a blank (whitespace-only) line.
 *
 * @param line - Single line of Markdown, without its line terminator.
 * @returns `true` when the line contains only whitespace.
 */
export function isBlank(line: string): boolean {
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
export function matchFenceDelimiter(line: string): { char: string; len: number } | null {
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
export function isAtxH2(line: string): boolean {
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
export function isPotentialSetextText(line: string): boolean {
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
export function isSetextH2Underline(line: string): boolean {
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
export function findFirstH2Index(lines: string[]): number {
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
export function findFrontmatterEnd(lines: string[]): number {
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
