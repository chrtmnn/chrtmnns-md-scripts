/**
 * Shared, fence-aware Markdown scanning primitives used by both
 * `run-doctoc.ts` (to locate the first `##`-equivalent heading for TOC
 * placement) and `extract-title.ts` (to locate the first heading of any
 * level for the document title). Keeping this logic in one place avoids two
 * divergent implementations of fence/indentation/setext handling.
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
 * Checks whether a line is a setext first-order-heading underline (a run of
 * one or more `=` characters, optionally indented and trailed by
 * whitespace).
 *
 * @param line - Single line of Markdown, without its line terminator.
 * @returns `true` when the line is a setext `=` underline.
 */
export function isSetextH1Underline(line: string): boolean {
  return /^ {0,3}=+[ \t]*$/.test(line);
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

/**
 * A heading found by {@link findFirstHeading}.
 */
export interface HeadingMatch {
  /** Heading level: 1-6 for ATX, 1 for a `===` setext underline, 2 for a `---` setext underline. */
  level: number;
  /** Heading text, trimmed. */
  text: string;
}

/**
 * Checks whether a line is a genuine ATX heading (`#` through `######`,
 * indented up to 3 spaces, followed by whitespace or end of line) per
 * CommonMark. Unlike a naive `/^\s*#+/` match, this rejects `#hashtag`
 * (no space after the `#`) and lines indented 4 or more spaces (which
 * CommonMark treats as an indented code block, not a heading).
 *
 * @param line - Single line of Markdown, without its line terminator.
 * @returns The heading level and text, or `null` when the line is not an
 *   ATX heading.
 */
export function matchAtxHeading(line: string): HeadingMatch | null {
  const match = /^ {0,3}(#{1,6})(?:[ \t]+(.*))?$/.exec(line);
  if (!match) {
    return null;
  }
  return { level: match[1].length, text: (match[2] ?? '').trim() };
}

/**
 * Finds the first heading in a fence-aware scan of the document, of any
 * level, recognising both ATX (`#` through `######`) and setext (text line
 * followed by a `===` or `---` underline) headings. Lines inside fenced
 * code blocks (```/~~~, closed only by a matching or longer run of the same
 * character) are ignored, as are non-heading `#word` lines and lines
 * indented 4 or more spaces.
 *
 * @param lines - Document lines, without line terminators. Callers should
 *   already have stripped any leading YAML frontmatter block (see
 *   {@link findFrontmatterEnd}) before calling this.
 * @returns The first heading found, or `null` when none exists.
 */
export function findFirstHeading(lines: string[]): HeadingMatch | null {
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

    const atx = matchAtxHeading(line);
    if (atx) {
      return atx;
    }

    if (i + 1 < lines.length && isPotentialSetextText(line)) {
      if (isSetextH1Underline(lines[i + 1])) {
        return { level: 1, text: line.trim() };
      }
      if (isSetextH2Underline(lines[i + 1])) {
        return { level: 2, text: line.trim() };
      }
    }
  }

  return null;
}
