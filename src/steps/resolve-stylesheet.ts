import fs from 'fs';
import path from 'path';
import { ConverterOptions } from '../types';

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

// Matches `@import "x";`, `@import 'x';` and `@import url(x);`, capturing an
// optional trailing media clause (`@import "print.css" print;`).
const IMPORT_PATTERN = /@import\s+(?:url\(\s*(['"]?)([^'")]*)\1\s*\)|(['"])([^'"]*)\3)\s*([^;]*);/g;

// Matches `url(x)` in any quoting style (used for @font-face src, background
// images, etc.). Deliberately excludes `@import url(...)`, which the pattern
// above already consumes.
const URL_PATTERN = /url\(\s*(['"]?)([^'")]*)\1\s*\)/g;

/**
 * Resolves the stylesheet path for the entire run.
 *
 * When CSS variable overrides are present, writes a merged stylesheet into
 * the given directory and returns its path. Otherwise returns the base
 * stylesheet path unchanged.
 *
 * md-to-pdf never references `--stylesheet` by path in the rendered page: it
 * reads the file and injects its text into an inline `<style>` tag
 * (puppeteer's `page.addStyleTag({ path })`), so any relative `@import` or
 * `url()` inside it resolves against the *page's* location, not the
 * stylesheet's own directory on disk — moving the merged file around cannot
 * fix that. Local `@import` targets are therefore inlined recursively
 * (resolved against each imported file's own directory) and local `url()`
 * targets are rewritten to `data:` URIs, so the merged stylesheet is fully
 * self-contained and needs no relative-path resolution at render time.
 * Remote (`http(s):`) and `data:` references are left untouched.
 *
 * @param options - Converter options containing the base stylesheet and CSS variable overrides.
 * @param dir - Directory to write the merged stylesheet file into (only used when cssVars is non-empty).
 * @returns Absolute path of the stylesheet to use, or undefined if none is configured.
 */
export function resolveStylesheet(options: ConverterOptions, dir: string): string | undefined {
  if (options.cssVars.length === 0) {
    return options.stylesheet;
  }

  const overrideStylesheet = path.join(dir, 'style-overrides.css');
  const lines: string[] = [];

  if (options.stylesheet) {
    lines.push(inlineLocalReferences(path.resolve(options.stylesheet), new Set()));
    lines.push('');
  }

  lines.push(':root {');
  options.cssVars.forEach(({ name, value }) => {
    lines.push(`  ${name}: ${value};`);
  });
  lines.push('}');
  lines.push('');

  fs.writeFileSync(overrideStylesheet, lines.join('\n'), 'utf8');
  return overrideStylesheet;
}

/**
 * Reads a CSS file and recursively inlines local `@import` targets and
 * `data:`-encodes local `url()` targets, resolving each relative reference
 * against the directory of the file it appears in.
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

  css = css.replace(IMPORT_PATTERN, (match, _urlQuote, urlTarget, _stringQuote, stringTarget, mediaClause) => {
    const target = urlTarget || stringTarget;
    if (!isLocalReference(target)) {
      return match;
    }

    const importedPath = path.resolve(dir, target);
    const importedCss = inlineLocalReferences(importedPath, ancestors);
    const media = mediaClause.trim();
    return media ? `@media ${media} {\n${importedCss}\n}` : importedCss;
  });

  css = css.replace(URL_PATTERN, (match, _quote, target) => {
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
