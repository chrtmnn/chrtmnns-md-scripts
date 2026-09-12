/**
 * The placement rules for a hoisted remote `@import` (#38): where in the
 * stylesheet the statements may go, and how one is restated when the import
 * chain adds conditions to it. Exercised directly, without the file round trip
 * that `resolve-stylesheet.test.ts` goes through.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { HOISTED_IMPORT_MARKER, hoistRemoteImports, restateImport } from '../steps/css-import-hoisting';

/** A remote import statement, as it would be collected during inlining. */
const REMOTE = '@import url(https://example.com/remote.css);';

/**
 * Builds inlined CSS with a hoist marker standing in for a remote `@import`.
 *
 * @param parts - Lines, where `null` stands for the marker line.
 * @returns The CSS text.
 */
function withMarker(...parts: (string | null)[]): string {
  return parts.map((part) => (part === null ? HOISTED_IMPORT_MARKER : part)).join('\n');
}

test('returns the CSS with markers stripped when nothing was collected', () => {
  assert.equal(hoistRemoteImports('body { color: red; }\n', []), 'body { color: red; }\n');
});

test('strips a marker together with the rest of its own line', () => {
  assert.equal(hoistRemoteImports(withMarker(null, 'body {}', ''), []), 'body {}\n');
});

test('re-emits a collected import at the very top', () => {
  assert.equal(hoistRemoteImports(withMarker('.local {}', null, ''), [REMOTE]), `${REMOTE}\n.local {}\n`);
});

test('reproduces the original text when the import was already at the top', () => {
  // This is what keeps resolveStylesheet's fast path working for such a file.
  const original = `${REMOTE}\n.c { fill: url(#gradient); }\n`;
  const inlined = withMarker(null, '.c { fill: url(#gradient); }', '');

  assert.equal(hoistRemoteImports(inlined, [REMOTE]), original);
});

test('keeps the imports in the order they were collected', () => {
  const a = '@import url(https://example.com/a.css);';
  const b = '@import url(https://example.com/b.css);';

  assert.equal(hoistRemoteImports(withMarker('body {}', null, null, ''), [a, b]), `${a}\n${b}\nbody {}\n`);
});

test('emits an import collected twice by a diamond only once', () => {
  assert.equal(hoistRemoteImports(withMarker('body {}', null, null, ''), [REMOTE, REMOTE]), `${REMOTE}\nbody {}\n`);
});

test('inserts after a leading @charset and leading @layer statements', () => {
  const inlined = withMarker('@charset "utf-8";', '@layer a, b;', 'body {}', null, '');

  assert.equal(hoistRemoteImports(inlined, [REMOTE]), `@charset "utf-8";\n@layer a, b;\n${REMOTE}\nbody {}\n`);
});

test('inserts above a @layer block, which is an ordinary rule', () => {
  const inlined = withMarker('@layer fonts {', null, '}', '');

  assert.equal(hoistRemoteImports(inlined, [REMOTE]), `${REMOTE}\n@layer fonts {\n}\n`);
});

test('inserts after leading comments and whitespace', () => {
  const inlined = withMarker('/* header */', '', 'body {}', null, '');

  assert.equal(hoistRemoteImports(inlined, [REMOTE]), `/* header */\n\n${REMOTE}\nbody {}\n`);
});

test('terminates on input that is nothing but skippable prefix', () => {
  assert.equal(hoistRemoteImports('@charset "utf-8";\n', [REMOTE]), `@charset "utf-8";\n${REMOTE}\n`);
  assert.equal(hoistRemoteImports('   ', [REMOTE]), `   ${REMOTE}\n`);
  assert.equal(hoistRemoteImports('', [REMOTE]), `${REMOTE}\n`);
});

test('restateImport returns the statement untouched when the tail is unchanged', () => {
  assert.equal(restateImport(REMOTE, '', ''), REMOTE);
  assert.equal(restateImport('@import "x.css" print;', 'print', 'print'), '@import "x.css" print;');
  assert.equal(restateImport('@import "x.css" print ;', 'print ', 'print'), '@import "x.css" print ;');
});

test('restateImport keeps the target exactly as written while replacing the tail', () => {
  assert.equal(restateImport(REMOTE, '', 'layer(fonts)'), '@import url(https://example.com/remote.css) layer(fonts);');
  assert.equal(restateImport("@import 'x.css';", '', 'print'), "@import 'x.css' print;");
  assert.equal(restateImport('@import url( "x.css" );', '', 'print'), '@import url( "x.css" ) print;');
  assert.equal(
    restateImport('@import "x.css" layer(inner);', 'layer(inner)', 'layer(outer.inner)'),
    '@import "x.css" layer(outer.inner);',
  );
});

test('restateImport drops the tail entirely when the composed one is empty', () => {
  assert.equal(restateImport('@import "x.css" print;', 'print', ''), '@import "x.css";');
});
