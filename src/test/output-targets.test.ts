/**
 * Output path rules added for #45: where a conversion writes, which inputs
 * would write the same output, and how md2pdf recognises its own debug HTML.
 */

import path from 'path';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GENERATOR_MARKER,
  deriveOutputPaths,
  describeOutputCollisions,
  findOutputCollisions,
  isGeneratedHtml,
  stampGeneratedHtml,
} from '../steps/output-targets';

const root = path.resolve('fixture-root');

test('derives the outputs next to the source without -o', () => {
  const paths = deriveOutputPaths(path.join(root, 'docs', 'My Report.md'), undefined);

  assert.equal(paths.stem, 'My Report');
  assert.equal(paths.targetDir, path.join(root, 'docs'));
  assert.equal(paths.outputPdf, path.join(root, 'docs', 'My Report.pdf'));
  assert.equal(paths.outputHtml, path.join(root, 'docs', 'My Report.html'));
});

test('derives the outputs inside the -o directory', () => {
  const paths = deriveOutputPaths(path.join(root, 'docs', 'guide.MD'), path.join(root, 'out'));

  assert.equal(paths.stem, 'guide');
  assert.equal(paths.outputPdf, path.join(root, 'out', 'guide.pdf'));
  assert.equal(paths.outputHtml, path.join(root, 'out', 'guide.html'));
});

test('same-named files from different directories collide with -o', () => {
  const a = path.join(root, 'a', 'README.md');
  const b = path.join(root, 'b', 'README.md');
  const other = path.join(root, 'b', 'other.md');

  const collisions = findOutputCollisions([a, other, b], path.join(root, 'out'), 'linux');

  assert.deepEqual(collisions, [{ outputPdf: path.join(root, 'out', 'README.pdf'), sources: [a, b] }]);
});

test('same-named files from different directories do not collide without -o', () => {
  const files = [path.join(root, 'a', 'README.md'), path.join(root, 'b', 'README.md')];

  assert.deepEqual(findOutputCollisions(files, undefined, 'linux'), []);
});

test('two extension spellings of one stem collide in the same directory', () => {
  const files = [path.join(root, 'doc.md'), path.join(root, 'doc.MD')];

  assert.equal(findOutputCollisions(files, undefined, 'linux').length, 1);
});

test('letter case only separates outputs off Windows', () => {
  const files = [path.join(root, 'a', 'README.md'), path.join(root, 'b', 'readme.md')];
  const out = path.join(root, 'out');

  assert.deepEqual(findOutputCollisions(files, out, 'linux'), []);
  assert.deepEqual(findOutputCollisions(files, out, 'win32'), [
    { outputPdf: path.join(out, 'README.pdf'), sources: files },
  ]);
});

test('reports every contested output with its sources', () => {
  const message = describeOutputCollisions([
    { outputPdf: path.join(root, 'out', 'README.pdf'), sources: ['a/README.md', 'b/README.md', 'c/README.md'] },
  ]);

  assert.match(message, /nothing was converted/);
  assert.ok(message.includes(path.join(root, 'out', 'README.pdf')));
  for (const source of ['a/README.md', 'b/README.md', 'c/README.md']) {
    assert.ok(message.includes(`<- ${source}`), source);
  }
});

test('stamps the marker directly after the opening head tag', () => {
  const html = '<!DOCTYPE html><html><head><title>T</title></head><body></body></html>';

  assert.equal(
    stampGeneratedHtml(html),
    `<!DOCTYPE html><html><head>${GENERATOR_MARKER}<title>T</title></head><body></body></html>`,
  );
});

test('a head tag with attributes is found, a header element is not a head', () => {
  assert.equal(stampGeneratedHtml('<HEAD lang="en"><x>'), `<HEAD lang="en">${GENERATOR_MARKER}<x>`);
  assert.equal(stampGeneratedHtml('<html><header>h</header>'), `<html>${GENERATOR_MARKER}<header>h</header>`);
});

test('without head or html tag the marker is prepended', () => {
  assert.equal(stampGeneratedHtml('<p>x</p>'), `${GENERATOR_MARKER}<p>x</p>`);
});

test('stamping is idempotent and recognised', () => {
  const once = stampGeneratedHtml('<html><head></head></html>');

  assert.equal(stampGeneratedHtml(once), once);
  assert.equal(isGeneratedHtml(once), true);
  assert.equal(isGeneratedHtml('<html><head><meta name="generator" content="other"></head></html>'), false);
});
