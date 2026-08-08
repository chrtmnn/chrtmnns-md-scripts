/**
 * Behaviour of the pure parts of `--merge` (#6): BOM stripping, the common
 * ancestor directory the merged PDF defaults to, and how document bodies are
 * glued together.
 */

import path from 'path';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DOCUMENT_BREAK_HTML,
  commonAncestorDirectory,
  joinDocuments,
  stripBom,
} from '../steps/merge-assembly';

/**
 * Builds an absolute path from segments in a platform-correct way, so the same
 * expectations hold on Windows and POSIX.
 *
 * @param segments - Path segments below the current working directory's root.
 * @returns The absolute path.
 */
function absolute(...segments: string[]): string {
  return path.join(path.parse(process.cwd()).root, ...segments);
}

test('stripBom removes only a leading BOM', () => {
  assert.equal(stripBom('\uFEFF# Title'), '# Title');
  assert.equal(stripBom('# Title'), '# Title');
  assert.equal(stripBom('# Title\uFEFF'), '# Title\uFEFF');
  assert.equal(stripBom(''), '');
});

test('commonAncestorDirectory returns the shared directory of the inputs', () => {
  const files = [absolute('docs', 'a.md'), absolute('docs', 'b.md')];

  assert.equal(commonAncestorDirectory(files), absolute('docs'));
});

test('commonAncestorDirectory climbs to the deepest shared parent', () => {
  const files = [
    absolute('docs', 'guide', 'a.md'),
    absolute('docs', 'reference', 'b.md'),
    absolute('docs', 'reference', 'deep', 'c.md'),
  ];

  assert.equal(commonAncestorDirectory(files), absolute('docs'));
});

test('commonAncestorDirectory is that file own directory for a single input', () => {
  assert.equal(commonAncestorDirectory([absolute('docs', 'only.md')]), absolute('docs'));
});

test('commonAncestorDirectory compares segments case-insensitively on Windows', () => {
  const files = [absolute('Docs', 'a.md'), absolute('docs', 'b.md')];
  const ancestor = commonAncestorDirectory(files);

  if (process.platform === 'win32') {
    assert.equal(ancestor.toLowerCase(), absolute('docs').toLowerCase());
  } else {
    // Case-sensitive filesystem: the two directories share only the root.
    assert.equal(ancestor, path.sep);
  }
});

test('commonAncestorDirectory falls back to the working directory across drives', (t) => {
  if (process.platform !== 'win32') {
    t.skip('only Windows paths can lack a common root');
    return;
  }

  const files = ['C:\\docs\\a.md', 'D:\\docs\\b.md'];

  assert.equal(commonAncestorDirectory(files), process.cwd());
});

test('joinDocuments separates documents with a blank-line-wrapped break block', () => {
  const merged = joinDocuments(['# One\n\nBody one.', '# Two\n\nBody two.']);

  assert.equal(merged, `# One\n\nBody one.\n\n${DOCUMENT_BREAK_HTML}\n\n# Two\n\nBody two.\n`);
});

test('joinDocuments adds no separator for a single document', () => {
  assert.equal(joinDocuments(['# Only']), '# Only\n');
  assert.equal(joinDocuments(['# Only']).includes(DOCUMENT_BREAK_HTML), false);
});

test('joinDocuments always terminates the merged file with exactly one newline', () => {
  assert.equal(joinDocuments(['a', 'b']).endsWith('b\n'), true);
  assert.equal(joinDocuments(['a', 'b']).endsWith('\n\n'), false);
});
