/**
 * Behaviour of the command-line declaration itself (#59): the sectioned help
 * and the promise that every previous option name still parses.
 *
 * The sections come from Commander's `optionsGroup()`. An option declared
 * outside a group lands in a generic "Options:" section instead, so the test
 * that matters is the one that catches an option nobody put in a group.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createProgram, packageVersion } from '../cli-program';

/**
 * Renders the help as `md2pdf --help` prints it, wide enough that no
 * description wraps onto a second line.
 */
function helpText(): string {
  return createProgram()
    .configureOutput({ getOutHelpWidth: () => 300 })
    .helpInformation();
}

/** The option rows under one section heading. */
function section(help: string, heading: string): string[] {
  const lines = help.split('\n');
  const start = lines.indexOf(`${heading}:`);
  assert.notEqual(start, -1, `the help has a ${heading} section`);

  const end = lines.indexOf('', start);
  return lines.slice(start + 1, end === -1 ? undefined : end);
}

test('every visible option has exactly one row, and none falls into a generic section', () => {
  const program = createProgram();
  const help = helpText();

  assert.equal(help.split('\n').includes('Options:'), false, 'an option was declared outside every optionsGroup');

  for (const flags of [...program.options.filter((option) => !option.hidden).map((option) => option.flags), '-h, --help']) {
    // Counted per row rather than per substring: a description may well
    // mention another option, as `--debug` does with `--html`.
    const rows = help.split('\n').filter((line) => line.startsWith(`  ${flags} `));
    assert.equal(rows.length, 1, `${flags} should have one row in the help, saw ${rows.length}`);
  }
});

test('the help lists the sections in reading order', () => {
  const titles = helpText()
    .split('\n')
    .filter((line) => /^\w[\w ]*:$/.test(line))
    .map((line) => line.slice(0, -1));

  assert.deepEqual(titles, ['Arguments', 'Input', 'Output', 'Styling', 'TOC', 'Diagrams', 'Diagnostics']);
});

test('the help documents --title, and --version and --help under Diagnostics (#59)', () => {
  const help = helpText();
  const diagnostics = section(help, 'Diagnostics');

  assert.match(help, /--title <text>/);
  assert.equal(diagnostics.filter((row) => row.startsWith('  -V, --version ')).length, 1);
  assert.equal(diagnostics.filter((row) => row.startsWith('  -h, --help ')).length, 1);
  assert.equal(diagnostics.at(-1)?.startsWith('  -h, --help '), true, '--help closes the list');
});

test('the help does not advertise an empty --css-var default (#59)', () => {
  const help = helpText();

  assert.match(help, /--css-var <name=value>/);
  assert.equal(help.includes('default: []'), false);
});

test('the previous option names are accepted but hidden (#59)', () => {
  const hidden = createProgram()
    .options.filter((option) => option.hidden)
    .map((option) => option.flags);

  assert.deepEqual(hidden, [
    '-p, --temp-in-output-alias',
    '-r, --temp-root-alias <dir>',
    '-k, --keep-temp-alias',
    '-f, --force-doctoc',
    '--update-md-toc',
  ]);
});

test('packageVersion reports the version from package.json', () => {
  assert.match(packageVersion(), /^\d+\.\d+\.\d+/);
});
