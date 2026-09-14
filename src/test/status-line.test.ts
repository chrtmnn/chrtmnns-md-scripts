/**
 * Behaviour of the live progress line from #65: what is written for an update,
 * how a line too long for the terminal is cut, and when nothing is written at
 * all.
 *
 * The reason this module exists rather than a `@clack/prompts` spinner is
 * pinned by the module's own doc comment: the pipeline is synchronous, so a
 * timer-driven spinner never paints a frame.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { CLEAR_STATUS_LINE, createStatusLine, formatStatusLine } from '../steps/status-line';

/** A stand-in for `process.stdout` that records what was written. */
function fakeStream(columns?: number): NodeJS.WriteStream & { written: string[] } {
  const written: string[] = [];
  return {
    written,
    columns,
    write: (chunk: string) => {
      written.push(chunk);
      return true;
    },
  } as unknown as NodeJS.WriteStream & { written: string[] };
}

test('formatStatusLine blanks the line before writing the text', () => {
  assert.equal(formatStatusLine('README.md · Rendering PDF', 80), `${CLEAR_STATUS_LINE}README.md · Rendering PDF`);
});

test('formatStatusLine truncates a line that would wrap (#65)', () => {
  const line = formatStatusLine('a'.repeat(50), 20).slice(CLEAR_STATUS_LINE.length);

  // A wrapped line occupies two rows and `\r` + erase clears only the last of
  // them, which would leave the first half on screen for good.
  assert.equal(line.length, 19);
  assert.equal(line, `${'a'.repeat(18)}…`);
});

test('formatStatusLine falls back to 80 columns when the terminal reports none (#65)', () => {
  // `columns` is undefined off a TTY and 0 on a pty with no window size; both
  // used to truncate every line down to a lone ellipsis.
  for (const columns of [undefined, 0, -5, Number.NaN]) {
    const line = formatStatusLine('a'.repeat(100), columns as number).slice(CLEAR_STATUS_LINE.length);
    assert.equal(line.length, 79, `columns=${String(columns)}`);
  }
});

test('createStatusLine writes each update to the stream', () => {
  const stream = fakeStream(40);
  const status = createStatusLine(stream, true);

  status.show('one');
  status.show('two');

  assert.deepEqual(stream.written, [`${CLEAR_STATUS_LINE}one`, `${CLEAR_STATUS_LINE}two`]);
});

test('createStatusLine blanks the line on hide, once', () => {
  const stream = fakeStream(40);
  const status = createStatusLine(stream, true);

  status.show('one');
  status.hide();
  status.hide();

  assert.deepEqual(stream.written, [`${CLEAR_STATUS_LINE}one`, CLEAR_STATUS_LINE]);
});

test('createStatusLine hides nothing when no line is showing', () => {
  const stream = fakeStream(40);

  createStatusLine(stream, true).hide();

  assert.deepEqual(stream.written, []);
});

test('createStatusLine writes nothing when disabled', () => {
  const stream = fakeStream(40);
  const status = createStatusLine(stream, false);

  status.show('one');
  status.hide();

  assert.deepEqual(stream.written, [], 'a piped run or --verbose must stay free of escape sequences');
});

test('createStatusLine reads the width per update, so a resize is picked up', () => {
  const stream = fakeStream(10);
  const status = createStatusLine(stream, true);

  status.show('a'.repeat(30));
  (stream as { columns: number }).columns = 40;
  status.show('a'.repeat(30));

  assert.equal(stream.written[0].slice(CLEAR_STATUS_LINE.length).length, 9);
  assert.equal(stream.written[1].slice(CLEAR_STATUS_LINE.length).length, 30);
});
