/**
 * The md-to-pdf argument list that `renderPdf` and `renderHtml` share (#64).
 */

import fs from 'fs';
import path from 'path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { MD_TO_PDF_CONFIG, buildMdToPdfArgs } from '../steps/md-to-pdf-args';
import { makeContext } from './helpers';

const root = path.resolve('fixture-root');

test('passes the converted Markdown, work directory, title and config file', () => {
  const workdir = path.join(root, 'work');
  const context = makeContext({ sourceFile: path.join(root, 'doc.md'), workdir, docTitle: 'My Report' });

  assert.deepEqual(buildMdToPdfArgs(context), [
    path.join(workdir, 'doc_converted.md'),
    '--basedir',
    workdir,
    '--document-title=My Report',
    '--config-file',
    MD_TO_PDF_CONFIG,
  ]);
});

test('adds the effective stylesheet only when there is one', () => {
  const stylesheet = path.join(root, 'style.css');
  const context = makeContext({ sourceFile: path.join(root, 'doc.md'), effectiveStylesheet: stylesheet });

  assert.deepEqual(buildMdToPdfArgs(context).slice(-2), ['--stylesheet', stylesheet]);
  assert.ok(!buildMdToPdfArgs(makeContext({ sourceFile: path.join(root, 'doc.md') })).includes('--stylesheet'));
});

test('keeps a title that starts with -- in a single argument', () => {
  const context = makeContext({ sourceFile: path.join(root, 'doc.md'), docTitle: '--version' });

  const args = buildMdToPdfArgs(context);

  assert.ok(args.includes('--document-title=--version'));
  assert.ok(!args.includes('--version'));
});

test('points at the bundled config file', () => {
  assert.equal(path.basename(MD_TO_PDF_CONFIG), 'md-to-pdf.config.json');
  assert.deepEqual(JSON.parse(fs.readFileSync(MD_TO_PDF_CONFIG, 'utf8')).pdf_options, { preferCSSPageSize: true });
});
