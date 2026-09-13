/**
 * Behaviour of the structural CSS scan added for #46: which characters count
 * as live code, how deep inside `{}` blocks they sit, and which matches a
 * rewrite pass is therefore allowed to touch.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { replaceInLiveCss, scanCssStructure } from '../steps/css-structure';

/** Collects the live/dead state of every character as a compact string. */
function liveMap(css: string): string {
  return scanCssStructure(css)
    .live.map((isLive) => (isLive ? '.' : 'x'))
    .join('');
}

test('marks block comments as not live', () => {
  assert.equal(liveMap('a/*b*/c'), '.xxxxx.');
});

test('marks an unterminated comment to the end of the file as not live', () => {
  assert.equal(liveMap('a/*bcd'), '.xxxxx');
});

test('marks a string literal as not live, keeping its opening quote live', () => {
  // The opening quote stays live so a rewrite pass still matches the whole of
  // `url("x.png")`, which begins outside the literal.
  assert.equal(liveMap('a"bc"d'), '..xxx.');
});

test('a backslash escape does not end a string literal', () => {
  const { live } = scanCssStructure(`"a\\"b"z`);

  assert.equal(live[live.length - 1], true, 'only the final z is live again');
  assert.deepEqual(live.slice(0, 6), [true, false, false, false, false, false]);
});

test('an unescaped newline ends a string literal, so one stray quote cannot swallow the file', () => {
  const { live } = scanCssStructure(`a: "b\nc: d;`);

  assert.equal(live[live.length - 1], true);
});

test('counts brace depth outside comments and strings', () => {
  const css = 'a{b{c}d}e';
  const { depth } = scanCssStructure(css);

  assert.deepEqual(depth, [0, 0, 1, 1, 2, 2, 1, 1, 0]);
});

test('braces inside a string or comment do not change the depth', () => {
  const { depth } = scanCssStructure(`a"{{{"/*}}}*/b`);

  assert.equal(depth[depth.length - 1], 0);
});

test('replaceInLiveCss rewrites a match in live code', () => {
  assert.equal(
    replaceInLiveCss('url(a.png) and url(b.png)', /url\(([^)]*)\)/g, (_depth, _match, target) => `<${target}>`),
    '<a.png> and <b.png>',
  );
});

test('replaceInLiveCss leaves a match inside a comment alone', () => {
  const css = '/* url(a.png) */ url(b.png)';

  assert.equal(
    replaceInLiveCss(css, /url\(([^)]*)\)/g, () => 'REWRITTEN'),
    '/* url(a.png) */ REWRITTEN',
  );
});

test('replaceInLiveCss leaves a match inside a string literal alone (#46)', () => {
  const css = `.doc::after { content: "url(logo.png)"; background: url(real.png); }`;

  assert.equal(
    replaceInLiveCss(css, /url\(([^)]*)\)/g, () => 'REWRITTEN'),
    `.doc::after { content: "url(logo.png)"; background: REWRITTEN; }`,
  );
});

test('replaceInLiveCss reports the brace depth of each match (#46)', () => {
  const css = 'url(top.png) @media print { url(nested.png) }';
  const depths: number[] = [];

  replaceInLiveCss(css, /url\(([^)]*)\)/g, (depth, match) => {
    depths.push(depth);
    return match;
  });

  assert.deepEqual(depths, [0, 1]);
});
