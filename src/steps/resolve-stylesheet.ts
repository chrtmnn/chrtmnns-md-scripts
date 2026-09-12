import fs from 'fs';
import path from 'path';
import { ConverterOptions } from '../types';
import {
  composeImportConditions,
  formatImportConditions,
  ImportConditions,
  parseImportConditions,
  wrapInImportConditions,
} from './css-import-conditions';
import { HOISTED_IMPORT_MARKER, hoistRemoteImports, restateImport } from './css-import-hoisting';

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
// which `parseImportConditions` splits up. At-keywords and function tokens are
// case-insensitive in CSS, so `@IMPORT URL(x)` has to match too.
//
// The condition tail excludes `{` and `}`: without that, an `@import` whose `;`
// the author forgot would match on to the next `;` anywhere in the file,
// swallowing whole rules into a bogus "statement" that hoisting would then
// relocate. Conditions never contain braces, so nothing legitimate is lost and
// a statement missing its `;` simply does not match.
const IMPORT_PATTERN = /@import\s+(?:url\(\s*(['"]?)([^'")]*)\1\s*\)|(['"])([^'"]*)\3)\s*([^;{}]*);/gi;

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
 * Remote `url()` and existing `data:` references are left untouched.
 *
 * Remote `@import`s are left remote but are hoisted to the top of the result
 * (#38): a browser honours an `@import` only where it precedes every other
 * rule and sits outside any block, which inlining the imports around it would
 * otherwise break, silently and without an error. See
 * {@link hoistRemoteImports}.
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
    const css = makeSelfContained(stylesheetPath);

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
 * Turns a stylesheet into the self-contained CSS that can be injected as a
 * `<style>` tag: local references resolved, remote `@import`s hoisted to the
 * top.
 *
 * @param stylesheetPath - Absolute path of the base stylesheet.
 * @returns The self-contained CSS text.
 */
function makeSelfContained(stylesheetPath: string): string {
  const hoisted: string[] = [];
  const inlined = inlineLocalReferences(stylesheetPath, new Set(), [], hoisted);

  return hoistRemoteImports(inlined, hoisted);
}

/**
 * Reads a CSS file and recursively inlines local `@import` targets and
 * `data:`-encodes local `url()` targets, resolving each relative reference
 * against the directory of the file it appears in. An inlined import keeps
 * its `layer()`, `supports()` and media conditions as wrapping blocks.
 * References inside block comments are not live and are left alone.
 *
 * A remote `@import` cannot stay where it is — it would end up below other
 * rules or inside one of those wrapping blocks, where the browser drops it
 * (#38). It is replaced by a marker and collected in `hoisted` instead, with
 * the conditions of the whole import chain folded into its own tail, for
 * {@link hoistRemoteImports} to re-emit at the top.
 *
 * @param filePath - Absolute path of the CSS file to read.
 * @param ancestors - Absolute paths of files currently being resolved in the
 *   current import chain, used to detect circular `@import`s.
 * @param chain - Conditions of the `@import`s this file was reached through,
 *   outermost first.
 * @param hoisted - Collects the remote `@import` statements, in source order.
 * @returns The file's CSS text with all local references resolved.
 */
function inlineLocalReferences(
  filePath: string,
  ancestors: Set<string>,
  chain: ImportConditions[],
  hoisted: string[],
): string {
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
    const conditions = inFile(filePath, () => parseImportConditions(conditionText));

    if (!isLocalReference(target)) {
      const composed = inFile(filePath, () => composeImportConditions([...chain, conditions]));
      hoisted.push(restateImport(match, conditionText, formatImportConditions(composed)));
      return HOISTED_IMPORT_MARKER;
    }

    const importedPath = path.resolve(dir, target);
    const imported = inlineLocalReferences(importedPath, ancestors, [...chain, conditions], hoisted);

    return wrapInImportConditions(imported, conditions);
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
 * Runs a step of the `@import` resolution and names the offending file in
 * whatever it throws, so a malformed or uncomposable condition points at the
 * stylesheet that carries it.
 *
 * @param filePath - Absolute path of the CSS file being resolved.
 * @param step - The step to run.
 * @returns The step's result.
 * @throws The step's error, with the file path appended.
 */
function inFile<T>(filePath: string, step: () => T): T {
  try {
    return step();
  } catch (error) {
    throw new Error(`${error instanceof Error ? error.message : String(error)} in ${filePath}`);
  }
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
