/**
 * Validation rules for the CLI option values that carry a payload:
 * `--css-var name=value` and `--merge <name>`.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCssVars, parseMergeName } from '../steps/option-values';

test('parseCssVars normalises names to a leading double dash', () => {
  assert.deepEqual(parseCssVars(['font-text=Aptos']), [{ name: '--font-text', value: 'Aptos' }]);
  assert.deepEqual(parseCssVars(['--font-text=Aptos']), [{ name: '--font-text', value: 'Aptos' }]);
});

test('parseCssVars trims around the separator and keeps the value otherwise verbatim', () => {
  assert.deepEqual(parseCssVars(['  page-margin  =  2cm 2cm  ']), [
    { name: '--page-margin', value: '2cm 2cm' },
  ]);
  assert.deepEqual(parseCssVars(['font-text="JetBrains Mono", monospace']), [
    { name: '--font-text', value: '"JetBrains Mono", monospace' },
  ]);
});

test('parseCssVars keeps every entry, in order', () => {
  assert.deepEqual(parseCssVars(['a=1', 'b=2']), [
    { name: '--a', value: '1' },
    { name: '--b', value: '2' },
  ]);
  assert.deepEqual(parseCssVars([]), []);
});

test('parseCssVars splits on the first = so values may contain more of them', () => {
  assert.deepEqual(parseCssVars(['content=a=b']), [{ name: '--content', value: 'a=b' }]);
});

test('parseCssVars rejects malformed entries', () => {
  assert.throws(() => parseCssVars(['no-separator']), /Expected name=value/);
  assert.throws(() => parseCssVars(['=orphan']), /Expected name=value/);
  assert.throws(() => parseCssVars(['trailing=']), /Expected name=value/);
});

test('parseCssVars rejects names that are not CSS identifiers', () => {
  assert.throws(() => parseCssVars(['1font=Aptos']), /Invalid CSS variable name/);
  assert.throws(() => parseCssVars(['font text=Aptos']), /Invalid CSS variable name/);
  assert.throws(() => parseCssVars(['font:text=Aptos']), /Invalid CSS variable name/);
  assert.deepEqual(parseCssVars(['_private-1=x']), [{ name: '--_private-1', value: 'x' }]);
});

test('parseCssVars rejects values that could escape the generated :root block', () => {
  assert.throws(() => parseCssVars(['x=red; } body {']), /Invalid CSS variable value/);
  assert.throws(() => parseCssVars(['x=a{b']), /Invalid CSS variable value/);
  assert.throws(() => parseCssVars(['x=   ']), /Invalid CSS variable value/);
});

test('parseMergeName accepts a plain name and strips a .pdf suffix', () => {
  assert.equal(parseMergeName('report'), 'report');
  assert.equal(parseMergeName('report.pdf'), 'report');
  assert.equal(parseMergeName('report.PDF'), 'report');
  assert.equal(parseMergeName('  spaced name  '), 'spaced name');
  assert.equal(parseMergeName('report.v2.pdf'), 'report.v2');
});

test('parseMergeName rejects empty and dot-only names', () => {
  assert.throws(() => parseMergeName(''), /Expected a PDF base name/);
  assert.throws(() => parseMergeName('   '), /Expected a PDF base name/);
  assert.throws(() => parseMergeName('.pdf'), /Expected a PDF base name/);
  assert.throws(() => parseMergeName('.'), /Expected a PDF base name/);
  assert.throws(() => parseMergeName('..'), /Expected a PDF base name/);
});

test('parseMergeName rejects anything that looks like a path', () => {
  for (const value of ['out/report', 'out\\report', 'C:report', 'a?b', 'a*b', 'a|b', 'a"b', '<a>']) {
    assert.throws(() => parseMergeName(value), /without path separators/, `expected ${value} to be rejected`);
  }
});
