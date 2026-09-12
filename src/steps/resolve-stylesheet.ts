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

// Marks where a remote `@import` was lifted out of the inlined CSS, to be
// re-emitted at the top. A NUL byte cannot occur in a stylesheet, so this can
// never collide with real content.
const HOISTED_IMPORT_MARKER = '\u0000hoisted-import\u0000';

// The marker plus the remainder of its own line. Consuming the line break lets
// an import that already sat at the top of the file be re-emitted
// byte-for-byte, so the fast path in `resolveStylesheet` still applies to it.
const HOISTED_IMPORT_MARKER_PATTERN = new RegExp(`${HOISTED_IMPORT_MARKER}[ \t]*\n?`, 'g');

// What may precede an `@import` in the effective stylesheet: whitespace, block
// comments, a leading `@charset`, and `@layer` *statements* (the `@layer a, b;`
// form, which fixes layer order and must keep its position). A `@layer x { }`
// block is a rule, so it does not match and the hoisted imports go above it.
const HOIST_PREFIX_PATTERNS = [/^\s+/, /^\/\*[\s\S]*?\*\//, /^@charset\s+[^;]*;/i, /^@layer\s+[^;{]*;/i];

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
 * Replaces the markers left by {@link inlineLocalReferences} with nothing and
 * re-emits the collected remote `@import`s at the first position where a
 * browser still honours them.
 *
 * That position is after a leading `@charset` and after any leading `@layer`
 * statements, which fix cascade-layer order and must keep their place. The
 * imports keep their source order among themselves, but a hoisted remote sheet
 * does move ahead of local rules that preceded it, so where both define the
 * same selector the local rule now wins. Exact source order cannot be
 * preserved: inlined content has to follow the `@import`s, not precede them.
 *
 * @param css - Inlined CSS still carrying the markers.
 * @param hoisted - The `@import` statements to re-emit, in source order.
 * @returns The CSS with the markers removed and the imports placed at the top.
 */
function hoistRemoteImports(css: string, hoisted: string[]): string {
  const stripped = css.replace(HOISTED_IMPORT_MARKER_PATTERN, '');
  if (hoisted.length === 0) {
    return stripped;
  }

  let index = 0;
  for (let matched = true; matched; ) {
    matched = false;
    for (const pattern of HOIST_PREFIX_PATTERNS) {
      const match = pattern.exec(stripped.slice(index));
      if (match) {
        index += match[0].length;
        matched = true;
        break;
      }
    }
  }

  const imports = hoisted.map((statement) => `${statement}\n`).join('');
  return `${stripped.slice(0, index)}${imports}${stripped.slice(index)}`;
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
 * Rewrites a matched `@import` statement to carry a different condition tail,
 * keeping the target exactly as it was written.
 *
 * The statement is returned untouched when the tail is unchanged, so a remote
 * `@import` that needs no composed conditions is re-emitted byte-for-byte.
 *
 * @param statement - The full matched `@import ...;` text.
 * @param conditionText - The raw condition tail captured from it.
 * @param tail - The tail to use instead.
 * @returns The `@import` statement with the new tail.
 */
function restateImport(statement: string, conditionText: string, tail: string): string {
  if (tail === conditionText.trim()) {
    return statement;
  }

  // `statement` is `@import <target><conditionText>;`, so dropping the tail and
  // the `;` leaves the target spelled exactly as the author wrote it.
  const target = statement.slice(0, statement.length - conditionText.length - 1).trimEnd();

  return tail ? `${target} ${tail};` : `${target};`;
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
