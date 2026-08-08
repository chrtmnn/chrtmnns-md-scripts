/**
 * Behaviour of the self-contained merged stylesheet from #22 / PR #27:
 * recursive `@import` inlining resolved per file, `url()` targets encoded as
 * `data:` URIs, and everything that already resolves on its own left alone.
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

test('returns the base stylesheet unchanged when there are no overrides', (t) => {
  const dir = tempDir(t);
  const stylesheet = writeFile(dir, 'base.css', 'body { color: red; }\n');

  const result = resolveStylesheet(makeOptions({ stylesheet }), dir);

  assert.equal(result, stylesheet);
  assert.equal(fs.existsSync(path.join(dir, 'style-overrides.css')), false);
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

test('encodes a local url() asset as a data URI (#22)', (t) => {
  const dir = tempDir(t);
  writePng(dir, 'assets/rule.png');
  const stylesheet = writeFile(dir, 'base.css', 'h1 { background: url("./assets/rule.png"); }\n');

  const css = merged(dir, stylesheet);

  assert.equal(css.includes(`url("data:image/png;base64,${PNG_BASE64}")`), true);
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
