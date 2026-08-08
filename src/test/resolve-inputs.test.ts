/**
 * Behaviour of the directory expansion added for #6: which files are picked
 * up, in which order, what is skipped while recursing, and how duplicates and
 * links are handled.
 */

import fs from 'fs';
import path from 'path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveInputs } from '../steps/resolve-inputs';
import { comparablePath, makeOptions, names, tempDir, tryJunction, trySymlink, writeFile } from './helpers';

test('keeps file positionals and forwards missing ones verbatim', (t) => {
  const dir = tempDir(t);
  const file = writeFile(dir, 'doc.md', '# Doc');

  const { files, warnings } = resolveInputs([file, 'does-not-exist.md'], makeOptions());

  assert.deepEqual(files, [file, 'does-not-exist.md']);
  assert.deepEqual(warnings, []);
});

test('expands a directory into its Markdown files at the positional position', (t) => {
  const dir = tempDir(t);
  writeFile(dir, 'b.md', '# B');
  writeFile(dir, 'a.md', '# A');
  writeFile(dir, 'notes.txt', 'not markdown');
  const other = writeFile(dir, 'other/z.md', '# Z');

  const { files } = resolveInputs([other, path.join(dir, '.')], makeOptions());

  assert.deepEqual(names(files), ['z.md', 'a.md', 'b.md']);
});

test('matches the .md extension case-insensitively but not .markdown', (t) => {
  const dir = tempDir(t);
  writeFile(dir, 'lower.md', '# lower');
  writeFile(dir, 'upper.MD', '# upper');
  writeFile(dir, 'long.markdown', '# long');

  const { files } = resolveInputs([dir], makeOptions());

  assert.deepEqual(names(files), ['lower.md', 'upper.MD']);
});

test('orders names by UTF-16 code units, so uppercase sorts before lowercase', (t) => {
  const dir = tempDir(t);
  // Names differ beyond their case: on Windows a case-only pair would be the
  // same file. `localeCompare` would order these Beta, alpha, yankee, Zulu.
  for (const name of ['yankee.md', 'Zulu.md', 'alpha.md', 'Beta.md']) {
    writeFile(dir, name, `# ${name}`);
  }

  const { files } = resolveInputs([dir], makeOptions());

  assert.deepEqual(names(files), ['Beta.md', 'Zulu.md', 'alpha.md', 'yankee.md']);
});

test('without --recursive, subdirectories are not descended into', (t) => {
  const dir = tempDir(t);
  writeFile(dir, 'top.md', '# top');
  writeFile(dir, 'sub/nested.md', '# nested');

  const { files } = resolveInputs([dir], makeOptions());

  assert.deepEqual(names(files), ['top.md']);
});

test('--recursive lists a directory own files first, then its subdirectories in order', (t) => {
  const dir = tempDir(t);
  writeFile(dir, 'zz-top.md', '# top');
  writeFile(dir, 'aa-top.md', '# top');
  writeFile(dir, 'b-sub/inner.md', '# inner');
  writeFile(dir, 'b-sub/deeper/deep.md', '# deep');
  writeFile(dir, 'a-sub/inner.md', '# inner');

  const { files } = resolveInputs([dir], makeOptions({ recursive: true }));

  assert.deepEqual(names(files), ['aa-top.md', 'zz-top.md', 'inner.md', 'inner.md', 'deep.md']);
  assert.deepEqual(
    files.map((file) => comparablePath(path.relative(dir, file))),
    ['aa-top.md', 'zz-top.md', 'a-sub/inner.md', 'b-sub/inner.md', 'b-sub/deeper/deep.md'],
  );
});

test('--recursive never descends into node_modules, .git or dot directories', (t) => {
  const dir = tempDir(t);
  writeFile(dir, 'keep.md', '# keep');
  writeFile(dir, 'node_modules/pkg/readme.md', '# skipped');
  writeFile(dir, '.git/notes.md', '# skipped');
  writeFile(dir, '.hidden/secret.md', '# skipped');

  const { files } = resolveInputs([dir], makeOptions({ recursive: true }));

  assert.deepEqual(names(files), ['keep.md']);
});

test('a skipped directory is still expanded when passed explicitly', (t) => {
  const dir = tempDir(t);
  writeFile(dir, 'node_modules/readme.md', '# explicit');

  const { files } = resolveInputs([path.join(dir, 'node_modules')], makeOptions());

  assert.deepEqual(names(files), ['readme.md']);
});

test('--recursive is a no-op for file positionals', (t) => {
  const dir = tempDir(t);
  const file = writeFile(dir, 'doc.md', '# Doc');
  writeFile(dir, 'sub/nested.md', '# nested');

  const { files } = resolveInputs([file], makeOptions({ recursive: true }));

  assert.deepEqual(files, [file]);
});

test('deduplicates by resolved absolute path, keeping the first occurrence', (t) => {
  const dir = tempDir(t);
  const inner = writeFile(dir, 'doc.md', '# Doc');
  writeFile(dir, 'second.md', '# Second');

  const { files } = resolveInputs([inner, dir, inner], makeOptions());

  assert.deepEqual(names(files), ['doc.md', 'second.md']);
});

test('deduplicates a differently spelled path of the same file', (t) => {
  const dir = tempDir(t);
  const file = writeFile(dir, 'doc.md', '# Doc');
  const detour = path.join(dir, 'sub', '..', 'doc.md');
  fs.mkdirSync(path.join(dir, 'sub'), { recursive: true });

  const { files } = resolveInputs([file, detour], makeOptions());

  assert.deepEqual(files, [file]);
});

test('deduplicates case-insensitively on Windows only', (t) => {
  const dir = tempDir(t);
  const file = writeFile(dir, 'Doc.md', '# Doc');
  const upperCased = path.join(dir, 'DOC.MD');

  const { files } = resolveInputs([file, upperCased], makeOptions());

  if (process.platform === 'win32') {
    assert.deepEqual(files, [file], 'the same file spelled two ways is converted once');
  } else {
    // On a case-sensitive filesystem `DOC.MD` is a different, missing file and
    // is forwarded verbatim for the "Skipped missing file" warning.
    assert.deepEqual(files, [file, upperCased]);
  }
});

test('an empty directory produces a warning, not a failure', (t) => {
  const dir = tempDir(t);
  fs.mkdirSync(path.join(dir, 'empty'));

  const plain = resolveInputs([path.join(dir, 'empty')], makeOptions());
  assert.deepEqual(plain.files, []);
  assert.equal(plain.warnings.length, 1);
  assert.equal(plain.warnings[0].includes('searched recursively'), false);

  const recursive = resolveInputs([path.join(dir, 'empty')], makeOptions({ recursive: true }));
  assert.equal(recursive.warnings[0].includes('searched recursively'), true);
});

test('a directory containing only non-Markdown files warns as empty', (t) => {
  const dir = tempDir(t);
  writeFile(dir, 'notes.txt', 'text');

  const { files, warnings } = resolveInputs([dir], makeOptions());

  assert.deepEqual(files, []);
  assert.equal(warnings.length, 1);
});

test('collects symlinked Markdown files but never follows directory symlinks', (t) => {
  const dir = tempDir(t);
  const real = writeFile(dir, 'real/doc.md', '# Doc');
  writeFile(dir, 'tree/keep.md', '# keep');

  const fileLink = path.join(dir, 'tree', 'linked.md');
  const dirLink = path.join(dir, 'tree', 'loop');

  if (!trySymlink(real, fileLink, 'file') || !trySymlink(path.join(dir, 'tree'), dirLink, 'dir')) {
    t.skip('creating symlinks requires Developer Mode or elevation on Windows');
    return;
  }

  const { files } = resolveInputs([path.join(dir, 'tree')], makeOptions({ recursive: true }));

  assert.deepEqual(names(files), ['keep.md', 'linked.md'], 'the link cycle must not be descended into');
});

test('a dangling Markdown symlink is skipped', (t) => {
  const dir = tempDir(t);
  writeFile(dir, 'tree/keep.md', '# keep');
  const dangling = path.join(dir, 'tree', 'gone.md');

  if (!trySymlink(path.join(dir, 'missing.md'), dangling, 'file')) {
    t.skip('creating symlinks requires Developer Mode or elevation on Windows');
    return;
  }

  const { files } = resolveInputs([path.join(dir, 'tree')], makeOptions());

  assert.deepEqual(names(files), ['keep.md']);
});

test('a Windows directory junction is not descended into', (t) => {
  const dir = tempDir(t);
  writeFile(dir, 'tree/keep.md', '# keep');
  writeFile(dir, 'elsewhere/other.md', '# other');

  if (!tryJunction(path.join(dir, 'elsewhere'), path.join(dir, 'tree', 'junction'))) {
    t.skip('directory junctions only exist on Windows');
    return;
  }

  const { files } = resolveInputs([path.join(dir, 'tree')], makeOptions({ recursive: true }));

  assert.deepEqual(names(files), ['keep.md']);
});

test('an explicitly passed symlinked file is followed', (t) => {
  const dir = tempDir(t);
  const real = writeFile(dir, 'real.md', '# Real');
  const link = path.join(dir, 'link.md');

  if (!trySymlink(real, link, 'file')) {
    t.skip('creating symlinks requires Developer Mode or elevation on Windows');
    return;
  }

  const { files } = resolveInputs([link], makeOptions());

  assert.deepEqual(files, [link], 'the user-supplied spelling is preserved');
});
