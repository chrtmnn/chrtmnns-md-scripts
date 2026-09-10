/**
 * Parsing and wrapping of the conditions after a CSS `@import` target (#36):
 * `layer`, `layer(<name>)`, `supports(...)` and a media query list, which
 * have to survive as `@layer` / `@supports` / `@media` blocks when the
 * imported file is inlined.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { parseImportConditions, wrapInImportConditions } from '../steps/css-import-conditions';

test('returns no conditions for an empty tail', () => {
  assert.deepEqual(parseImportConditions(''), {});
  assert.deepEqual(parseImportConditions('   '), {});
});

test('keeps a plain media query list as media', () => {
  assert.deepEqual(parseImportConditions('print'), { media: 'print' });
  assert.deepEqual(parseImportConditions(' screen and (min-width: 40em) '), {
    media: 'screen and (min-width: 40em)',
  });
});

test('recognises a named and an anonymous layer, case-insensitively', () => {
  assert.deepEqual(parseImportConditions('layer(base)'), { layer: 'base' });
  assert.deepEqual(parseImportConditions('layer( base.components )'), { layer: 'base.components' });
  assert.deepEqual(parseImportConditions('layer'), { layer: '' });
  assert.deepEqual(parseImportConditions('LAYER(Base)'), { layer: 'Base' });
});

test('does not mistake an identifier that merely starts with "layer" for the keyword', () => {
  assert.deepEqual(parseImportConditions('layered'), { media: 'layered' });
  assert.deepEqual(parseImportConditions('layer-x'), { media: 'layer-x' });
});

test('reads supports() with nested and quoted parentheses', () => {
  assert.deepEqual(parseImportConditions('supports(display: grid)'), { supports: 'display: grid' });
  assert.deepEqual(parseImportConditions('supports((display: grid) and (gap: 1rem))'), {
    supports: '(display: grid) and (gap: 1rem)',
  });
  assert.deepEqual(parseImportConditions('supports(selector(:has(a)))'), { supports: 'selector(:has(a))' });
  assert.deepEqual(parseImportConditions('supports(font-family: "a)b")'), { supports: 'font-family: "a)b"' });
});

test('splits all three conditions in grammar order', () => {
  assert.deepEqual(parseImportConditions('layer(base) supports(display: grid) print and (orientation: landscape)'), {
    layer: 'base',
    supports: 'display: grid',
    media: 'print and (orientation: landscape)',
  });
  assert.deepEqual(parseImportConditions('layer print'), { layer: '', media: 'print' });
  assert.deepEqual(parseImportConditions('supports(display: grid) screen'), {
    supports: 'display: grid',
    media: 'screen',
  });
});

test('rejects unbalanced parentheses', () => {
  assert.throws(() => parseImportConditions('layer(base'), /Unbalanced parentheses in @import conditions "layer\(base"/);
  assert.throws(() => parseImportConditions('supports((display: grid)'), /Unbalanced parentheses/);
});

test('rejects an empty layer() or supports()', () => {
  assert.throws(() => parseImportConditions('layer()'), /Empty layer\(\)/);
  assert.throws(() => parseImportConditions('supports( )'), /Empty supports\(\)/);
});

test('leaves the CSS unwrapped when there are no conditions', () => {
  assert.equal(wrapInImportConditions('.a {}', {}), '.a {}');
});

test('wraps a media query list the same way as before', () => {
  assert.equal(wrapInImportConditions('.a {}', { media: 'print' }), '@media print {\n.a {}\n}');
});

test('nests layer, supports and media from the outside in', () => {
  assert.equal(
    wrapInImportConditions('.a {}', { layer: 'base', supports: 'display: grid', media: 'print' }),
    '@layer base {\n@supports (display: grid) {\n@media print {\n.a {}\n}\n}\n}',
  );
});

test('emits an anonymous @layer block for a bare layer keyword', () => {
  assert.equal(wrapInImportConditions('.a {}', { layer: '' }), '@layer {\n.a {}\n}');
});
