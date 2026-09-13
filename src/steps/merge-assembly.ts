/**
 * Pure text and path computations behind `merge-markdown.ts`: how the source
 * documents are normalised and glued together, and where the merged PDF
 * defaults to. Kept separate from that file so these rules can be exercised
 * without creating temp directories, following the same split as
 * `markdown-scan.ts` / `run-doctoc.ts`.
 */

import path from 'path';
import { findFrontmatterEnd } from './markdown-scan';

/**
 * Separator inserted between two consecutive source documents in a merged
 * Markdown file.
 *
 * A raw HTML block is used instead of relying on headings: PR #12 defaulted
 * `--heading-page-break-before` to `auto`, so headings no longer start a new
 * page on their own. The matching `.document-break` rule lives in
 * `src/css/default.css` and is driven by the `--document-page-break-before` /
 * `--document-break-before` custom properties.
 */
export const DOCUMENT_BREAK_HTML = '<div class="document-break"></div>';

/**
 * Compares two directory paths for equality, case-insensitively on Windows.
 *
 * @param a - First path segment or path.
 * @param b - Second path segment or path.
 * @returns `true` when both refer to the same name.
 */
function pathPartsEqual(a: string, b: string): boolean {
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

/**
 * Computes the longest common directory prefix of two absolute directories.
 *
 * @param a - First absolute directory.
 * @param b - Second absolute directory.
 * @returns The common prefix directory, or `undefined` when the paths share
 *   no root (different Windows drives, for example).
 */
function commonPrefixDirectory(a: string, b: string): string | undefined {
  const aSegments = a.split(path.sep);
  const bSegments = b.split(path.sep);
  const shared: string[] = [];

  for (let i = 0; i < Math.min(aSegments.length, bSegments.length); i++) {
    if (!pathPartsEqual(aSegments[i], bSegments[i])) {
      break;
    }
    shared.push(aSegments[i]);
  }

  if (shared.length === 0) {
    return undefined;
  }

  const joined = shared.join(path.sep);
  return joined === '' ? path.sep : joined;
}

/**
 * Determines the directory the merged PDF should default to: the deepest
 * directory that contains every input file.
 *
 * @param files - Absolute paths of the merged source files.
 * @returns The common ancestor directory, falling back to the current
 *   working directory when the inputs share no common root.
 */
export function commonAncestorDirectory(files: string[]): string {
  const directories = files.map((file) => path.dirname(path.resolve(file)));
  let common = directories[0];

  for (const directory of directories.slice(1)) {
    const next = commonPrefixDirectory(common, directory);
    if (!next) {
      return process.cwd();
    }
    common = next;
  }

  return common;
}

/**
 * Removes a leading YAML frontmatter block from a document body.
 *
 * Only the *first* document's frontmatter sits where md-to-pdf parses it; in
 * every later document the same block is ordinary content and renders as a
 * horizontal rule plus an invented heading carrying the raw YAML, which
 * `--force-doctoc` then lists in the table of contents (#49). A `docs/`
 * folder whose files all carry frontmatter is the normal case, so the block
 * is dropped rather than rendered.
 *
 * @param document - Document body, already BOM-stripped.
 * @returns The body without its leading frontmatter block, right-trimmed at
 *   the front, and whether a block was removed.
 */
export function removeFrontmatter(document: string): { body: string; removed: boolean } {
  const lines = document.split(/\r\n|\n/);
  const end = findFrontmatterEnd(lines);

  if (end === -1) {
    return { body: document, removed: false };
  }

  return { body: lines.slice(end + 1).join('\n').replace(/^\s+/, ''), removed: true };
}

/**
 * Joins normalised document bodies into the merged Markdown contents.
 *
 * Blank lines around every section guarantee that a file without a trailing
 * newline cannot glue its last line onto the next document, and that the
 * separator is parsed as its own HTML block. The result always ends in a
 * single newline.
 *
 * A document with no content left — an empty input file, or one holding
 * nothing but frontmatter — contributes no section and therefore no break,
 * which used to produce two consecutive page breaks and a blank page (#49).
 *
 * @param documents - Document bodies, already BOM-stripped and right-trimmed.
 * @returns The merged Markdown contents.
 */
export function joinDocuments(documents: string[]): string {
  const sections: string[] = [];

  documents
    .filter((document) => document.trim() !== '')
    .forEach((document, index) => {
      if (index > 0) {
        sections.push(DOCUMENT_BREAK_HTML);
      }
      sections.push(document);
    });

  return `${sections.join('\n\n')}\n`;
}
