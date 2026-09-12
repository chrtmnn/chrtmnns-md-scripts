/**
 * Behaviour of the self-contained effective stylesheet from #22 / PR #27:
 * recursive `@import` inlining resolved per file, `url()` targets encoded as
 * `data:` URIs, and everything that already resolves on its own left alone.
 * Since #29 this applies with and without `--css-var` overrides; since #36 an
 * inlined import keeps its `layer()` / `supports()` / media conditions; since
 * #38 a remote `@import` is hoisted to the top so the browser still honours it.
 */

import fs from 'fs';
import path from 'path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveStylesheet } from '../steps/resolve-stylesheet';
import { comparablePath, makeOptions, tempDir, writeFile, writePng } from './helpers';

/** Base64 of the byte sequence written by {@link writePng}. */
const PNG_BASE64 = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString('base64');

/** A single CSS variable override, enough to trigger the merge path. */
const CSS_VARS = [{ name: '--font-text', value: '"Aptos"' }];

/**
 * Runs `resolveStylesheet` with overrides and reads the merged result.
 *
 * @param dir - Directory the merged stylesheet is written into.
 * @param stylesheet - Base stylesheet path.
 * @returns The merged stylesheet text.
 */
function merged(dir: string, stylesheet: string): string {
  const output = resolveStylesheet(makeOptions({ stylesheet, cssVars: CSS_VARS }), dir);
  assert.ok(output, 'a merged stylesheet path is returned');
  return fs.readFileSync(output, 'utf8');
}

/**
 * Runs `resolveStylesheet` without overrides, asserts that a self-contained
 * copy was written, and reads it.
 *
 * @param dir - Directory the self-contained stylesheet is written into.
 * @param stylesheet - Base stylesheet path.
 * @returns The self-contained stylesheet text.
 */
function inlinedWithoutOverrides(dir: string, stylesheet: string): string {
  const output = resolveStylesheet(makeOptions({ stylesheet }), dir);
  assert.equal(comparablePath(output!), comparablePath(path.join(dir, 'style-overrides.css')));
  return fs.readFileSync(output!, 'utf8');
}

test('returns the base stylesheet unchanged when there is nothing to inline or override', (t) => {
  const dir = tempDir(t);
  const stylesheet = writeFile(dir, 'base.css', 'body { color: red; }\n');

  const result = resolveStylesheet(makeOptions({ stylesheet }), dir);

  assert.equal(result, stylesheet);
  assert.equal(fs.existsSync(path.join(dir, 'style-overrides.css')), false);
});

test('returns a stylesheet with only remote and fragment references unchanged when there are no overrides', (t) => {
  const dir = tempDir(t);
  const stylesheet = writeFile(
    dir,
    'base.css',
    '@import url("https://example.com/remote.css");\n.c { fill: url(#gradient); }\n',
  );

  const result = resolveStylesheet(makeOptions({ stylesheet }), dir);

  assert.equal(result, stylesheet);
  assert.equal(fs.existsSync(path.join(dir, 'style-overrides.css')), false);
});

test('ignores @import and url() inside block comments instead of failing on them', (t) => {
  const dir = tempDir(t);
  const stylesheet = writeFile(
    dir,
    'base.css',
    '/* @import "old.css"; */\n/* h1 { background: url(gone.png); } */\nbody { color: red; }\n/* unterminated url(gone.png)',
  );

  const result = resolveStylesheet(makeOptions({ stylesheet }), dir);

  assert.equal(result, stylesheet, 'nothing live to resolve, so the fast path applies');
});

test('keeps comments verbatim while resolving the live references next to them', (t) => {
  const dir = tempDir(t);
  writeFile(dir, 'a.css', '/* url(gone.png) */ .a {}\n');
  const stylesheet = writeFile(dir, 'base.css', '/* @import "old.css"; */\n@import "a.css";\n');

  const css = inlinedWithoutOverrides(dir, stylesheet);

  assert.equal(css, '/* @import "old.css"; */\n/* url(gone.png) */ .a {}\n\n\n');
});

test('returns undefined when no stylesheet is configured and no overrides are given', (t) => {
  const dir = tempDir(t);

  assert.equal(resolveStylesheet(makeOptions(), dir), undefined);
});

test('appends the overrides in a :root block after the base CSS', (t) => {
  const dir = tempDir(t);
  const stylesheet = writeFile(dir, 'base.css', 'body { color: red; }\n');

  const output = resolveStylesheet(
    makeOptions({ stylesheet, cssVars: [{ name: '--font-text', value: '"Aptos"' }] }),
    dir,
  );

  assert.equal(comparablePath(output!), comparablePath(path.join(dir, 'style-overrides.css')));
  const css = fs.readFileSync(output!, 'utf8');
  assert.equal(css.startsWith('body { color: red; }'), true);
  assert.equal(css.includes(':root {\n  --font-text: "Aptos";\n}'), true);
});

test('writes an overrides-only stylesheet when no base stylesheet exists', (t) => {
  const dir = tempDir(t);

  const output = resolveStylesheet(makeOptions({ cssVars: CSS_VARS }), dir);

  assert.equal(fs.readFileSync(output!, 'utf8'), ':root {\n  --font-text: "Aptos";\n}\n');
});

test('inlines a local @import instead of leaving a relative reference behind (#22)', (t) => {
  const dir = tempDir(t);
  writeFile(dir, 'tokens.css', ':root { --brand: red; }\n');
  const stylesheet = writeFile(dir, 'base.css', '@import "./tokens.css";\nbody { color: var(--brand); }\n');

  const css = merged(path.join(dir), stylesheet);

  assert.equal(css.includes('--brand: red;'), true);
  assert.equal(css.includes('@import'), false, 'no relative @import may survive');
});

test('inlines a local @import without any --css-var (#29)', (t) => {
  const dir = tempDir(t);
  writeFile(dir, 'tokens.css', 'h1 { color: rgb(1, 2, 3); }\n');
  const stylesheet = writeFile(dir, 'custom.css', '@import "./tokens.css";\nbody { font-family: sans-serif; }\n');

  const css = inlinedWithoutOverrides(dir, stylesheet);

  assert.equal(css, 'h1 { color: rgb(1, 2, 3); }\n\nbody { font-family: sans-serif; }\n\n');
  assert.equal(css.includes(':root {'), false, 'no override block without overrides');
});

test('inlines @import url(...) and quoted forms alike', (t) => {
  const dir = tempDir(t);
  writeFile(dir, 'a.css', '.a {}\n');
  writeFile(dir, 'b.css', '.b {}\n');
  const stylesheet = writeFile(dir, 'base.css', "@import url(a.css);\n@import 'b.css';\n");

  const css = merged(dir, stylesheet);

  assert.equal(css.includes('.a {}'), true);
  assert.equal(css.includes('.b {}'), true);
});

test('resolves a nested @import against the importing file own directory', (t) => {
  const dir = tempDir(t);
  writeFile(dir, 'theme/palette.css', ':root { --brand: blue; }\n');
  writeFile(dir, 'theme/index.css', '@import "./palette.css";\n.theme {}\n');
  const stylesheet = writeFile(dir, 'base.css', '@import "theme/index.css";\n');

  const css = merged(dir, stylesheet);

  assert.equal(css.includes('--brand: blue;'), true);
  assert.equal(css.includes('.theme {}'), true);
});

test('wraps an @import with a media clause in a matching @media block', (t) => {
  const dir = tempDir(t);
  writeFile(dir, 'print.css', '.p {}\n');
  const stylesheet = writeFile(dir, 'base.css', '@import "print.css" print;\n');

  const css = merged(dir, stylesheet);

  assert.equal(css.includes('@media print {'), true);
  assert.equal(css.includes('.p {}'), true);
});

test('wraps an @import with layer(), supports() and media in nested blocks (#36)', (t) => {
  const dir = tempDir(t);
  writeFile(dir, 'base.css', '.b {}\n');
  const stylesheet = writeFile(dir, 'custom.css', '@import "base.css" layer(base) supports(display: grid) print;\n');

  const css = inlinedWithoutOverrides(dir, stylesheet);

  assert.equal(css.startsWith('@layer base {\n@supports (display: grid) {\n@media print {\n.b {}\n'), true);
  assert.equal(css.includes('@media layer'), false, 'layer() must not end up in a media query');
});

test('wraps an @import with a bare layer keyword in an anonymous @layer block (#36)', (t) => {
  const dir = tempDir(t);
  writeFile(dir, 'reset.css', '.r {}\n');
  const stylesheet = writeFile(dir, 'custom.css', '@import url("reset.css") layer;\n');

  const css = inlinedWithoutOverrides(dir, stylesheet);

  assert.equal(css.startsWith('@layer {\n.r {}\n'), true);
});

test('names the importing file when @import conditions are malformed (#36)', (t) => {
  const dir = tempDir(t);
  writeFile(dir, 'base.css', '.b {}\n');
  const stylesheet = writeFile(dir, 'custom.css', '@import "base.css" layer(base;\n');

  assert.throws(
    () => resolveStylesheet(makeOptions({ stylesheet }), dir),
    /Unbalanced parentheses in @import conditions "layer\(base" in .*custom\.css/,
  );
});

test('allows a diamond import and inlines the shared file for each path', (t) => {
  const dir = tempDir(t);
  writeFile(dir, 'shared.css', '.shared {}\n');
  writeFile(dir, 'left.css', '@import "shared.css";\n.left {}\n');
  writeFile(dir, 'right.css', '@import "shared.css";\n.right {}\n');
  const stylesheet = writeFile(dir, 'base.css', '@import "left.css";\n@import "right.css";\n');

  const css = merged(dir, stylesheet);

  assert.equal(css.split('.shared {}').length - 1, 2, 'a diamond is not an error');
  assert.equal(css.includes('.left {}') && css.includes('.right {}'), true);
});

test('rejects a circular @import instead of recursing forever', (t) => {
  const dir = tempDir(t);
  writeFile(dir, 'a.css', '@import "b.css";\n');
  writeFile(dir, 'b.css', '@import "a.css";\n');
  const stylesheet = path.join(dir, 'a.css');

  assert.throws(
    () => resolveStylesheet(makeOptions({ stylesheet, cssVars: CSS_VARS }), dir),
    /Circular @import detected/,
  );
});

test('rejects a self-referencing @import', (t) => {
  const dir = tempDir(t);
  const stylesheet = writeFile(dir, 'loop.css', '@import "loop.css";\n');

  assert.throws(
    () => resolveStylesheet(makeOptions({ stylesheet, cssVars: CSS_VARS }), dir),
    /Circular @import detected/,
  );
});

test('reports a missing @import target by path', (t) => {
  const dir = tempDir(t);
  const stylesheet = writeFile(dir, 'base.css', '@import "missing.css";\n');

  assert.throws(
    () => resolveStylesheet(makeOptions({ stylesheet, cssVars: CSS_VARS }), dir),
    /Stylesheet reference not found: .*missing\.css/,
  );
});

test('reports a missing @import target without any --css-var (#29)', (t) => {
  const dir = tempDir(t);
  const stylesheet = writeFile(dir, 'base.css', '@import "missing.css";\n');

  assert.throws(
    () => resolveStylesheet(makeOptions({ stylesheet }), dir),
    /Stylesheet reference not found: .*missing\.css/,
  );
});

test('encodes a local url() asset as a data URI (#22)', (t) => {
  const dir = tempDir(t);
  writePng(dir, 'assets/rule.png');
  const stylesheet = writeFile(dir, 'base.css', 'h1 { background: url("./assets/rule.png"); }\n');

  const css = merged(dir, stylesheet);

  assert.equal(css.includes(`url("data:image/png;base64,${PNG_BASE64}")`), true);
});

test('encodes a local url() asset without any --css-var (#29)', (t) => {
  const dir = tempDir(t);
  writePng(dir, 'assets/rule.png');
  const stylesheet = writeFile(dir, 'urlonly.css', 'h1 { background-image: url("./assets/rule.png"); }\n');

  const css = inlinedWithoutOverrides(dir, stylesheet);

  assert.equal(css.includes(`url("data:image/png;base64,${PNG_BASE64}")`), true);
  assert.equal(css.includes('./assets/rule.png'), false, 'no relative url() may survive');
});

test('resolves a url() inside an imported file against that file own directory', (t) => {
  const dir = tempDir(t);
  writePng(dir, 'theme/fonts/mark.png');
  writeFile(dir, 'theme/index.css', '@font-face { src: url("fonts/mark.png"); }\n');
  const stylesheet = writeFile(dir, 'base.css', '@import "theme/index.css";\n');

  const css = merged(dir, stylesheet);

  assert.equal(css.includes(`url("data:image/png;base64,${PNG_BASE64}")`), true);
});

test('leaves remote, data and fragment references untouched', (t) => {
  const dir = tempDir(t);
  const stylesheet = writeFile(
    dir,
    'base.css',
    [
      '@import url("https://example.com/remote.css");',
      '.a { background: url(https://example.com/x.png); }',
      '.b { background: url("data:image/png;base64,AAAA"); }',
      '.c { fill: url(#gradient); }',
      '.d { background: url(//cdn.example.com/x.png); }',
      '',
    ].join('\n'),
  );

  const css = merged(dir, stylesheet);

  assert.equal(css.includes('@import url("https://example.com/remote.css");'), true);
  assert.equal(css.includes('url(https://example.com/x.png)'), true);
  assert.equal(css.includes('url("data:image/png;base64,AAAA")'), true);
  assert.equal(css.includes('url(#gradient)'), true);
  assert.equal(css.includes('url(//cdn.example.com/x.png)'), true);
});

test('treats an absolute path in url() as local, not as a URL scheme', (t) => {
  const dir = tempDir(t);
  const asset = writePng(dir, 'assets/rule.png');
  // On Windows this is `C:/.../rule.png`, whose `C:` prefix must not be read
  // as a scheme.
  const stylesheet = writeFile(
    dir,
    'base.css',
    `h1 { background: url("${asset.split(path.sep).join('/')}"); }\n`,
  );

  const css = merged(dir, stylesheet);

  assert.equal(css.includes(`url("data:image/png;base64,${PNG_BASE64}")`), true);
});

test('reports a missing url() asset by path', (t) => {
  const dir = tempDir(t);
  const stylesheet = writeFile(dir, 'base.css', 'h1 { background: url("gone.png"); }\n');

  assert.throws(
    () => resolveStylesheet(makeOptions({ stylesheet, cssVars: CSS_VARS }), dir),
    /Stylesheet asset not found: .*gone\.png/,
  );
});

test('reports a missing url() asset without any --css-var instead of dropping it silently (#29)', (t) => {
  const dir = tempDir(t);
  const stylesheet = writeFile(dir, 'base.css', 'h1 { background: url("gone.png"); }\n');

  assert.throws(
    () => resolveStylesheet(makeOptions({ stylesheet }), dir),
    /Stylesheet asset not found: .*gone\.png/,
  );
});

test('picks the MIME type from the extension and falls back for unknown ones', (t) => {
  const dir = tempDir(t);
  writeFile(dir, 'font.woff2', 'x');
  writeFile(dir, 'thing.bin', 'x');
  const stylesheet = writeFile(
    dir,
    'base.css',
    '@font-face { src: url(font.woff2); }\n.a { background: url(thing.bin); }\n',
  );

  const css = merged(dir, stylesheet);

  assert.equal(css.includes('data:font/woff2;base64,'), true);
  assert.equal(css.includes('data:application/octet-stream;base64,'), true);
});

/** The remote stylesheet used by the hoisting scenarios from #38. */
const REMOTE = 'https://example.com/remote.css';

/**
 * Asserts that a remote `@import` is the first thing in the stylesheet that a
 * browser would parse, i.e. nothing but `@charset`, `@layer` statements,
 * comments and other `@import`s precedes it.
 *
 * @param css - The effective stylesheet text.
 * @param expected - The `@import` statement expected at the top, without `;`.
 */
function assertHoisted(css: string, expected: string): void {
  assert.equal(css.includes(`${expected};`), true, `${expected}; is present\n---\n${css}`);

  const before = css.slice(0, css.indexOf(expected));
  const live = before
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/@charset\s+[^;]*;/gi, '')
    .replace(/@layer\s+[^;{]*;/gi, '')
    .replace(/@import\s+[^;]*;/gi, '')
    .trim();

  assert.equal(live, '', `nothing but @charset/@layer statements precede the import, found: ${live}`);
}

test('hoists a remote @import above a local one inlined before it (#38, S1)', (t) => {
  const dir = tempDir(t);
  writeFile(dir, 'local.css', '.local {}\n');
  const stylesheet = writeFile(dir, 'base.css', `@import "local.css";\n@import url(${REMOTE});\n`);

  const css = inlinedWithoutOverrides(dir, stylesheet);

  assertHoisted(css, `@import url(${REMOTE})`);
  assert.equal(css.includes('.local {}'), true, 'the local import is still inlined');
});

test('hoists a remote @import out of a file imported after another (#38, S2)', (t) => {
  const dir = tempDir(t);
  writeFile(dir, 'tokens.css', ':root { --brand: red; }\n');
  writeFile(dir, 'fonts.css', `@import url(${REMOTE});\n`);
  const stylesheet = writeFile(dir, 'base.css', '@import "tokens.css";\n@import "fonts.css";\n');

  const css = inlinedWithoutOverrides(dir, stylesheet);

  assertHoisted(css, `@import url(${REMOTE})`);
  assert.equal(css.includes(':root { --brand: red; }'), true);
});

test('hoists a remote @import out of a layer() block, keeping the layer (#38, S3)', (t) => {
  const dir = tempDir(t);
  writeFile(dir, 'fonts.css', `@import url(${REMOTE});\n`);
  const stylesheet = writeFile(dir, 'base.css', '@import "fonts.css" layer(fonts);\n');

  const css = inlinedWithoutOverrides(dir, stylesheet);

  assertHoisted(css, `@import url(${REMOTE}) layer(fonts)`);
});

test('hoists a remote @import out of a @media block, keeping the query (#38, S4)', (t) => {
  const dir = tempDir(t);
  writeFile(dir, 'fonts.css', `@import url(${REMOTE});\n`);
  const stylesheet = writeFile(dir, 'base.css', '@import "fonts.css" print;\n');

  const css = inlinedWithoutOverrides(dir, stylesheet);

  assertHoisted(css, `@import url(${REMOTE}) print`);
});

test('composes the conditions of the chain and the remote import itself (#38)', (t) => {
  const dir = tempDir(t);
  writeFile(dir, 'fonts.css', `@import url(${REMOTE}) layer(inner) screen;\n`);
  const stylesheet = writeFile(dir, 'base.css', '@import "fonts.css" layer(outer);\n');

  const css = inlinedWithoutOverrides(dir, stylesheet);

  assertHoisted(css, `@import url(${REMOTE}) layer(outer.inner) screen`);
});

test('keeps a remote @import below a @charset and leading @layer statements (#38)', (t) => {
  const dir = tempDir(t);
  writeFile(dir, 'fonts.css', `@import url(${REMOTE});\n`);
  const stylesheet = writeFile(
    dir,
    'base.css',
    '@charset "utf-8";\n@layer a, b;\nbody { color: red; }\n@import "fonts.css";\n',
  );

  const css = inlinedWithoutOverrides(dir, stylesheet);

  assert.match(css, /^@charset "utf-8";\n@layer a, b;\n@import url\([^)]+\);\nbody \{ color: red; \}/);
});

test('hoists several remote @imports and keeps their source order (#38)', (t) => {
  const dir = tempDir(t);
  writeFile(dir, 'fonts.css', '@import url(https://example.com/b.css);\n.font {}\n');
  const stylesheet = writeFile(
    dir,
    'base.css',
    'body { color: red; }\n@import "fonts.css";\n@import url(https://example.com/c.css);\n',
  );

  const css = inlinedWithoutOverrides(dir, stylesheet);

  assert.match(css, /^@import url\(https:\/\/example\.com\/b\.css\);\n@import url\(https:\/\/example\.com\/c\.css\);\n/);
});

test('hoists a remote @import alongside --css-var overrides (#38)', (t) => {
  const dir = tempDir(t);
  writeFile(dir, 'local.css', '.local {}\n');
  const stylesheet = writeFile(dir, 'base.css', `@import "local.css";\n@import url(${REMOTE});\n`);

  const css = merged(dir, stylesheet);

  assertHoisted(css, `@import url(${REMOTE})`);
  assert.equal(css.includes('--font-text: "Aptos";'), true, 'the overrides are still appended');
});

test('leaves a remote @import inside a block comment alone (#38)', (t) => {
  const dir = tempDir(t);
  writeFile(dir, 'local.css', '.local {}\n');
  const stylesheet = writeFile(dir, 'base.css', `/* @import url(${REMOTE}); */\n@import "local.css";\n`);

  const css = inlinedWithoutOverrides(dir, stylesheet);

  assert.equal(css, `/* @import url(${REMOTE}); */\n.local {}\n\n\n`);
});

test('names the importing file when a hoisted import cannot keep its conditions (#38)', (t) => {
  const dir = tempDir(t);
  const fonts = writeFile(dir, 'fonts.css', `@import url(${REMOTE}) layer;\n`);
  const stylesheet = writeFile(dir, 'base.css', '@import "fonts.css" layer(outer);\n');

  assert.throws(
    () => resolveStylesheet(makeOptions({ stylesheet }), dir),
    (error: Error) =>
      /anonymous cascade layer/.test(error.message) && error.message.includes(path.basename(fonts)),
  );
});

test('rejects media queries that cannot be combined, naming the file (#38)', (t) => {
  const dir = tempDir(t);
  writeFile(dir, 'fonts.css', `@import url(${REMOTE}) screen;\n`);
  const stylesheet = writeFile(dir, 'base.css', '@import "fonts.css" print;\n');

  assert.throws(
    () => resolveStylesheet(makeOptions({ stylesheet }), dir),
    /Cannot combine the media queries "screen" and "print"/,
  );
});

test('hoists a remote @import only once when a diamond reaches it twice (#38)', (t) => {
  const dir = tempDir(t);
  writeFile(dir, 'shared.css', `@import url(${REMOTE});\n.s {}\n`);
  writeFile(dir, 'left.css', '@import "shared.css";\n.l {}\n');
  writeFile(dir, 'right.css', '@import "shared.css";\n.r {}\n');
  const stylesheet = writeFile(dir, 'base.css', '@import "left.css";\n@import "right.css";\n');

  const css = inlinedWithoutOverrides(dir, stylesheet);

  assertHoisted(css, `@import url(${REMOTE})`);
  assert.equal(css.match(/@import/g)?.length, 1, 'the statement appears exactly once');
  assert.equal(css.match(/\.s \{\}/g)?.length, 2, 'the shared file is still inlined for each path');
});

test('leaves an empty wrapper behind when a conditioned import held only the remote one (#38)', (t) => {
  const dir = tempDir(t);
  writeFile(dir, 'fonts.css', `@import url(${REMOTE});\n`);
  const stylesheet = writeFile(dir, 'base.css', '@import "fonts.css" print;\n');

  const css = inlinedWithoutOverrides(dir, stylesheet);

  // Valid CSS that affects nothing, but pinned so the shape is not a surprise.
  assert.match(css, /@media print \{\s*\}/);
});

test('hoists from a stylesheet with no trailing newline (#38)', (t) => {
  const dir = tempDir(t);
  writeFile(dir, 'local.css', '.local {}');
  const stylesheet = writeFile(dir, 'base.css', `@import "local.css";\n@import url(${REMOTE});`);

  const css = inlinedWithoutOverrides(dir, stylesheet);

  assertHoisted(css, `@import url(${REMOTE})`);
  assert.equal(css.includes('.local {}'), true);
});

test('matches @import case-insensitively, as CSS does (#38)', (t) => {
  const dir = tempDir(t);
  const stylesheet = writeFile(dir, 'base.css', `body { color: red; }\n@IMPORT URL("${REMOTE}");\n`);

  const css = inlinedWithoutOverrides(dir, stylesheet);

  assertHoisted(css, `@IMPORT URL("${REMOTE}")`);
});

test('inlines an uppercase @IMPORT of a local target instead of data-encoding it (#38)', (t) => {
  const dir = tempDir(t);
  writeFile(dir, 'local.css', '.local {}\n');
  const stylesheet = writeFile(dir, 'base.css', '@IMPORT "local.css";\n');

  const css = inlinedWithoutOverrides(dir, stylesheet);

  assert.equal(css.includes('.local {}'), true);
  assert.equal(css.includes('data:'), false, 'the url() pass must not claim it first');
});

test('ignores an @import missing its semicolon instead of relocating later rules (#38)', (t) => {
  const dir = tempDir(t);
  const stylesheet = writeFile(
    dir,
    'base.css',
    `.x { color: blue; }\n@import url("${REMOTE}")\nbody { color: red; }\n.y {}\n`,
  );

  const result = resolveStylesheet(makeOptions({ stylesheet }), dir);

  // The condition tail stops at a brace, so the statement simply does not match
  // and the file is passed through rather than rewritten around a bogus match.
  assert.equal(result, stylesheet);
});

test('leaves a remote @import inside an unterminated comment alone (#38)', (t) => {
  const dir = tempDir(t);
  const stylesheet = writeFile(dir, 'base.css', `body { color: red; }\n/* @import url(${REMOTE});`);

  const result = resolveStylesheet(makeOptions({ stylesheet }), dir);

  assert.equal(result, stylesheet, 'nothing live to hoist, so the fast path applies');
});
