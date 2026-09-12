/**
 * Parsing and wrapping of the conditions after a CSS `@import` target (#36):
 * `layer`, `layer(<name>)`, `supports(...)` and a media query list, which
 * have to survive as `@layer` / `@supports` / `@media` blocks when the
 * imported file is inlined — plus the composition that folds a whole chain of
 * them into one tail when a remote `@import` is hoisted out instead (#38).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  composeImportConditions,
  formatImportConditions,
  parseImportConditions,
  wrapInImportConditions,
} from '../steps/css-import-conditions';

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

test('composes nothing for an empty chain or chains without conditions (#38)', () => {
  assert.deepEqual(composeImportConditions([]), {});
  assert.deepEqual(composeImportConditions([{}, {}]), {});
});

test('passes a single set of conditions through unchanged (#38)', () => {
  assert.deepEqual(composeImportConditions([{}, { layer: 'fonts' }]), { layer: 'fonts' });
  assert.deepEqual(composeImportConditions([{ media: 'print' }, {}]), { media: 'print' });
  assert.deepEqual(composeImportConditions([{ layer: '' }]), { layer: '' }, 'a lone anonymous layer survives');
  assert.deepEqual(composeImportConditions([{ media: 'not print' }]), { media: 'not print' });
});

test('nests layer names in chain order (#38)', () => {
  assert.deepEqual(composeImportConditions([{ layer: 'outer' }, { layer: 'inner' }]), { layer: 'outer.inner' });
  assert.deepEqual(composeImportConditions([{ layer: 'a' }, {}, { layer: 'b.c' }]), { layer: 'a.b.c' });
});

test('rejects an anonymous layer that would have to nest (#38)', () => {
  assert.throws(
    () => composeImportConditions([{ layer: 'outer' }, { layer: '' }]),
    /Cannot hoist a remote @import out of an anonymous cascade layer nested with layer\(outer\)/,
  );
  assert.throws(() => composeImportConditions([{ layer: '' }, { layer: '' }]), /anonymous cascade layer/);
});

test('combines supports() conditions with and (#38)', () => {
  assert.deepEqual(composeImportConditions([{ supports: 'display: grid' }, { supports: 'gap: 1rem' }]), {
    supports: '(display: grid) and (gap: 1rem)',
  });
});

test('combines media queries as a cross product, inner query first (#38)', () => {
  assert.deepEqual(composeImportConditions([{ media: '(min-width: 10cm)' }, { media: 'print, screen' }]), {
    media: 'print and (min-width: 10cm), screen and (min-width: 10cm)',
  });
  // A rendered query has to lead with its media type, whichever side it came
  // from, so the inner-first rule only orders the feature conditions.
  assert.deepEqual(composeImportConditions([{ media: 'print' }, { media: '(orientation: landscape)' }]), {
    media: 'print and (orientation: landscape)',
  });
});

test('treats "all" as the media type that never conflicts (#38)', () => {
  assert.deepEqual(composeImportConditions([{ media: 'all' }, { media: 'print' }]), { media: 'print' });
  assert.deepEqual(composeImportConditions([{ media: 'print' }, { media: 'all and (min-width: 10cm)' }]), {
    media: 'print and (min-width: 10cm)',
  });
  assert.deepEqual(composeImportConditions([{ media: 'PRINT' }, { media: 'print' }]), { media: 'print' });
});

test('a bare "all" is a no-op even against a query nothing can narrow (#38)', () => {
  // `all` adds no constraint, so the other side stands as written rather than
  // failing the way a genuine combination with `not` / `only` would.
  assert.deepEqual(composeImportConditions([{ media: 'all' }, { media: 'not print' }]), { media: 'not print' });
  assert.deepEqual(composeImportConditions([{ media: 'only screen' }, { media: 'all' }]), { media: 'only screen' });
  assert.deepEqual(composeImportConditions([{ media: 'ALL' }, { media: 'not print' }]), { media: 'not print' });
});

test('drops a pair that cannot hold and keeps the rest of the cross product (#38)', () => {
  // `screen` x `print` matches nowhere, but `print` x `print` does, so the
  // intersection is `print` rather than a failure.
  assert.deepEqual(composeImportConditions([{ media: 'print' }, { media: 'print, screen' }]), { media: 'print' });
  assert.deepEqual(composeImportConditions([{ media: 'print, screen' }, { media: 'screen' }]), { media: 'screen' });
});

test('combines a multi-query list with a multi-query list (#38)', () => {
  assert.deepEqual(
    composeImportConditions([{ media: '(min-width: 10cm), (orientation: landscape)' }, { media: 'print, screen' }]),
    {
      media: [
        'print and (min-width: 10cm)',
        'print and (orientation: landscape)',
        'screen and (min-width: 10cm)',
        'screen and (orientation: landscape)',
      ].join(', '),
    },
  );
});

test('accepts a negated feature query as a combinable condition (#38)', () => {
  // `screen and not (hover)` is valid Media Queries 4. The negation is wrapped
  // in parentheses on the way out, because a bare `not (...)` may not be
  // followed by a further `and`.
  assert.deepEqual(composeImportConditions([{ media: 'screen' }, { media: 'screen and not (hover)' }]), {
    media: 'screen and (not (hover))',
  });
  assert.deepEqual(
    composeImportConditions([{ media: '(min-width: 10cm)' }, { media: 'screen and not (hover)' }]),
    { media: 'screen and (not (hover)) and (min-width: 10cm)' },
    'the wrapped negation stays valid with another condition after it',
  );
  // A whole query that *starts* with `not` negates a media type, which cannot
  // be narrowed by `and`, so it is still refused.
  assert.throws(() => composeImportConditions([{ media: 'print' }, { media: 'not (hover)' }]), /Cannot combine/);
});

test('rejects a media query list that contributes no query at all (#38)', () => {
  // Silently widening the condition is the failure this change exists to stop.
  assert.throws(
    () => composeImportConditions([{ media: 'print' }, { media: ',' }]),
    /Cannot combine the media query lists ","? and "print"/,
  );
});

test('passes a single supports() condition through unchanged (#38)', () => {
  assert.deepEqual(composeImportConditions([{}, { supports: 'display: grid' }]), { supports: 'display: grid' });
});

test('does not split a comma or "and" inside a quoted string (#38)', () => {
  assert.deepEqual(
    composeImportConditions([{ media: 'print' }, { media: '(font-family: "a, b")' }]),
    { media: 'print and (font-family: "a, b")' },
    'a quoted comma is not a list separator',
  );
  assert.deepEqual(composeImportConditions([{ media: 'print' }, { media: '(font-family: "x and y")' }]), {
    media: 'print and (font-family: "x and y")',
  });
  assert.deepEqual(composeImportConditions([{ media: "print" }, { media: '(font-family: \'a, b\')' }]), {
    media: "print and (font-family: 'a, b')",
  });
});

test('does not split an "and" or a comma inside parentheses (#38)', () => {
  assert.deepEqual(
    composeImportConditions([{ media: '(min-width: 10cm)' }, { media: 'screen and (color-index: 1)' }]),
    { media: 'screen and (color-index: 1) and (min-width: 10cm)' },
  );
});

test('rejects media queries that cannot both hold (#38)', () => {
  assert.throws(
    () => composeImportConditions([{ media: 'print' }, { media: 'screen' }]),
    /Cannot combine the media queries "screen" and "print" of a hoisted remote @import/,
  );
  assert.throws(() => composeImportConditions([{ media: 'print' }, { media: 'not screen' }]), /Cannot combine/);
  assert.throws(() => composeImportConditions([{ media: 'only screen' }, { media: 'print' }]), /Cannot combine/);
  assert.throws(() => composeImportConditions([{ media: 'print' }, { media: 'screen projection' }]), /Cannot combine/);
  assert.throws(() => composeImportConditions([{ media: 'print' }, { media: 'screen and hover' }]), /Cannot combine/);
});

test('composes all three kinds of condition at once (#38)', () => {
  assert.deepEqual(
    composeImportConditions([
      { layer: 'base', supports: 'display: grid', media: 'screen' },
      { layer: 'fonts', supports: 'gap: 1rem', media: '(min-width: 10cm)' },
    ]),
    {
      layer: 'base.fonts',
      supports: '(display: grid) and (gap: 1rem)',
      media: 'screen and (min-width: 10cm)',
    },
  );
});

test('formatImportConditions is the inverse of parseImportConditions (#38)', () => {
  assert.equal(formatImportConditions({}), '');
  assert.equal(formatImportConditions({ layer: 'base' }), 'layer(base)');
  assert.equal(formatImportConditions({ layer: '' }), 'layer');
  assert.equal(formatImportConditions({ supports: 'display: grid' }), 'supports(display: grid)');
  assert.equal(formatImportConditions({ media: 'print' }), 'print');

  const tail = 'layer(base) supports(display: grid) print and (orientation: landscape)';
  assert.equal(formatImportConditions(parseImportConditions(tail)), tail);
});
