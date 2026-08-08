/**
 * Behaviour of the fence-aware title extraction from #18 / PR #26.
 */

import path from 'path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { extractTitle } from '../steps/extract-title';
import { makeContext, tempDir, writeFile } from './helpers';

/**
 * Runs `extractTitle` over a fixture document.
 *
 * @param dir - Fixture directory.
 * @param markdown - Document contents.
 * @returns The resulting document title.
 */
function titleOf(dir: string, markdown: string): string {
  const file = writeFile(dir, 'doc.md', markdown);
  const context = makeContext({ sourceFile: file, inputMarkdown: file });
  extractTitle(context);
  return context.docTitle;
}

test('uses the first ATX heading', (t) => {
  const dir = tempDir(t);

  assert.equal(titleOf(dir, '# Real Document Title\n\ntext\n'), 'Real Document Title');
});

test('ignores # comments inside fenced code blocks (#18 fixture)', (t) => {
  const dir = tempDir(t);
  const markdown = '```bash\n# install the dependencies\nnpm install\n```\n\n# Real Document Title\n\ntext\n';

  assert.equal(titleOf(dir, markdown), 'Real Document Title');
});

test('ignores headings inside a tilde fence', (t) => {
  const dir = tempDir(t);

  assert.equal(titleOf(dir, '~~~\n### Fenced\n~~~\n\n# Real Title\n'), 'Real Title');
});

test('ignores #hashtag lines with no space after the hash (#18)', (t) => {
  const dir = tempDir(t);

  assert.equal(titleOf(dir, '#hashtag\n\n# Real Title\n'), 'Real Title');
});

test('ignores lines indented four or more spaces (#18)', (t) => {
  const dir = tempDir(t);

  assert.equal(titleOf(dir, '    # indented code\n\n# Real Title\n'), 'Real Title');
});

test('skips a YAML frontmatter block, including its comments (#18)', (t) => {
  const dir = tempDir(t);
  const markdown = '---\n# a frontmatter comment\ntitle: meta\n---\n\n# Real Title\n';

  assert.equal(titleOf(dir, markdown), 'Real Title');
});

test('accepts a setext heading as the title', (t) => {
  const dir = tempDir(t);

  assert.equal(titleOf(dir, 'Underlined Title\n================\n\ntext\n'), 'Underlined Title');
});

test('takes the first heading of any level', (t) => {
  const dir = tempDir(t);

  assert.equal(titleOf(dir, '### Deep First\n\n# Later H1\n'), 'Deep First');
});

test('keeps the fallback title when the document has no heading', (t) => {
  const dir = tempDir(t);
  const file = writeFile(dir, 'my-report.md', 'just text, no heading\n');
  const context = makeContext({ sourceFile: file, inputMarkdown: file });

  extractTitle(context);

  assert.equal(context.docTitle, 'my-report', 'falls back to the file stem set by prepareWorkdir');
});

test('handles CRLF documents', (t) => {
  const dir = tempDir(t);

  assert.equal(titleOf(dir, '```bash\r\n# comment\r\n```\r\n\r\n# Real Title\r\n'), 'Real Title');
});

test('reads the pipeline input file, not the source file', (t) => {
  const dir = tempDir(t);
  const source = writeFile(dir, 'doc.md', '# Source Heading\n');
  const temp = writeFile(dir, 'work/doc.md', '# Temp Copy Heading\n');
  const context = makeContext({ sourceFile: source, inputMarkdown: temp, workdir: path.dirname(temp) });

  extractTitle(context);

  assert.equal(context.docTitle, 'Temp Copy Heading');
});
