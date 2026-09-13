/**
 * Behaviour of the final copy step (#45): outputs are swapped in atomically,
 * a failure never destroys the previous file, and a debug HTML that md2pdf
 * did not write is never replaced.
 */

import fs from 'fs';
import path from 'path';
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { assertOutputReplaceable, copyOutput } from '../steps/copy-output';
import { GENERATOR_MARKER, stampGeneratedHtml } from '../steps/output-targets';
import { makeContext, makeOptions, tempDir, writeFile } from './helpers';

/**
 * Builds a context whose work directory and target directory are separate
 * folders of one fixture directory.
 */
function fixture(t: TestContext, debug = false) {
  const dir = tempDir(t);
  const source = writeFile(dir, 'src/doc.md', '# Doc\n');
  const workdir = path.join(dir, 'work');
  const targetDir = path.join(dir, 'out');
  fs.mkdirSync(workdir);
  fs.mkdirSync(targetDir);

  const context = makeContext({ sourceFile: source, workdir, targetDir, options: makeOptions({ debug }) });
  return { context, targetDir };
}

test('replaces an existing PDF with the rendered one', (t) => {
  const { context, targetDir } = fixture(t);
  fs.writeFileSync(context.tempPdf, 'new pdf');
  fs.writeFileSync(context.outputPdf, 'old pdf');

  copyOutput(context);

  assert.equal(fs.readFileSync(context.outputPdf, 'utf8'), 'new pdf');
  assert.deepEqual(fs.readdirSync(targetDir), ['doc.pdf'], 'no staging file is left behind');
});

test('copies the debug HTML next to the PDF', (t) => {
  const { context, targetDir } = fixture(t, true);
  fs.writeFileSync(context.tempPdf, 'pdf');
  fs.writeFileSync(context.tempHtml, stampGeneratedHtml('<html><head></head></html>'));

  copyOutput(context);

  assert.equal(fs.readFileSync(context.outputHtml, 'utf8').includes(GENERATOR_MARKER), true);
  assert.deepEqual(fs.readdirSync(targetDir).sort(), ['doc.html', 'doc.pdf']);
});

test('a missing rendered PDF leaves the previous PDF untouched', (t) => {
  const { context } = fixture(t);
  fs.writeFileSync(context.outputPdf, 'old pdf');

  assert.throws(() => copyOutput(context), /PDF generation failed/);
  assert.equal(fs.readFileSync(context.outputPdf, 'utf8'), 'old pdf');
});

test('a missing debug HTML fails before the PDF is replaced', (t) => {
  const { context } = fixture(t, true);
  fs.writeFileSync(context.tempPdf, 'new pdf');
  fs.writeFileSync(context.outputPdf, 'old pdf');

  assert.throws(() => copyOutput(context), /HTML generation failed/);
  assert.equal(fs.readFileSync(context.outputPdf, 'utf8'), 'old pdf');
});

test('a failed swap removes the staged file and keeps what was there', (t) => {
  const { context, targetDir } = fixture(t);
  fs.writeFileSync(context.tempPdf, 'new pdf');
  // A non-empty directory at the output path makes the rename fail on every platform.
  writeFile(targetDir, 'doc.pdf/keep.txt', 'kept');

  assert.throws(() => copyOutput(context));
  assert.deepEqual(fs.readdirSync(targetDir), ['doc.pdf'], 'no staging file is left behind');
  assert.equal(fs.readFileSync(path.join(targetDir, 'doc.pdf', 'keep.txt'), 'utf8'), 'kept');
});

test('refuses to overwrite a hand-written HTML file and writes nothing', (t) => {
  const { context, targetDir } = fixture(t, true);
  fs.writeFileSync(context.tempPdf, 'new pdf');
  fs.writeFileSync(context.tempHtml, stampGeneratedHtml('<html><head></head></html>'));
  fs.writeFileSync(context.outputHtml, '<html><head><title>Mine</title></head></html>');

  assert.throws(() => assertOutputReplaceable(context), /Refusing to overwrite .*doc\.html/);
  assert.throws(() => copyOutput(context), /Refusing to overwrite/);
  assert.equal(fs.readFileSync(context.outputHtml, 'utf8'), '<html><head><title>Mine</title></head></html>');
  assert.deepEqual(fs.readdirSync(targetDir), ['doc.html'], 'the PDF is not written either');
});

test('replaces an HTML file md2pdf generated earlier', (t) => {
  const { context } = fixture(t, true);
  fs.writeFileSync(context.tempPdf, 'pdf');
  fs.writeFileSync(context.tempHtml, stampGeneratedHtml('<html><head></head><body>new</body></html>'));
  fs.writeFileSync(context.outputHtml, stampGeneratedHtml('<html><head></head><body>old</body></html>'));

  assert.doesNotThrow(() => assertOutputReplaceable(context));
  copyOutput(context);

  assert.match(fs.readFileSync(context.outputHtml, 'utf8'), /new/);
});

test('an existing HTML file is irrelevant without --debug', (t) => {
  const { context } = fixture(t);
  fs.writeFileSync(context.tempPdf, 'pdf');
  fs.writeFileSync(context.outputHtml, 'hand-written');

  copyOutput(context);

  assert.equal(fs.readFileSync(context.outputHtml, 'utf8'), 'hand-written');
  assert.equal(fs.readFileSync(context.outputPdf, 'utf8'), 'pdf');
});
