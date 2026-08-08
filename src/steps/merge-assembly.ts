/**
 * Pure text and path computations behind `merge-markdown.ts`: how the source
 * documents are normalised and glued together, and where the merged PDF
 * defaults to. Kept separate from that file so these rules can be exercised
 * without creating temp directories, following the same split as
 * `markdown-scan.ts` / `run-doctoc.ts`.
 */

import path from 'path';

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
 * Removes a leading UTF-8 byte order mark.
 *
 * Only the first document of a merged file could legitimately keep one, and
 * a stray BOM in the middle of the concatenated Markdown would be rendered
 * as a zero-width character, so every document is stripped.
 *
 * @param value - Raw file contents.
 * @returns The contents without a leading BOM code point.
 */
export function stripBom(value: string): string {
  return value.charCodeAt(0) === 0xfeff ? value.slice(1) : value;
}

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
 * Joins normalised document bodies into the merged Markdown contents.
 *
 * Blank lines around every section guarantee that a file without a trailing
 * newline cannot glue its last line onto the next document, and that the
 * separator is parsed as its own HTML block. The result always ends in a
 * single newline.
 *
 * @param documents - Document bodies, already BOM-stripped and right-trimmed.
 * @returns The merged Markdown contents.
 */
export function joinDocuments(documents: string[]): string {
  const sections: string[] = [];

  documents.forEach((document, index) => {
    if (index > 0) {
      sections.push(DOCUMENT_BREAK_HTML);
    }
    sections.push(document);
  });

  return `${sections.join('\n\n')}\n`;
}
