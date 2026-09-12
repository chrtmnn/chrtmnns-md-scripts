/**
 * Behaviour of the shared Markdown scanning primitives extracted in #26.
 * The interesting cases come from #18 (fence-unaware title extraction),
 * #10 (fence-aware TOC placement), #32 (headings hidden in HTML comments) and
 * #33 (the closing hash sequence and info-string fences).
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
  mapLiveContent,
  matchAtxHeading,
  matchFenceDelimiter,
  stripInlineComments,
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
  assert.deepEqual(matchFenceDelimiter('```'), { char: '`', len: 3, info: '' });
  assert.deepEqual(matchFenceDelimiter('~~~~~'), { char: '~', len: 5, info: '' });
  assert.deepEqual(matchFenceDelimiter('```ts'), { char: '`', len: 3, info: 'ts' });
});

test('matchFenceDelimiter reports the info string so a closer can be told apart (#33)', () => {
  assert.deepEqual(matchFenceDelimiter('~~~ js  '), { char: '~', len: 3, info: 'js' });
  assert.deepEqual(matchFenceDelimiter('```   '), { char: '`', len: 3, info: '' }, 'trailing spaces only');
  assert.deepEqual(matchFenceDelimiter('```{.bash #id}'), { char: '`', len: 3, info: '{.bash #id}' });
});

test('matchFenceDelimiter rejects short runs and 4-space indentation', () => {
  assert.equal(matchFenceDelimiter('``'), null);
  assert.equal(matchFenceDelimiter('~~'), null);
  assert.deepEqual(matchFenceDelimiter('   ```'), { char: '`', len: 3, info: '' });
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

test('findFirstHeading ignores headings inside HTML comment blocks (#32)', () => {
  assert.deepEqual(findFirstHeading(['<!--', '# commented out', '-->', '# Real']), { level: 1, text: 'Real' });
});

test('findFirstH2Index ignores h2 headings inside HTML comment blocks (#32)', () => {
  assert.equal(findFirstH2Index(['<!--', '## commented out', '-->', '## Real']), 3);
});

test('findFirstHeading handles the realistic commented-out draft section (#32)', () => {
  const document = lines(
    '<!--\n# Old Draft Title\nSome paragraph we are not shipping yet.\n-->\n\n# Actual Title\n',
  );
  assert.deepEqual(findFirstHeading(document), { level: 1, text: 'Actual Title' });
});

test('an HTML comment block swallows the rest of its closing line (#32)', () => {
  assert.equal(findFirstHeading(['<!-- note --> # Real']), null, 'a line-start comment is an HTML block');
  assert.equal(findFirstHeading(['<!--', '# hidden', '--> # also hidden']), null);
});

test('an inline comment after other content leaves the heading intact (#32)', () => {
  assert.deepEqual(findFirstHeading(['# Heading <!-- omit in toc -->']), { level: 1, text: 'Heading' });
  assert.equal(findFirstH2Index(['## Heading <!-- omit in toc -->']), 0);
});

test('an unclosed inline comment affects only its own line (#32)', () => {
  assert.deepEqual(findFirstHeading(['# Heading <!-- start', 'text', '-->']), { level: 1, text: 'Heading' });
  // A mid-line `<!--` must not open a block: the next line stays live.
  assert.deepEqual(findFirstHeading(['text <!-- start', '# Real']), { level: 1, text: 'Real' });
});

test('prose mentioning the comment delimiter cannot hide a later heading (#32)', () => {
  // An inline code span and an indented code sample both legitimately contain
  // `<!--`; neither may suppress the rest of the document.
  assert.deepEqual(findFirstHeading(['Use `<!--` to start a comment.', '', '# Real Title']), {
    level: 1,
    text: 'Real Title',
  });
  assert.deepEqual(findFirstHeading(['    <!-- example', '', '# Real Title']), { level: 1, text: 'Real Title' });
  assert.deepEqual(findFirstHeading(['The marker <!-- opens a comment', '', '# Real Title']), {
    level: 1,
    text: 'Real Title',
  });
  assert.equal(findFirstH2Index(['Use `<!--` here.', '', '## Real']), 2);
});

test('a line-start comment block that never closes hides the rest of the document (#32)', () => {
  assert.equal(findFirstHeading(['<!--', '# hidden', 'still hidden']), null);
  assert.equal(findFirstH2Index(['<!--', '## hidden']), -1);
});

test('the abbreviated empty comment closes on its own line (#32)', () => {
  assert.deepEqual(findFirstHeading(['<!-->', '# Real']), { level: 1, text: 'Real' });
  assert.deepEqual(findFirstHeading(['# Heading <!-->']), { level: 1, text: 'Heading' });
});

test('a comment inside a fenced code block does not open a comment block (#32)', () => {
  const document = ['```html', '<!--', '```', '# Real'];
  assert.deepEqual(findFirstHeading(document), { level: 1, text: 'Real' });
});

test('a fence inside an HTML comment block does not open a fence (#32)', () => {
  const document = ['<!--', '```', '-->', '# Real'];
  assert.deepEqual(findFirstHeading(document), { level: 1, text: 'Real' });
});

test('a setext underline hidden in a comment does not form a heading (#32)', () => {
  assert.equal(findFirstH2Index(['Underlined', '<!--', '---', '-->']), -1);
});

test('matchAtxHeading strips an optional closing hash sequence (#33)', () => {
  assert.deepEqual(matchAtxHeading('## Heading ##'), { level: 2, text: 'Heading' });
  assert.deepEqual(matchAtxHeading('# Title #'), { level: 1, text: 'Title' });
  assert.deepEqual(matchAtxHeading('##\tTabbed\t##'), { level: 2, text: 'Tabbed' });
  assert.deepEqual(matchAtxHeading('## Heading ##   '), { level: 2, text: 'Heading' });
});

test('matchAtxHeading keeps a hash run that does not close the heading (#33)', () => {
  assert.deepEqual(matchAtxHeading('## Heading#'), { level: 2, text: 'Heading#' }, 'no space before the run');
  assert.deepEqual(matchAtxHeading('## Heading ## x'), { level: 2, text: 'Heading ## x' }, 'not at the end');
  assert.deepEqual(matchAtxHeading('## C# and F#'), { level: 2, text: 'C# and F#' });
});

test('matchAtxHeading treats a hash-only remainder as an empty heading (#33)', () => {
  assert.deepEqual(matchAtxHeading('## #'), { level: 2, text: '' });
  assert.deepEqual(matchAtxHeading('## ##'), { level: 2, text: '' });
});

test('the closing hash sequence reaches the document title through findFirstHeading (#33)', () => {
  assert.deepEqual(findFirstHeading(lines('# My Title #\n\ntext\n')), { level: 1, text: 'My Title' });
});

test('a closing fence carrying an info string does not close the block (#33)', () => {
  assert.equal(findFirstH2Index(['```', '## inside', '```js', '## after']), -1);
  assert.equal(findFirstHeading(['```', '# inside', '```js', '# after']), null);
});

test('a fence still closes on a bare delimiter after one with an info string (#33)', () => {
  const document = ['```', '## inside', '```js', '## still inside', '```', '## real heading'];
  assert.equal(findFirstH2Index(document), 5);
});

test('stripInlineComments removes complete spans and truncates at an unclosed opener', () => {
  assert.equal(stripInlineComments('plain line'), 'plain line');
  assert.equal(stripInlineComments('a <!-- x --> b'), 'a  b');
  assert.equal(stripInlineComments('a <!-- x --> b <!-- y --> c'), 'a  b  c');
  assert.equal(stripInlineComments('a <!-- x'), 'a ');
  assert.equal(stripInlineComments('a <!-- x --> b <!-- y'), 'a  b ');
  assert.equal(stripInlineComments('a <!--> b'), 'a  b', 'the abbreviated empty comment');
});

test('mapLiveContent blanks out fenced blocks and comment blocks alike', () => {
  assert.deepEqual(mapLiveContent(['# A', '```', 'code', '```', '# B']), ['# A', null, null, null, '# B']);
  assert.deepEqual(mapLiveContent(['<!--', 'hidden', '-->', '# B']), [null, null, null, '# B']);
  assert.deepEqual(mapLiveContent(['# A <!-- note -->']), ['# A ']);
  assert.deepEqual(mapLiveContent(['a <!-- open', '# B']), ['a ', '# B'], 'a mid-line opener is line-local');
});

test('findFirstHeading recognises setext headings at both levels', () => {
  assert.deepEqual(findFirstHeading(['Underlined', '===']), { level: 1, text: 'Underlined' });
  assert.deepEqual(findFirstHeading(['Underlined', '---']), { level: 2, text: 'Underlined' });
  assert.equal(findFirstHeading(['Trailing text with no underline']), null);
});
