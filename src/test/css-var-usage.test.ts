/**
 * Detection of `--css-var` overrides the effective stylesheet never reads
 * (#60).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { describeUnusedCssVar, findUnusedCssVars } from '../steps/css-var-usage';

const override = (name: string, value = 'x') => ({ name, value });

test('findUnusedCssVars reports a mistyped name and keeps a used one quiet', () => {
  const css = 'h1 { break-before: var(--heading-break-before); }\n:root {\n  --heading-break-befor: page;\n}\n';

  assert.deepEqual(
    findUnusedCssVars(css, [override('--heading-break-befor'), override('--heading-break-before')]),
    ['--heading-break-befor'],
  );
});

test('findUnusedCssVars does not take a longer name as a use of its prefix', () => {
  const css = 'h1 { break-before: var(--heading-break-before); }';

  assert.deepEqual(findUnusedCssVars(css, [override('--heading-break')]), ['--heading-break']);
  assert.deepEqual(findUnusedCssVars('a { b: var(--gapé); }', [override('--gap')]), ['--gap']);
  assert.deepEqual(findUnusedCssVars('a { b: var(--gap\\31); }', [override('--gap')]), ['--gap']);
});

test('findUnusedCssVars accepts whitespace, fallbacks and any case of var()', () => {
  const overrides = [override('--a'), override('--b'), override('--c'), override('--d')];
  const css = 'x { a: var( --a ); b: var(--b, 1cm); c: VAR(--c); d: calc(var(--d)*2); }';

  assert.deepEqual(findUnusedCssVars(css, overrides), []);
});

test('findUnusedCssVars treats custom property names as case-sensitive', () => {
  assert.deepEqual(findUnusedCssVars('x { a: var(--Font-Text); }', [override('--font-text')]), ['--font-text']);
});

test('findUnusedCssVars counts a reference from another override value as a use', () => {
  const css = ':root {\n  --page-margin: var(--gap);\n  --gap: 1cm;\n}\n';

  assert.deepEqual(findUnusedCssVars(css, [override('--page-margin', 'var(--gap)'), override('--gap', '1cm')]), [
    '--page-margin',
  ]);
});

test('findUnusedCssVars reports a repeated override once, in order', () => {
  assert.deepEqual(findUnusedCssVars('', [override('--b'), override('--a'), override('--b')]), ['--b', '--a']);
  assert.deepEqual(findUnusedCssVars('', []), []);
});

test('describeUnusedCssVar names the option value and the property', () => {
  assert.equal(
    describeUnusedCssVar('--heading-break-befor'),
    '--css-var heading-break-befor: the stylesheet does not use --heading-break-befor',
  );
});
