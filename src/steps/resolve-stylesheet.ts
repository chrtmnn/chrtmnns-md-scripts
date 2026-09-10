import fs from 'fs';
import path from 'path';
import { ConverterOptions } from '../types';
import { parseImportConditions, wrapInImportConditions } from './css-import-conditions';

/**
 * MIME types for local assets that get inlined as `data:` URIs, keyed by
 * lowercased file extension. Anything not listed falls back to
 * `application/octet-stream`, which browsers still accept for `url()`.
 */
const DATA_URI_MIME_TYPES: Record<string, string> = {
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.eot': 'application/vnd.ms-fontobject',
};

// Matches `@import "x";`, `@import 'x';` and `@import url(x);`, capturing the
// optional trailing conditions (`layer(base)`, `supports(...)`, `print`, ...),
// which `parseImportConditions` splits up.
const IMPORT_PATTERN = /@import\s+(?:url\(\s*(['"]?)([^'")]*)\1\s*\)|(['"])([^'"]*)\3)\s*([^;]*);/g;

// Matches `url(x)` in any quoting style (used for @font-face src, background
// images, etc.). Deliberately excludes `@import url(...)`, which the pattern
// above already consumes.
const URL_PATTERN = /url\(\s*(['"]?)([^'")]*)\1\s*\)/g;

// A block comment, including an unterminated one that runs to the end of the
// file. Captured so that `split` keeps the comments at the odd indices.
const COMMENT_PATTERN = /(\/\*[\s\S]*?(?:\*\/|$))/;

/**
 * Resolves the stylesheet path for the entire run.
 *
 * md-to-pdf never references `--stylesheet` by path in the rendered page: it
 * reads the file and injects its text into an inline `<style>` tag
 * (puppeteer's `page.addStyleTag({ path })`), so any relative `@import` or
 * `url()` inside it resolves against the *page's* location, not the
 * stylesheet's own directory on disk — moving the file around cannot fix
 * that. Local `@import` targets are therefore inlined recursively (resolved
 * against each imported file's own directory) and local `url()` targets are
 * rewritten to `data:` URIs, so the effective stylesheet is fully
 * self-contained and needs no relative-path resolution at render time.
 * Remote (`http(s):`) and `data:` references are left untouched.
 *
 * This happens for every configured stylesheet, with or without CSS variable
 * overrides. The self-contained copy is written into `dir`, with the
 * overrides appended in a `:root {}` block when there are any. When there are
 * no overrides and no local reference to resolve, the original file already
 * renders correctly: its path is returned unchanged and nothing is written.
 *
 * @param options - Converter options containing the base stylesheet and CSS variable overrides.
 * @param dir - Directory to write the self-contained stylesheet into, when one is needed.
 * @returns Path of the stylesheet to use, or undefined if none is configured.
 */
export function resolveStylesheet(options: ConverterOptions, dir: string): string | undefined {
  const lines: string[] = [];

  if (options.stylesheet) {
    const stylesheetPath = path.resolve(options.stylesheet);
    const css = inlineLocalReferences(stylesheetPath, new Set());

    if (options.cssVars.length === 0 && css === fs.readFileSync(stylesheetPath, 'utf8')) {
      return options.stylesheet;
    }

    lines.push(css);
    lines.push('');
  } else if (options.cssVars.length === 0) {
    return undefined;
  }

  if (options.cssVars.length > 0) {
    lines.push(':root {');
    options.cssVars.forEach(({ name, value }) => {
      lines.push(`  ${name}: ${value};`);
    });
    lines.push('}');
    lines.push('');
  }

  const effectiveStylesheet = path.join(dir, 'style-overrides.css');
  fs.writeFileSync(effectiveStylesheet, lines.join('\n'), 'utf8');
  return effectiveStylesheet;
}

/**
 * Reads a CSS file and recursively inlines local `@import` targets and
 * `data:`-encodes local `url()` targets, resolving each relative reference
 * against the directory of the file it appears in. An inlined import keeps
 * its `layer()`, `supports()` and media conditions as wrapping blocks.
 * References inside block comments are not live and are left alone.
 *
 * @param filePath - Absolute path of the CSS file to read.
 * @param ancestors - Absolute paths of files currently being resolved in the
 *   current import chain, used to detect circular `@import`s.
 * @returns The file's CSS text with all local references resolved.
 */
function inlineLocalReferences(filePath: string, ancestors: Set<string>): string {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Stylesheet reference not found: ${filePath}`);
  }
  if (ancestors.has(filePath)) {
    throw new Error(`Circular @import detected while resolving stylesheet: ${filePath}`);
  }

  ancestors.add(filePath);
  const dir = path.dirname(filePath);
  let css = fs.readFileSync(filePath, 'utf8');

  css = replaceOutsideComments(css, IMPORT_PATTERN, (match, _urlQuote, urlTarget, _stringQuote, stringTarget, conditionText) => {
    const target = urlTarget || stringTarget;
    if (!isLocalReference(target)) {
      return match;
    }

    let conditions;
    try {
      conditions = parseImportConditions(conditionText);
    } catch (error) {
      throw new Error(`${error instanceof Error ? error.message : String(error)} in ${filePath}`);
    }

    const importedPath = path.resolve(dir, target);
    return wrapInImportConditions(inlineLocalReferences(importedPath, ancestors), conditions);
  });

  css = replaceOutsideComments(css, URL_PATTERN, (match, _quote, target) => {
    if (!isLocalReference(target)) {
      return match;
    }

    const assetPath = path.resolve(dir, target);
    if (!fs.existsSync(assetPath)) {
      throw new Error(`Stylesheet asset not found: ${assetPath}`);
    }

    const mimeType = DATA_URI_MIME_TYPES[path.extname(assetPath).toLowerCase()] ?? 'application/octet-stream';
    const base64 = fs.readFileSync(assetPath).toString('base64');
    return `url("data:${mimeType};base64,${base64}")`;
  });

  ancestors.delete(filePath);
  return css;
}

/**
 * Applies `String.prototype.replace` to the parts of `css` outside block
 * comments, so a commented-out `@import` or `url()` is neither inlined nor
 * reported as missing. The comments themselves are kept verbatim.
 *
 * @param css - CSS text to rewrite.
 * @param pattern - Global pattern to replace.
 * @param replacer - Replacement callback, as for `String.prototype.replace`.
 * @returns The rewritten CSS text.
 */
function replaceOutsideComments(
  css: string,
  pattern: RegExp,
  replacer: (match: string, ...groups: string[]) => string,
): string {
  return css
    .split(COMMENT_PATTERN)
    .map((part, index) => (index % 2 === 1 ? part : part.replace(pattern, replacer)))
    .join('');
}

/**
 * Determines whether a `@import`/`url()` target refers to a local file that
 * needs to be resolved and inlined, as opposed to a reference that already
 * works unchanged (a URL with a scheme, a protocol-relative URL, an existing
 * `data:` URI, or an in-document fragment like `#gradient`).
 *
 * @param target - Raw, unquoted `@import`/`url()` target text.
 * @returns True when the target is a local filesystem path.
 */
function isLocalReference(target: string): boolean {
  if (!target || target.startsWith('#')) {
    return false;
  }

  // A leading `<scheme>:` (http:, https:, data:, file:, ...) or a
  // protocol-relative `//host/...` means the reference already resolves on
  // its own. A Windows drive letter (`C:\...`) looks like a scheme too, so
  // it is excluded from this check and correctly treated as local.
  if (/^[a-z][a-z0-9+.-]*:/i.test(target) && !/^[a-z]:[\\/]/i.test(target)) {
    return false;
  }
  if (target.startsWith('//')) {
    return false;
  }

  return true;
}
