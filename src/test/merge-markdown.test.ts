/**
 * Behaviour of the merge assembly step (#6) including the per-document image
 * absolutisation added by #28.
 *
 * Nothing here asserts the *name* of the merge temp directory: PR #30 changes
 * how that name is generated, and the contract these tests pin down is that
 * the directory exists, is distinct per run, and is the one the merged file
 * lives in.
 */

import fs from 'fs';
import path from 'path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { DOCUMENT_BREAK_HTML } from '../steps/merge-assembly';
import { mergeMarkdown } from '../steps/merge-markdown';
import { comparablePath, makeOptions, tempDir, writePng, writeFile } from './helpers';

test('concatenates documents with a break block between them', (t) => {
  const dir = tempDir(t);
  const a = writeFile(dir, 'a.md', '# A\n\nBody A.\n');
  const b = writeFile(dir, 'b.md', '# B\n\nBody B.\n');

  const result = mergeMarkdown([a, b], makeOptions({ merge: 'combined' }));

  const merged = fs.readFileSync(result.mergedFile, 'utf8');
  assert.equal(merged, `# A\n\nBody A.\n\n${DOCUMENT_BREAK_HTML}\n\n# B\n\nBody B.\n`);
  assert.equal(result.mergedCount, 2);
  assert.deepEqual(result.skipped, []);
});

test('a document without a trailing newline cannot glue onto the next one', (t) => {
  const dir = tempDir(t);
  const a = writeFile(dir, 'a.md', 'last line of A');
  const b = writeFile(dir, 'b.md', '# B\n');

  const merged = fs.readFileSync(
    mergeMarkdown([a, b], makeOptions({ merge: 'combined' })).mergedFile,
    'utf8',
  );

  assert.equal(merged.includes(`last line of A\n\n${DOCUMENT_BREAK_HTML}`), true);
});

test('strips a UTF-8 BOM from every document, not just the first', (t) => {
  const dir = tempDir(t);
  const a = writeFile(dir, 'a.md', '\uFEFF# A\n');
  const b = writeFile(dir, 'b.md', '\uFEFF# B\n');

  const merged = fs.readFileSync(
    mergeMarkdown([a, b], makeOptions({ merge: 'combined' })).mergedFile,
    'utf8',
  );

  assert.equal(merged.includes('\uFEFF'), false);
  assert.equal(merged.startsWith('# A'), true);
});

test('names the merged file after --merge so the rest of the pipeline derives from it', (t) => {
  const dir = tempDir(t);
  const a = writeFile(dir, 'a.md', '# A\n');

  const result = mergeMarkdown([a], makeOptions({ merge: 'quarterly-report' }));

  assert.equal(path.basename(result.mergedFile), 'quarterly-report.md');
});

test('creates a distinct, existing merge directory per run', (t) => {
  const dir = tempDir(t);
  const a = writeFile(dir, 'a.md', '# A\n');
  const options = makeOptions({ merge: 'combined' });

  const first = mergeMarkdown([a], options);
  const second = mergeMarkdown([a], options);

  for (const result of [first, second]) {
    assert.equal(fs.statSync(result.mergeDir).isDirectory(), true);
    assert.equal(comparablePath(path.dirname(result.mergedFile)), comparablePath(result.mergeDir));
  }
  assert.notEqual(comparablePath(first.mergeDir), comparablePath(second.mergeDir));
});

test('honours --temp-root and --temp-in-output for the merge directory', (t) => {
  const dir = tempDir(t);
  const a = writeFile(dir, 'a.md', '# A\n');
  const root = path.join(dir, 'scratch');
  const out = path.join(dir, 'out');

  const rooted = mergeMarkdown([a], makeOptions({ merge: 'combined', tempRoot: root }));
  assert.equal(comparablePath(path.dirname(rooted.mergeDir)), comparablePath(root));

  const inOutput = mergeMarkdown(
    [a],
    makeOptions({ merge: 'combined', tempInOutput: true, outputDir: out }),
  );
  assert.equal(comparablePath(path.dirname(inOutput.mergeDir)), comparablePath(out));
});

test('defaults the target directory to the common ancestor, unless -o is given', (t) => {
  const dir = tempDir(t);
  const a = writeFile(dir, 'one/a.md', '# A\n');
  const b = writeFile(dir, 'two/b.md', '# B\n');

  const defaulted = mergeMarkdown([a, b], makeOptions({ merge: 'combined' }));
  assert.equal(comparablePath(defaulted.targetDir), comparablePath(dir));

  const explicit = mergeMarkdown(
    [a, b],
    makeOptions({ merge: 'combined', outputDir: path.join(dir, 'out') }),
  );
  assert.equal(comparablePath(explicit.targetDir), comparablePath(path.join(dir, 'out')));
  assert.equal(fs.existsSync(explicit.targetDir), true, 'the target directory is created');
});

test('warns once when the inputs span more than one directory', (t) => {
  const dir = tempDir(t);
  const a = writeFile(dir, 'one/a.md', '# A\n');
  const b = writeFile(dir, 'two/b.md', '# B\n');

  const spread = mergeMarkdown([a, b], makeOptions({ merge: 'combined' }));
  assert.equal(spread.warnings.length, 1);
  assert.match(spread.warnings[0], /relative links are not rewritten/);

  const together = mergeMarkdown([a, a], makeOptions({ merge: 'combined' }));
  assert.deepEqual(together.warnings, []);
});

test('reports missing inputs as skipped instead of failing', (t) => {
  const dir = tempDir(t);
  const a = writeFile(dir, 'a.md', '# A\n');
  const missing = path.join(dir, 'gone.md');

  const result = mergeMarkdown([a, missing], makeOptions({ merge: 'combined' }));

  assert.deepEqual(result.skipped, [missing]);
  assert.equal(result.mergedCount, 1);
});

test('throws when nothing can be merged or when --merge is absent', (t) => {
  const dir = tempDir(t);
  const a = writeFile(dir, 'a.md', '# A\n');

  assert.throws(
    () => mergeMarkdown([path.join(dir, 'gone.md')], makeOptions({ merge: 'combined' })),
    /Nothing to merge/,
  );
  assert.throws(() => mergeMarkdown([a], makeOptions()), /without --merge/);
});

test('pins relative image targets to their own source document (#28)', (t) => {
  const dir = tempDir(t);
  const a = writeFile(dir, 'one/a.md', '# A\n\n![logo](images/logo.png)\n');
  const b = writeFile(dir, 'two/b.md', '# B\n\n![logo](images/logo.png)\n');
  writePng(dir, 'one/images/logo.png');
  writePng(dir, 'two/images/logo.png');

  const merged = fs.readFileSync(
    mergeMarkdown([a, b], makeOptions({ merge: 'combined' })).mergedFile,
    'utf8',
  );

  const expectedA = path.join(dir, 'one', 'images', 'logo.png').split(path.sep).join('/');
  const expectedB = path.join(dir, 'two', 'images', 'logo.png').split(path.sep).join('/');
  assert.equal(merged.includes(`![logo](${expectedA})`), true, merged);
  assert.equal(merged.includes(`![logo](${expectedB})`), true, merged);
});

test('leaves image targets that do not resolve exactly as written (#28)', (t) => {
  const dir = tempDir(t);
  const a = writeFile(dir, 'a.md', '![gone](images/missing.png)\n\n![remote](https://example.com/x.png)\n');

  const merged = fs.readFileSync(
    mergeMarkdown([a], makeOptions({ merge: 'combined' })).mergedFile,
    'utf8',
  );

  assert.equal(merged.includes('![gone](images/missing.png)'), true);
  assert.equal(merged.includes('![remote](https://example.com/x.png)'), true);
});
