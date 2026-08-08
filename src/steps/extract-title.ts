import fs from 'fs';
import { ConversionContext } from '../types';
import { findFrontmatterEnd, findFirstHeading } from './markdown-scan';

/**
 * Extracts the title from the first Markdown heading and stores it as the
 * document title.
 *
 * The scan is fence-aware (fenced code blocks, ``` and ~~~, are ignored --
 * shared with `run-doctoc.ts`'s TOC-placement scanner) and skips a leading
 * YAML frontmatter block. A "heading" here is either a genuine ATX heading
 * (`#` through `######`, followed by whitespace or end of line -- `#hashtag`
 * with no space does not count, per CommonMark) or a setext heading (a text
 * line followed by a `===` or `---` underline). Lines indented 4 or more
 * spaces are treated as an indented code block, not a heading.
 *
 * Decision: setext headings count as title candidates at the same priority
 * as ATX headings, and headings of any level (not just h1 / `===`) are
 * considered. This mirrors the pre-fix behaviour, where the *first* heading
 * found anywhere in the document -- regardless of level -- became the
 * title; narrowing the search to ATX-only or to level-1-only would be a
 * behaviour change beyond the scope of this fix. The first heading
 * encountered while scanning top to bottom wins, whether it is ATX or
 * setext.
 *
 * Leaves the existing fallback title unchanged when no heading is present.
 *
 * @param context - Mutable conversion state for the current source file.
 */
export function extractTitle(context: ConversionContext): void {
  const raw = fs.readFileSync(context.inputMarkdown, 'utf8');
  const lines = raw.split(/\r\n|\n/);

  const frontmatterEnd = findFrontmatterEnd(lines);
  const searchStart = frontmatterEnd === -1 ? 0 : frontmatterEnd + 1;

  const heading = findFirstHeading(lines.slice(searchStart));

  if (heading) {
    context.docTitle = heading.text.trim();
  }
}
