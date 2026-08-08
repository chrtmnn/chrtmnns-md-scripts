/**
 * Behaviour of the shared Markdown scanning primitives extracted in #26.
 * The interesting cases come from #18 (fence-unaware title extraction) and
 * #10 (fence-aware TOC placement).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  findFirstH2Index,
  findFirstHeading,
  findFrontmatterEnd,
  isAtxH2,
  isBlank,
  isPotentialSetextText,
  isSetextH1Underline,
  isSetextH2Underline,
  matchAtxHeading,
  matchFenceDelimiter,
} from '../steps/markdown-scan';

/**
 * Splits a fixture written as a template literal into scanner input.
 *
 * @param text - Fixture document.
 * @returns The document's lines without terminators.
 */
function lines(text: string): string[] {
  return text.split('\n');
}

test('isBlank treats whitespace-only lines as blank', () => {
  assert.equal(isBlank(''), true);
  assert.equal(isBlank('   '), true);
  assert.equal(isBlank('\t'), true);
  assert.equal(isBlank('x'), false);
  assert.equal(isBlank('  .'), false);
});

test('matchFenceDelimiter accepts both fence characters and reports the run length', () => {
  assert.deepEqual(matchFenceDelimiter('```'), { char: '`', len: 3 });
  assert.deepEqual(matchFenceDelimiter('~~~~~'), { char: '~', len: 5 });
  assert.deepEqual(matchFenceDelimiter('```ts'), { char: '`', len: 3 });
});

test('matchFenceDelimiter rejects short runs and 4-space indentation', () => {
  assert.equal(matchFenceDelimiter('``'), null);
  assert.equal(matchFenceDelimiter('~~'), null);
  assert.deepEqual(matchFenceDelimiter('   ```'), { char: '`', len: 3 });
  assert.equal(matchFenceDelimiter('    ```'), null, 'four spaces is an indented code block');
});

test('isAtxH2 requires exactly two hashes followed by space or end of line', () => {
  assert.equal(isAtxH2('## Heading'), true);
  assert.equal(isAtxH2('##'), true);
  assert.equal(isAtxH2('   ## Indented'), true);
  assert.equal(isAtxH2('# Heading'), false);
  assert.equal(isAtxH2('### Heading'), false);
  assert.equal(isAtxH2('##Heading'), false);
});

test('setext underlines are recognised per level', () => {
  assert.equal(isSetextH1Underline('==='), true);
  assert.equal(isSetextH1Underline('=   '), true);
  assert.equal(isSetextH1Underline('=== text'), false);
  assert.equal(isSetextH2Underline('---'), true);
  assert.equal(isSetextH2Underline('  -'), true);
  assert.equal(isSetextH2Underline('- item'), false);
});

test('isPotentialSetextText rejects other block starts', () => {
  assert.equal(isPotentialSetextText('Title'), true);
  assert.equal(isPotentialSetextText(''), false);
  assert.equal(isPotentialSetextText('# Heading'), false);
  assert.equal(isPotentialSetextText('```'), false);
  assert.equal(isPotentialSetextText('- item'), false);
  assert.equal(isPotentialSetextText('1. item'), false);
  assert.equal(isPotentialSetextText('> quote'), false);
});

test('matchAtxHeading reports level and trimmed text', () => {
  assert.deepEqual(matchAtxHeading('# Title'), { level: 1, text: 'Title' });
  assert.deepEqual(matchAtxHeading('###   Spaced   '), { level: 3, text: 'Spaced' });
  assert.deepEqual(matchAtxHeading('###### Six'), { level: 6, text: 'Six' });
  assert.deepEqual(matchAtxHeading('#'), { level: 1, text: '' });
  assert.deepEqual(matchAtxHeading('   ## Indented'), { level: 2, text: 'Indented' });
});

test('matchAtxHeading rejects #hashtag, seven hashes and indented code (#18)', () => {
  assert.equal(matchAtxHeading('#hashtag'), null);
  assert.equal(matchAtxHeading('####### Seven'), null);
  assert.equal(matchAtxHeading('    # Indented code'), null);
});

test('findFirstH2Index finds ATX and setext second-order headings', () => {
  assert.equal(findFirstH2Index(lines('# Title\n\ntext\n\n## Second\n')), 4);
  assert.equal(findFirstH2Index(lines('# Title\n\nSecond\n---\n')), 2);
  assert.equal(findFirstH2Index(lines('# Title\n\nno h2 here\n')), -1);
});

test('findFirstH2Index ignores headings inside fenced code blocks', () => {
  const document = ['```bash', '## not a heading', '```', '', '## real heading'];
  assert.equal(findFirstH2Index(document), 4);
});

test('findFirstH2Index only closes a fence with a run of the same character', () => {
  const document = ['~~~', '## inside tilde fence', '```', '## still inside', '~~~', '## real heading'];
  assert.equal(findFirstH2Index(document), 5);
});

test('findFirstH2Index requires the closing run to be at least as long as the opening one', () => {
  const document = ['````', '## inside', '```', '## still inside', '````', '## real heading'];
  assert.equal(findFirstH2Index(document), 5);
});

test('findFirstH2Index does not treat a list item followed by dashes as setext', () => {
  const document = ['# Title', '', '- item', '---', '', '## real heading'];
  assert.equal(findFirstH2Index(document), 5);
});

test('findFrontmatterEnd locates the closing delimiter', () => {
  assert.equal(findFrontmatterEnd(lines('---\ntitle: x\n---\n# H\n')), 2);
  assert.equal(findFrontmatterEnd(lines('---\ntitle: x\n...\n# H\n')), 2);
  assert.equal(findFrontmatterEnd(['---  ', 'title: x', '---\t']), 2);
});

test('findFrontmatterEnd ignores non-leading and unterminated blocks', () => {
  assert.equal(findFrontmatterEnd(lines('# H\n\n---\ntitle: x\n---\n')), -1);
  assert.equal(findFrontmatterEnd(lines('---\ntitle: x\n\nrest of the file\n')), -1);
  assert.equal(findFrontmatterEnd([]), -1);
  assert.equal(findFrontmatterEnd(['--- title: x']), -1);
});

test('findFirstHeading returns the first heading of any level', () => {
  assert.deepEqual(findFirstHeading(lines('### Deep first\n\n# Later h1\n')), { level: 3, text: 'Deep first' });
  assert.equal(findFirstHeading(lines('just text\n\nmore text\n')), null);
});

test('findFirstHeading skips fenced code blocks (#18 fixture)', () => {
  const document = lines('```bash\n# install the dependencies\nnpm install\n```\n\n# Real Document Title\n\ntext\n');
  assert.deepEqual(findFirstHeading(document), { level: 1, text: 'Real Document Title' });
});

test('findFirstHeading skips #hashtag lines and indented code (#18)', () => {
  assert.deepEqual(findFirstHeading(lines('#hashtag\n\n# Real Title\n')), { level: 1, text: 'Real Title' });
  assert.deepEqual(findFirstHeading(lines('    # indented code\n\n# Real Title\n')), { level: 1, text: 'Real Title' });
});

// ANOMALY (not a regression, pre-existing): the scan is fence-aware but not
// HTML-comment-aware, so a heading that the author commented out still wins.
// Same failure mode as #18, different container. Skipped because the
// production code does not do this yet; do not change the assertion to match
// the current behaviour.
test('findFirstHeading should ignore headings inside HTML comment blocks', { skip: 'known gap, see PR notes' }, () => {
  assert.deepEqual(findFirstHeading(['<!--', '# commented out', '-->', '# Real']), { level: 1, text: 'Real' });
});

// ANOMALY (not a regression, pre-existing): CommonMark allows an optional
// closing hash sequence (`## Heading ##`), which should not be part of the
// heading text. It currently ends up in the PDF's document title.
test('matchAtxHeading should strip an optional closing hash sequence', { skip: 'known gap, see PR notes' }, () => {
  assert.deepEqual(matchAtxHeading('## Heading ##'), { level: 2, text: 'Heading' });
});

test('findFirstHeading recognises setext headings at both levels', () => {
  assert.deepEqual(findFirstHeading(['Underlined', '===']), { level: 1, text: 'Underlined' });
  assert.deepEqual(findFirstHeading(['Underlined', '---']), { level: 2, text: 'Underlined' });
  assert.equal(findFirstHeading(['Trailing text with no underline']), null);
});
